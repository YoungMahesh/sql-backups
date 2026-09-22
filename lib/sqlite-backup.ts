import { createClient, type Client } from "@libsql/client";
import zlib from "node:zlib";
import { PassThrough, Transform, once } from "node:stream";
import { generateBackupS3Key, uploadBackupStream, uploadBackupManifest } from "./s3";
import {
  formatManifest,
  type BackupManifest,
  type BackupManifestTableEntry,
} from "./manifest";
import { resolveSqliteUri } from "./sqlite-connection";

export interface BackupResult {
  s3Key: string;
  sizeBytes: number;
}

export interface ManifestSink {
  uploadManifest(dumpKey: string, manifestBytes: Buffer | Uint8Array): Promise<void>;
}

const defaultManifestSink: ManifestSink = {
  async uploadManifest(dumpKey, manifestBytes) {
    await uploadBackupManifest(dumpKey, manifestBytes);
  },
};

/**
 * Escapes an SQL identifier using standard double quotes.
 */
export function escapeSqliteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Escapes an arbitrary JavaScript value for insertion into an SQLite SQL literal statement.
 * Supports NULLs, booleans (1/0), numbers, strings with SQL single-quote escaping (''),
 * binary blobs via hex literals (X'...'), dates (ISO string), and JSON objects.
 */
export function escapeSqliteValue(val: unknown): string {
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

  if (typeof val === "bigint") {
    return val.toString();
  }

  if (val instanceof Date) {
    return `'${val.toISOString()}'`;
  }

  if (
    Buffer.isBuffer(val) ||
    val instanceof Uint8Array ||
    val instanceof ArrayBuffer
  ) {
    const hex = Buffer.from(val as ArrayBuffer).toString("hex").toUpperCase();
    return `X'${hex}'`;
  }

  if (typeof val === "object") {
    let str: string;
    try {
      str = JSON.stringify(val);
    } catch {
      str = String(val);
    }
    return `'${str.replace(/\0/g, "").replace(/'/g, "''")}'`;
  }

  const str = String(val);
  return `'${str.replace(/\0/g, "").replace(/'/g, "''")}'`;
}

/**
 * Formats an array of row objects into a batched INSERT INTO statement for SQLite.
 */
export function formatSqliteInsertStatement(
  table: string,
  rows: Record<string, unknown>[],
  columnsList?: string[]
): string {
  if (!rows || rows.length === 0) return "";

  const columns =
    columnsList && columnsList.length > 0 ? columnsList : Object.keys(rows[0]);
  const escapedColumns = columns.map(escapeSqliteIdentifier).join(", ");
  const escapedTable = escapeSqliteIdentifier(table);

  const valuesClauses = rows.map((row) => {
    const rowValues = columns.map((col) => escapeSqliteValue(row[col])).join(", ");
    return `(${rowValues})`;
  });

  return `INSERT INTO ${escapedTable} (${escapedColumns}) VALUES ${valuesClauses.join(", ")};\n`;
}

export interface SqliteBackupConnectionOptions {
  uri?: string;
  url?: string;
  authToken?: string;
  database?: string;
}

export interface SqliteBackupOptions {
  connectionOptions: SqliteBackupConnectionOptions;
  databaseName: string;
  userId: string;
  /**
   * Test seam: an injected libSQL Client. When omitted, the writer opens one
   * from `connectionOptions`. Production callers never set this.
   */
  client?: Client;
  /**
   * Test seam: receives the manifest JSON bytes after a successful dump.
   * Defaults to `uploadBackupManifest`.
   */
  manifestSink?: ManifestSink;
}

/**
 * Writes data to a stream respecting backpressure.
 */
async function writeWithBackpressure(stream: PassThrough, chunk: string): Promise<void> {
  const canContinue = stream.write(chunk);
  if (!canContinue) {
    await once(stream, "drain");
  }
}

function ensureSemicolon(sql: string): string {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

/**
 * Connects to a remote SQLite / libSQL database, exports schema definitions, table data,
 * views, indexes, and autoincrement sequence counters as SQL, compresses on the fly with Gzip,
 * and streams directly into S3 with backpressure handling and companion JSON manifest generation.
 */
export async function backupSqliteDatabaseToS3(
  options: SqliteBackupOptions
): Promise<BackupResult> {
  const { connectionOptions, databaseName, userId } = options;

  const s3Key = generateBackupS3Key({
    userId,
    databaseName,
    timestamp: new Date(),
  });

  let client: Client | null = null;
  const passThrough = new PassThrough();

  const tableRowCounts: BackupManifestTableEntry[] = [];
  const tableOrder: string[] = [];
  let uncompressedSizeBytes = 0;
  let uploadPromise: Promise<void> | null = null;

  try {
    if (options.client) {
      client = options.client;
    } else {
      const resolved = resolveSqliteUri({
        connectionString: connectionOptions.uri,
        url: connectionOptions.url,
        authToken: connectionOptions.authToken,
        database: databaseName,
      });

      client = createClient({
        url: resolved.uri,
        authToken: resolved.authToken,
      });
    }

    const uncompressedByteCounter = new Transform({
      transform(chunk, _encoding, callback) {
        uncompressedSizeBytes += chunk.length;
        callback(null, chunk);
      },
    });
    const gzip = zlib.createGzip({ level: 6 });

    let compressedSizeBytes = 0;
    const compressedByteCounter = new Transform({
      transform(chunk, _encoding, callback) {
        compressedSizeBytes += chunk.length;
        callback(null, chunk);
      },
    });

    const uploadPipeline = passThrough
      .pipe(uncompressedByteCounter)
      .pipe(gzip)
      .pipe(compressedByteCounter);

    const manifestSink = options.manifestSink ?? defaultManifestSink;

    uploadPromise = uploadBackupStream(s3Key, uploadPipeline);
    uploadPromise.catch(() => {});

    passThrough.on("error", (err) => {
      uncompressedByteCounter.destroy(err);
    });
    uncompressedByteCounter.on("error", (err) => {
      gzip.destroy(err);
    });
    gzip.on("error", (err) => {
      compressedByteCounter.destroy(err);
    });

    // Write header comments
    const nowIso = new Date().toISOString();
    await writeWithBackpressure(passThrough, `-- ------------------------------------------------------\n`);
    await writeWithBackpressure(passThrough, `-- SQLite Database Backup created by SQL Backups\n`);
    await writeWithBackpressure(passThrough, `-- Database: ${escapeSqliteIdentifier(databaseName)}\n`);
    await writeWithBackpressure(passThrough, `-- Backup Date: ${nowIso}\n`);
    await writeWithBackpressure(passThrough, `-- ------------------------------------------------------\n\n`);
    await writeWithBackpressure(passThrough, `PRAGMA foreign_keys = OFF;\n`);
    await writeWithBackpressure(passThrough, `BEGIN TRANSACTION;\n\n`);

    // 1. Discover user base tables from sqlite_schema
    const tablesRs = await client.execute(`
      SELECT name, sql FROM sqlite_schema
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_litestream%'
        AND name NOT LIKE '_libsql%'
      ORDER BY rootpage ASC, name ASC;
    `);

    const tables = tablesRs.rows as unknown as Array<{
      name: string;
      sql: string;
    }>;

    for (const tbl of tables) {
      const tableName = String(tbl.name);
      const tableSql = String(tbl.sql || "").trim();
      const escapedTable = escapeSqliteIdentifier(tableName);
      let tableRowCount = 0;

      // Table Schema DDL
      await writeWithBackpressure(
        passThrough,
        `--\n-- Table structure for table ${escapedTable}\n--\n`
      );
      await writeWithBackpressure(
        passThrough,
        `DROP TABLE IF EXISTS ${escapedTable};\n`
      );
      if (tableSql) {
        await writeWithBackpressure(passThrough, `${ensureSemicolon(tableSql)}\n\n`);
      }

      // Stream Table Data
      await writeWithBackpressure(
        passThrough,
        `--\n-- Dumping data for table ${escapedTable}\n--\n`
      );

      const BATCH_SIZE = 250;
      const selectQuery = `SELECT * FROM ${escapedTable};`;
      const dataRs = await client.execute(selectQuery);
      const columns = dataRs.columns;
      const rows = dataRs.rows;

      if (rows && rows.length > 0) {
        tableRowCount = rows.length;
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE) as Record<string, unknown>[];
          const insertSql = formatSqliteInsertStatement(tableName, batch, columns);
          await writeWithBackpressure(passThrough, insertSql);
        }
      }

      await writeWithBackpressure(passThrough, `\n`);

      tableOrder.push(tableName);
      tableRowCounts.push({ name: tableName, rowCount: tableRowCount });
    }

    // 2. Discover and dump views
    try {
      const viewsRs = await client.execute(`
        SELECT name, sql FROM sqlite_schema
        WHERE type = 'view'
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE '_litestream%'
          AND name NOT LIKE '_libsql%'
        ORDER BY rootpage ASC, name ASC;
      `);

      for (const viewRow of viewsRs.rows) {
        const viewName = String(viewRow.name);
        const viewSql = String(viewRow.sql || "").trim();
        const escapedView = escapeSqliteIdentifier(viewName);

        await writeWithBackpressure(
          passThrough,
          `--\n-- View structure for ${escapedView}\n--\n`
        );
        await writeWithBackpressure(
          passThrough,
          `DROP VIEW IF EXISTS ${escapedView};\n`
        );
        if (viewSql) {
          await writeWithBackpressure(passThrough, `${ensureSemicolon(viewSql)}\n\n`);
        }
      }
    } catch {
      // Non-critical if views extraction fails
    }

    // 3. Discover and dump indexes (excluding automatic primary key / unique indexes where sql is NULL)
    try {
      const indexesRs = await client.execute(`
        SELECT name, tbl_name, sql FROM sqlite_schema
        WHERE type = 'index'
          AND sql IS NOT NULL
          AND sql != ''
          AND name NOT LIKE 'sqlite_%'
          AND name NOT LIKE '_litestream%'
          AND name NOT LIKE '_libsql%'
        ORDER BY rootpage ASC, name ASC;
      `);

      for (const idxRow of indexesRs.rows) {
        const indexName = String(idxRow.name);
        const indexSql = String(idxRow.sql || "").trim();
        const escapedIndex = escapeSqliteIdentifier(indexName);

        if (indexSql) {
          await writeWithBackpressure(
            passThrough,
            `--\n-- Index structure for ${escapedIndex}\n--\n`
          );
          await writeWithBackpressure(passThrough, `${ensureSemicolon(indexSql)}\n\n`);
        }
      }
    } catch {
      // Non-critical if index extraction fails
    }

    // 4. Capture autoincrement sequence counters from sqlite_sequence
    try {
      const seqCheck = await client.execute(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'sqlite_sequence';"
      );

      if (seqCheck.rows.length > 0) {
        const seqRs = await client.execute(
          "SELECT name, seq FROM sqlite_sequence WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '_libsql%' ORDER BY name ASC;"
        );

        if (seqRs.rows.length > 0) {
          await writeWithBackpressure(
            passThrough,
            `--\n-- Sequence state for autoincrement tables\n--\n`
          );
          await writeWithBackpressure(passThrough, `DELETE FROM sqlite_sequence;\n`);

          for (const sRow of seqRs.rows) {
            const seqName = String(sRow.name);
            const seqVal = Number(sRow.seq);
            const escapedName = escapeSqliteValue(seqName);
            await writeWithBackpressure(
              passThrough,
              `INSERT INTO sqlite_sequence VALUES (${escapedName}, ${seqVal});\n`
            );
          }
          await writeWithBackpressure(passThrough, `\n`);
        }
      }
    } catch {
      // Non-critical if sequence extraction fails
    }

    await writeWithBackpressure(passThrough, `COMMIT;\n`);
    await writeWithBackpressure(passThrough, `PRAGMA foreign_keys = ON;\n`);
    await writeWithBackpressure(passThrough, `-- Backup completed on ${new Date().toISOString()}\n`);
    passThrough.end();

    // Await S3 upload completion
    await uploadPromise;

    const manifest: BackupManifest = {
      version: 1,
      uncompressedSizeBytes,
      tables: tableOrder.map((name, idx) => ({
        name,
        rowCount: tableRowCounts[idx]?.rowCount ?? 0,
      })),
    };

    try {
      await manifestSink.uploadManifest(s3Key, formatManifest(manifest));
    } catch (manifestErr) {
      console.warn(
        `[sqlite-backup] manifest upload failed for ${s3Key}; backup retained without manifest:`,
        manifestErr instanceof Error ? manifestErr.message : manifestErr
      );
    }

    return {
      s3Key,
      sizeBytes: compressedSizeBytes,
    };
  } catch (err) {
    passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    if (!options.client && client) {
      try {
        client.close();
      } catch {
      }
    }
    if (uploadPromise) {
      try {
        await uploadPromise;
      } catch {
      }
    }
  }
}
