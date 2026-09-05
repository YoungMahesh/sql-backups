import mysql, { type Connection, type ConnectionOptions } from "mysql2/promise";
import zlib from "node:zlib";
import { PassThrough, Transform } from "node:stream";
import { generateBackupS3Key, uploadBackupStream } from "./s3";

const SYSTEM_DATABASES = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);

/**
 * Escapes an SQL identifier using backticks.
 */
export function escapeIdentifier(name: string): string {
  return `\`${name.replace(/`/g, "``")}\``;
}

/**
 * Escapes an arbitrary JavaScript value for insertion into an SQL literal statement.
 */
export function escapeSqlValue(val: unknown): string {
  if (val === null || val === undefined) {
    return "NULL";
  }

  if (typeof val === "boolean") {
    return val ? "1" : "0";
  }

  if (typeof val === "number") {
    if (!isFinite(val)) return "NULL";
    return String(val);
  }

  if (val instanceof Date) {
    // Format as YYYY-MM-DD HH:mm:ss.sss
    const iso = val.toISOString();
    return `'${iso.slice(0, 10)} ${iso.slice(11, 23)}'`;
  }

  if (Buffer.isBuffer(val)) {
    return `X'${val.toString("hex")}'`;
  }

  let str: string;
  if (typeof val === "object") {
    try {
      str = JSON.stringify(val);
    } catch {
      str = String(val);
    }
  } else {
    str = String(val);
  }

  // Escape standard MySQL special characters
  const escaped = str
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\x1a/g, "\\Z");

  return `'${escaped}'`;
}

/**
 * Formats an array of row objects into a batched INSERT INTO statement.
 */
export function formatInsertStatement(
  tableName: string,
  rows: Record<string, unknown>[]
): string {
  if (!rows || rows.length === 0) return "";

  const columns = Object.keys(rows[0]);
  const escapedColumns = columns.map(escapeIdentifier).join(", ");
  const escapedTable = escapeIdentifier(tableName);

  const valuesClauses = rows.map((row) => {
    const rowValues = columns.map((col) => escapeSqlValue(row[col])).join(", ");
    return `(${rowValues})`;
  });

  return `INSERT INTO ${escapedTable} (${escapedColumns}) VALUES ${valuesClauses.join(", ")};\n`;
}

export interface DumpDatabaseOptions {
  connectionOptions: ConnectionOptions;
  databaseName: string;
  userId: string;
}

export interface DumpResult {
  s3Key: string;
  sizeBytes: number;
}

/**
 * Connects to a MySQL database, exports schema and data as SQL, compresses on the fly with Gzip,
 * and streams directly into S3.
 */
export async function dumpDatabaseToS3(options: DumpDatabaseOptions): Promise<DumpResult> {
  const { connectionOptions, databaseName, userId } = options;

  if (SYSTEM_DATABASES.has(databaseName.toLowerCase())) {
    throw new Error(`Cannot backup protected system database: ${databaseName}`);
  }

  const s3Key = generateBackupS3Key({
    userId,
    databaseName,
    timestamp: new Date(),
  });

  // Open MySQL connection directly to the target database
  const targetConnectionOptions: ConnectionOptions = {
    ...connectionOptions,
    database: databaseName,
  };

  let conn: Connection | null = null;

  try {
    conn = await mysql.createConnection(targetConnectionOptions);

    const passThrough = new PassThrough();
    const gzip = zlib.createGzip({ level: 6 });

    let compressedSizeBytes = 0;
    const byteCounter = new Transform({
      transform(chunk, _encoding, callback) {
        compressedSizeBytes += chunk.length;
        callback(null, chunk);
      },
    });

    const uploadPipeline = passThrough.pipe(gzip).pipe(byteCounter);

    // Launch S3 upload in the background while feeding the stream
    const uploadPromise = uploadBackupStream(s3Key, uploadPipeline);

    // Stream SQL content
    const nowIso = new Date().toISOString();
    passThrough.write(`-- ------------------------------------------------------\n`);
    passThrough.write(`-- MySQL Database Backup created by DB Manage\n`);
    passThrough.write(`-- Database: ${escapeIdentifier(databaseName)}\n`);
    passThrough.write(`-- Backup Date: ${nowIso}\n`);
    passThrough.write(`-- ------------------------------------------------------\n\n`);
    passThrough.write(`SET NAMES utf8mb4;\n`);
    passThrough.write(`SET foreign_key_checks = 0;\n\n`);

    // Fetch list of base tables
    const [tablesResult] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE';");
    const tables: string[] = Array.isArray(tablesResult)
      ? tablesResult.map((row) => {
          const r = row as Record<string, unknown>;
          return String(Object.values(r)[0]);
        })
      : [];

    for (const table of tables) {
      // Table Schema
      passThrough.write(`--\n-- Table structure for table ${escapeIdentifier(table)}\n--\n`);
      passThrough.write(`DROP TABLE IF EXISTS ${escapeIdentifier(table)};\n`);

      const [createResult] = await conn.query(`SHOW CREATE TABLE ${escapeIdentifier(table)};`);
      if (Array.isArray(createResult) && createResult.length > 0) {
        const createRow = createResult[0] as Record<string, unknown>;
        const createSql = String(
          createRow["Create Table"] ?? createRow["create table"] ?? ""
        );
        if (createSql) {
          passThrough.write(`${createSql};\n\n`);
        }
      }

      // Table Data
      passThrough.write(`--\n-- Dumping data for table ${escapeIdentifier(table)}\n--\n`);
      const [rows] = await conn.query(`SELECT * FROM ${escapeIdentifier(table)};`);
      if (Array.isArray(rows) && rows.length > 0) {
        const BATCH_SIZE = 250;
        const records = rows as Record<string, unknown>[];
        for (let i = 0; i < records.length; i += BATCH_SIZE) {
          const batch = records.slice(i, i + BATCH_SIZE);
          const insertSql = formatInsertStatement(table, batch);
          passThrough.write(insertSql);
        }
      }
      passThrough.write(`\n`);
    }

    passThrough.write(`SET foreign_key_checks = 1;\n`);
    passThrough.write(`-- Backup completed on ${new Date().toISOString()}\n`);
    passThrough.end();

    // Await upload completion
    await uploadPromise;

    return {
      s3Key,
      sizeBytes: compressedSizeBytes,
    };
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch {
        // Ignore connection close errors
      }
    }
  }
}
