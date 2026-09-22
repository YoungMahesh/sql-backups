import postgres, { type Sql } from "postgres";
import zlib from "node:zlib";
import { PassThrough, Transform, once } from "node:stream";
import { generateBackupS3Key, uploadBackupStream, uploadBackupManifest } from "./s3";
import {
  formatManifest,
  type BackupManifest,
  type BackupManifestTableEntry,
} from "./manifest";
import { serializeToConnectionString } from "./crypto";

export const POSTGRES_SYSTEM_DATABASES = new Set([
  "postgres",
  "template0",
  "template1",
]);

/**
 * Escapes an SQL identifier using PostgreSQL double quotes.
 */
export function escapePostgresIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Escapes a schema-qualified table identifier: "schema"."table".
 */
export function escapePostgresQualifiedTable(schema: string, table: string): string {
  return `${escapePostgresIdentifier(schema)}.${escapePostgresIdentifier(table)}`;
}

/**
 * Escapes an arbitrary JavaScript value for insertion into a PostgreSQL SQL literal statement.
 * Supports numbers, booleans, dates (ISO string), bytea hex literals (\x...), JSON/JSONB, and text.
 */
export function escapePostgresValue(val: unknown): string {
  if (val === null || val === undefined) {
    return "NULL";
  }

  if (typeof val === "boolean") {
    return val ? "TRUE" : "FALSE";
  }

  if (typeof val === "number") {
    if (!isFinite(val)) return "NULL";
    return String(val);
  }

  if (val instanceof Date) {
    return `'${val.toISOString()}'`;
  }

  if (Buffer.isBuffer(val) || val instanceof Uint8Array) {
    const hex = Buffer.from(val).toString("hex");
    return `'\\x${hex}'`;
  }

  if (typeof val === "object") {
    let str: string;
    try {
      str = JSON.stringify(val);
    } catch {
      str = String(val);
    }
    // Doubling single quotes for PostgreSQL standard strings
    return `'${str.replace(/\0/g, "").replace(/'/g, "''")}'`;
  }

  const str = String(val);
  return `'${str.replace(/\0/g, "").replace(/'/g, "''")}'`;
}

/**
 * Formats an array of row objects into a batched INSERT INTO statement for PostgreSQL.
 */
export function formatPostgresInsertStatement(
  schema: string,
  table: string,
  rows: Record<string, unknown>[]
): string {
  if (!rows || rows.length === 0) return "";

  const columns = Object.keys(rows[0]);
  const escapedColumns = columns.map(escapePostgresIdentifier).join(", ");
  const escapedTable = escapePostgresQualifiedTable(schema, table);

  const valuesClauses = rows.map((row) => {
    const rowValues = columns.map((col) => escapePostgresValue(row[col])).join(", ");
    return `(${rowValues})`;
  });

  return `INSERT INTO ${escapedTable} (${escapedColumns}) VALUES ${valuesClauses.join(", ")};\n`;
}

export interface PostgresBackupConnectionOptions {
  uri?: string;
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  ssl?: boolean | "require" | "prefer" | "allow" | "verify-full" | object;
}

export interface PostgresBackupOptions {
  connectionOptions: PostgresBackupConnectionOptions;
  databaseName: string;
  userId: string;
  /**
   * Test seam: an injected PostgreSQL client. When omitted, the writer opens one
   * from `connectionOptions`. Production callers never set this.
   */
  sql?: Sql;
  /**
   * Test seam: receives the manifest JSON bytes after a successful dump.
   * Defaults to `uploadBackupManifest`.
   */
  manifestSink?: ManifestSink;
}

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
 * Writes data to a stream respecting backpressure.
 */
async function writeWithBackpressure(stream: PassThrough, chunk: string): Promise<void> {
  const canContinue = stream.write(chunk);
  if (!canContinue) {
    await once(stream, "drain");
  }
}

interface ColumnMetadata {
  column_name: string;
  data_type: string;
  not_null: boolean;
  default_value: string | null;
  identity_type: string | null;
}

interface ConstraintMetadata {
  constraint_name: string;
  constraint_type: string;
  definition: string;
}

interface IndexMetadata {
  index_name: string;
  index_definition: string;
}

/**
 * Reconstructs table CREATE TABLE DDL and secondary indexes from PostgreSQL catalogs.
 */
export async function reconstructPostgresTableDdl(
  sql: Sql,
  oid: number,
  schema: string,
  table: string
): Promise<string> {
  const columns = await sql.unsafe<ColumnMetadata[]>(`
    SELECT 
      a.attname AS column_name,
      format_type(a.atttypid, a.atttypmod) AS data_type,
      a.attnotnull AS not_null,
      pg_get_expr(ad.adbin, ad.adrelid) AS default_value,
      a.attidentity AS identity_type
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE a.attrelid = ${oid}
      AND a.attnum > 0
      AND NOT a.attisdropped
    ORDER BY a.attnum ASC;
  `);

  const constraints = await sql.unsafe<ConstraintMetadata[]>(`
    SELECT 
      conname AS constraint_name,
      contype AS constraint_type,
      pg_get_constraintdef(oid, true) AS definition
    FROM pg_constraint
    WHERE conrelid = ${oid}
    ORDER BY 
      CASE contype 
        WHEN 'p' THEN 1 
        WHEN 'u' THEN 2 
        WHEN 'f' THEN 3 
        ELSE 4 
      END,
      conname ASC;
  `);

  const indexes = await sql.unsafe<IndexMetadata[]>(`
    SELECT 
      i.relname AS index_name,
      pg_get_indexdef(idx.indexrelid, 0, true) AS index_definition
    FROM pg_index idx
    JOIN pg_class i ON i.oid = idx.indexrelid
    WHERE idx.indrelid = ${oid}
      AND NOT idx.indisprimary
      AND idx.indisunique = false
    ORDER BY i.relname ASC;
  `);

  const columnLines: string[] = [];

  for (const col of columns) {
    let line = `  ${escapePostgresIdentifier(col.column_name)} ${col.data_type}`;

    if (col.identity_type === "a") {
      line += " GENERATED ALWAYS AS IDENTITY";
    } else if (col.identity_type === "d") {
      line += " GENERATED BY DEFAULT AS IDENTITY";
    } else if (col.default_value) {
      line += ` DEFAULT ${col.default_value}`;
    }

    if (col.not_null) {
      line += " NOT NULL";
    }

    columnLines.push(line);
  }

  for (const con of constraints) {
    columnLines.push(`  CONSTRAINT ${escapePostgresIdentifier(con.constraint_name)} ${con.definition}`);
  }

  const qualifiedTable = escapePostgresQualifiedTable(schema, table);
  let ddl = `CREATE TABLE ${qualifiedTable} (\n${columnLines.join(",\n")}\n);\n`;

  for (const idx of indexes) {
    if (idx.index_definition) {
      ddl += `${idx.index_definition};\n`;
    }
  }

  return ddl;
}

interface TableRecord {
  oid: number;
  schema_name: string;
  table_name: string;
}

interface ViewRecord {
  schema_name: string;
  view_name: string;
  view_definition: string;
}

/**
 * Builds the target PostgreSQL connection URI for a backup job,
 * preserving any query parameters (such as sslmode=require, channel_binding, etc.)
 * while setting the target database pathname.
 */
export function buildTargetPostgresUri(
  connectionOptions: PostgresBackupConnectionOptions,
  databaseName: string
): string {
  if (connectionOptions.uri?.trim()) {
    let uri = connectionOptions.uri.trim();
    if (!uri.startsWith("postgresql://") && !uri.startsWith("postgres://")) {
      uri = `postgresql://${uri}`;
    }
    const url = new URL(uri);
    url.pathname = `/${encodeURIComponent(databaseName)}`;
    if (connectionOptions.ssl && !url.searchParams.has("sslmode") && !url.searchParams.has("ssl")) {
      const mode = typeof connectionOptions.ssl === "string" ? connectionOptions.ssl : "require";
      url.searchParams.set("sslmode", mode);
    }
    return url.toString();
  }

  return serializeToConnectionString({
    engine: "postgres",
    host: connectionOptions.host || "localhost",
    port: connectionOptions.port ? Number(connectionOptions.port) : 5432,
    user: connectionOptions.user || "postgres",
    password: connectionOptions.password || "",
    database: databaseName,
    ssl: connectionOptions.ssl
      ? typeof connectionOptions.ssl === "string"
        ? connectionOptions.ssl
        : "require"
      : undefined,
  });
}

/**
 * Connects to a PostgreSQL database, exports schema and data as SQL, compresses on the fly with Gzip,
 * and streams directly into S3 with true row streaming and backpressure handling.
 */
export async function backupPostgresDatabaseToS3(
  options: PostgresBackupOptions
): Promise<BackupResult> {
  const { connectionOptions, databaseName, userId } = options;

  if (POSTGRES_SYSTEM_DATABASES.has(databaseName.toLowerCase())) {
    throw new Error(`Cannot backup protected system database: ${databaseName}`);
  }

  const s3Key = generateBackupS3Key({
    userId,
    databaseName,
    timestamp: new Date(),
  });

  let sql: Sql | null = null;
  const passThrough = new PassThrough();

  const tableRowCounts: BackupManifestTableEntry[] = [];
  const tableOrder: string[] = [];
  let uncompressedSizeBytes = 0;
  let uploadPromise: Promise<void> | null = null;

  try {
    if (options.sql) {
      sql = options.sql;
    } else {
      const targetUri = buildTargetPostgresUri(connectionOptions, databaseName);

      sql = postgres(targetUri, {
        connect_timeout: 15,
        max: 2,
        idle_timeout: 10,
        ...(connectionOptions.ssl ? { ssl: connectionOptions.ssl } : {}),
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
    await writeWithBackpressure(passThrough, `-- PostgreSQL Database Backup created by SQL Backups\n`);
    await writeWithBackpressure(passThrough, `-- Database: ${escapePostgresIdentifier(databaseName)}\n`);
    await writeWithBackpressure(passThrough, `-- Backup Date: ${nowIso}\n`);
    await writeWithBackpressure(passThrough, `-- ------------------------------------------------------\n\n`);
    await writeWithBackpressure(passThrough, `SET client_encoding = 'UTF8';\n`);
    await writeWithBackpressure(passThrough, `SET standard_conforming_strings = on;\n`);
    await writeWithBackpressure(passThrough, `SET check_function_bodies = false;\n\n`);

    // 1. Discover and create user schemas
    const schemaRows = await sql.unsafe<{ nspname: string }[]>(`
      SELECT nspname FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog', 'information_schema')
        AND nspname NOT LIKE 'pg_toast%'
        AND nspname NOT LIKE 'pg_temp%'
      ORDER BY nspname ASC;
    `);

    for (const schemaRow of schemaRows) {
      const sName = schemaRow.nspname;
      if (sName !== "public") {
        await writeWithBackpressure(
          passThrough,
          `CREATE SCHEMA IF NOT EXISTS ${escapePostgresIdentifier(sName)};\n`
        );
      }
    }
    await writeWithBackpressure(passThrough, `\n`);

    // 2. Discover user base tables
    const tableRows = await sql.unsafe<TableRecord[]>(`
      SELECT 
        c.oid,
        n.nspname AS schema_name,
        c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg_toast%'
        AND n.nspname NOT LIKE 'pg_temp%'
      ORDER BY n.nspname ASC, c.relname ASC;
    `);

    for (const tbl of tableRows) {
      const schema = tbl.schema_name;
      const table = tbl.table_name;
      const qualifiedName = `${schema}.${table}`;
      const escapedQualified = escapePostgresQualifiedTable(schema, table);
      let tableRowCount = 0;

      // Table Schema
      await writeWithBackpressure(
        passThrough,
        `--\n-- Table structure for table ${escapedQualified}\n--\n`
      );
      await writeWithBackpressure(
        passThrough,
        `DROP TABLE IF EXISTS ${escapedQualified} CASCADE;\n`
      );

      const ddl = await reconstructPostgresTableDdl(sql, tbl.oid, schema, table);
      await writeWithBackpressure(passThrough, `${ddl}\n`);

      // Stream Table Data
      await writeWithBackpressure(
        passThrough,
        `--\n-- Dumping data for table ${escapedQualified}\n--\n`
      );

      const BATCH_SIZE = 250;
      const selectQuery = `SELECT * FROM ${escapedQualified};`;

      // Check if sql has cursor streaming capability (native postgres.js)
      const queryObj = sql.unsafe<Record<string, unknown>[]>(selectQuery);
      if (typeof queryObj.cursor === "function") {
        const cursor = queryObj.cursor(BATCH_SIZE);
        for await (const batch of cursor) {
          if (batch && batch.length > 0) {
            tableRowCount += batch.length;
            const insertSql = formatPostgresInsertStatement(schema, table, batch);
            await writeWithBackpressure(passThrough, insertSql);
          }
        }
      } else {
        // Fallback for mock/test environments
        const rows = await sql.unsafe<Record<string, unknown>[]>(selectQuery);
        if (Array.isArray(rows) && rows.length > 0) {
          tableRowCount = rows.length;
          for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const insertSql = formatPostgresInsertStatement(schema, table, batch);
            await writeWithBackpressure(passThrough, insertSql);
          }
        }
      }

      await writeWithBackpressure(passThrough, `\n`);

      tableOrder.push(qualifiedName);
      tableRowCounts.push({ name: qualifiedName, rowCount: tableRowCount });
    }

    // 3. Discover and dump views
    try {
      const viewRows = await sql.unsafe<ViewRecord[]>(`
        SELECT 
          n.nspname AS schema_name,
          c.relname AS view_name,
          pg_get_viewdef(c.oid, true) AS view_definition
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'v'
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%'
          AND n.nspname NOT LIKE 'pg_temp%'
        ORDER BY n.nspname ASC, c.relname ASC;
      `);

      for (const view of viewRows) {
        const escapedView = escapePostgresQualifiedTable(view.schema_name, view.view_name);
        await writeWithBackpressure(
          passThrough,
          `--\n-- View structure for ${escapedView}\n--\n`
        );
        await writeWithBackpressure(
          passThrough,
          `DROP VIEW IF EXISTS ${escapedView} CASCADE;\n`
        );
        const def = (view.view_definition || "").trim().replace(/;$/, "");
        if (def) {
          await writeWithBackpressure(
            passThrough,
            `CREATE VIEW ${escapedView} AS\n${def};\n\n`
          );
        }
      }
    } catch {
      // Non-critical if user lacks view permissions
    }

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
        `[postgres-backup] manifest upload failed for ${s3Key}; backup retained without manifest:`,
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
    if (!options.sql && sql) {
      try {
        await sql.end({ timeout: 5 });
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
