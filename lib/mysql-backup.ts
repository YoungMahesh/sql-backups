import mysql, { type Connection, type ConnectionOptions } from "mysql2/promise";
import zlib from "node:zlib";
import { PassThrough, Transform, once } from "node:stream";
import { generateBackupS3Key, uploadBackupStream, uploadBackupManifest } from "./s3";
import {
  formatManifest,
  type BackupManifest,
  type BackupManifestTableEntry,
} from "./manifest";

export const SYSTEM_DATABASES = new Set([
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
 * Preserves local datetime representation to prevent timezone offset corruption.
 */
export function escapeSqlValue(val: unknown): string {
  if (val === null || val === undefined) {
    return "NULL";
  }

  if (typeof val === "boolean") {
    return val ? "'1'" : "'0'";
  }

  if (typeof val === "number") {
    if (!isFinite(val)) return "NULL";
    return String(val);
  }

  if (val instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    const padMs = (n: number) => String(n).padStart(3, "0");
    const year = val.getFullYear();
    const month = pad(val.getMonth() + 1);
    const day = pad(val.getDate());
    const hours = pad(val.getHours());
    const minutes = pad(val.getMinutes());
    const seconds = pad(val.getSeconds());
    const ms = padMs(val.getMilliseconds());
    return `'${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}'`;
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

export interface BackupDatabaseOptions {
  connectionOptions: ConnectionOptions;
  databaseName: string;
  userId: string;
  /**
   * Test seam: an injected MySQL connection. When omitted, the writer opens one
   * from `connectionOptions`. Production callers never set this.
   */
  connection?: Connection;
  /**
   * Test seam: receives the manifest JSON bytes after a successful dump.
   * Defaults to `uploadBackupManifest`. Best-effort: an upload failure
   * logs a warning and does not fail the backup.
   */
  manifestSink?: ManifestSink;
}

export interface BackupResult {
  s3Key: string;
  sizeBytes: number;
}

/**
 * Sink that receives a Backup Manifest JSON sibling as bytes.
 */
export interface ManifestSink {
  uploadManifest(dumpKey: string, manifestBytes: Buffer | Uint8Array): Promise<void>;
}

const defaultManifestSink: ManifestSink = {
  async uploadManifest(dumpKey, manifestBytes) {
    await uploadBackupManifest(dumpKey, manifestBytes);
  },
};

/**
 * Writes data to a stream respecting backpressure.
 */
async function writeWithBackpressure(stream: PassThrough, chunk: string): Promise<void> {
  const canContinue = stream.write(chunk);
  if (!canContinue) {
    await once(stream, "drain");
  }
}

/**
 * Connects to a MySQL database, exports schema and data as SQL, compresses on the fly with Gzip,
 * and streams directly into S3 with true row streaming and backpressure handling.
 */
export async function backupDatabaseToS3(options: BackupDatabaseOptions): Promise<BackupResult> {
  const { connectionOptions, databaseName, userId } = options;

  if (SYSTEM_DATABASES.has(databaseName.toLowerCase())) {
    throw new Error(`Cannot backup protected system database: ${databaseName}`);
  }

  const s3Key = generateBackupS3Key({
    userId,
    databaseName,
    timestamp: new Date(),
  });

  const targetConnectionOptions: ConnectionOptions = {
    ...connectionOptions,
    database: databaseName,
  };

  let conn: Connection | null = null;
  const passThrough = new PassThrough();

  const tableRowCounts: BackupManifestTableEntry[] = [];
  const tableOrder: string[] = [];
  let uncompressedSizeBytes = 0;

  let uploadPromise: Promise<void> | null = null;

  try {
    conn =
      options.connection ??
      (await mysql.createConnection(targetConnectionOptions));

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

    // Handle pipeline errors so upload promise fails rather than hangs
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
    await writeWithBackpressure(passThrough, `-- MySQL Database Backup created by DB Manage\n`);
    await writeWithBackpressure(passThrough, `-- Database: ${escapeIdentifier(databaseName)}\n`);
    await writeWithBackpressure(passThrough, `-- Backup Date: ${nowIso}\n`);
    await writeWithBackpressure(passThrough, `-- ------------------------------------------------------\n\n`);
    await writeWithBackpressure(passThrough, `SET NAMES utf8mb4;\n`);
    await writeWithBackpressure(passThrough, `SET foreign_key_checks = 0;\n\n`);

    // 1. Fetch and dump BASE TABLES
    const [tablesResult] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE';");
    const tables: string[] = Array.isArray(tablesResult)
      ? tablesResult.map((row) => {
          const r = row as Record<string, unknown>;
          return String(Object.values(r)[0]);
        })
      : [];

    for (const table of tables) {
      let tableRowCount = 0;

      // Table Schema
      await writeWithBackpressure(passThrough, `--\n-- Table structure for table ${escapeIdentifier(table)}\n--\n`);
      await writeWithBackpressure(passThrough, `DROP TABLE IF EXISTS ${escapeIdentifier(table)};\n`);

      const [createResult] = await conn.query(`SHOW CREATE TABLE ${escapeIdentifier(table)};`);
      if (Array.isArray(createResult) && createResult.length > 0) {
        const createRow = createResult[0] as Record<string, unknown>;
        const createSql = String(
          createRow["Create Table"] ?? createRow["create table"] ?? ""
        );
        if (createSql) {
          await writeWithBackpressure(passThrough, `${createSql};\n\n`);
        }
      }

      // Stream Table Data in batches without exhausting memory
      await writeWithBackpressure(passThrough, `--\n-- Dumping data for table ${escapeIdentifier(table)}\n--\n`);

      // Using raw connection query stream
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawConn = (conn as any).connection;
      if (rawConn && typeof rawConn.query === "function") {
        const queryStream = rawConn.query(`SELECT * FROM ${escapeIdentifier(table)}`).stream({
          highWaterMark: 250,
        });

        const batch: Record<string, unknown>[] = [];
        const BATCH_SIZE = 250;

        await new Promise<void>((resolve, reject) => {
          queryStream.on("data", async (row: Record<string, unknown>) => {
            batch.push(row);
            tableRowCount++;
            if (batch.length >= BATCH_SIZE) {
              queryStream.pause();
              try {
                const insertSql = formatInsertStatement(table, batch);
                batch.length = 0;
                await writeWithBackpressure(passThrough, insertSql);
                queryStream.resume();
              } catch (writeErr) {
                queryStream.destroy(writeErr instanceof Error ? writeErr : new Error(String(writeErr)));
              }
            }
          });

          queryStream.on("end", async () => {
            try {
              if (batch.length > 0) {
                const insertSql = formatInsertStatement(table, batch);
                batch.length = 0;
                await writeWithBackpressure(passThrough, insertSql);
              }
              await writeWithBackpressure(passThrough, `\n`);
              resolve();
            } catch (err) {
              reject(err);
            }
          });

          queryStream.on("error", (err: Error) => {
            reject(err);
          });
        });
      } else {
        // Fallback for mock/test environments
        const [rows] = await conn.query(`SELECT * FROM ${escapeIdentifier(table)};`);
        if (Array.isArray(rows)) {
          tableRowCount = rows.length;
          if (rows.length > 0) {
            const insertSql = formatInsertStatement(table, rows as Record<string, unknown>[]);
            await writeWithBackpressure(passThrough, insertSql);
          }
        }
        await writeWithBackpressure(passThrough, `\n`);
      }

      tableOrder.push(table);
      tableRowCounts.push({ name: table, rowCount: tableRowCount });
    }

    // 2. Fetch and dump VIEWS
    try {
      const [viewsResult] = await conn.query("SHOW FULL TABLES WHERE Table_type = 'VIEW';");
      const views: string[] = Array.isArray(viewsResult)
        ? viewsResult.map((row) => {
            const r = row as Record<string, unknown>;
            return String(Object.values(r)[0]);
          })
        : [];

      for (const view of views) {
        await writeWithBackpressure(passThrough, `--\n-- View structure for ${escapeIdentifier(view)}\n--\n`);
        await writeWithBackpressure(passThrough, `DROP VIEW IF EXISTS ${escapeIdentifier(view)};\n`);
        const [createViewResult] = await conn.query(`SHOW CREATE VIEW ${escapeIdentifier(view)};`);
        if (Array.isArray(createViewResult) && createViewResult.length > 0) {
          const viewRow = createViewResult[0] as Record<string, unknown>;
          const createViewSql = String(viewRow["Create View"] ?? viewRow["create view"] ?? "");
          if (createViewSql) {
            await writeWithBackpressure(passThrough, `${createViewSql};\n\n`);
          }
        }
      }
    } catch {
      // Non-critical if user lacks permissions for views
    }

    // 3. Fetch and dump TRIGGERS
    try {
      const [triggersResult] = await conn.query("SHOW TRIGGERS;");
      if (Array.isArray(triggersResult) && triggersResult.length > 0) {
        await writeWithBackpressure(passThrough, `--\n-- Triggers for database ${escapeIdentifier(databaseName)}\n--\n`);
        for (const triggerRow of triggersResult as Record<string, unknown>[]) {
          const triggerName = String(triggerRow.Trigger ?? triggerRow.trigger ?? "");
          if (triggerName) {
            const [createTrigResult] = await conn.query(`SHOW CREATE TRIGGER ${escapeIdentifier(triggerName)};`);
            if (Array.isArray(createTrigResult) && createTrigResult.length > 0) {
              const trigRow = createTrigResult[0] as Record<string, unknown>;
              const createTrigSql = String(trigRow["SQL Original Statement"] ?? trigRow["Create Trigger"] ?? "");
              if (createTrigSql) {
                await writeWithBackpressure(passThrough, `DELIMITER ;;\n${createTrigSql};;\nDELIMITER ;\n\n`);
              }
            }
          }
        }
      }
    } catch {
      // Non-critical if user lacks permissions for triggers
    }

    await writeWithBackpressure(passThrough, `SET foreign_key_checks = 1;\n`);
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
        `[mysql-backup] manifest upload failed for ${s3Key}; backup retained without manifest:`,
        manifestErr instanceof Error ? manifestErr.message : manifestErr
      );
    }

    return {
      s3Key,
      sizeBytes: compressedSizeBytes,
    };
  } catch (err) {
    // If an error occurs, destroy passThrough so S3 upload stream aborts immediately
    passThrough.destroy(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch {
        // Ignore connection close errors
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
