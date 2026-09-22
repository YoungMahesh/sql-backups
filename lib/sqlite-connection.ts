import { createClient } from "@libsql/client";
import { parseConnectionString, serializeToConnectionString } from "./crypto";

export interface SqliteTableInfo {
  name: string;
  rowCount: number;
}

export interface SqliteConnectionConfig {
  mode: "params" | "uri" | "saved";
  connectionString?: string;
  url?: string;
  authToken?: string;
  database?: string;
  savedConnectionId?: string;
}

export function parseSqliteErrorMessage(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return "An unexpected error occurred while connecting to the SQLite (libSQL / Turso) database.";
  }

  const errorObj = err as { code?: string; errno?: number; message?: string; status?: number };
  const msg = (errorObj.message || "").toLowerCase();

  if (
    errorObj.status === 401 ||
    errorObj.code === "UNAUTHORIZED" ||
    msg.includes("unauthorized") ||
    msg.includes("invalid token") ||
    msg.includes("bad auth token") ||
    msg.includes("jwt")
  ) {
    return "Invalid authentication token. Please verify your Turso / libSQL auth token.";
  }

  if (errorObj.code === "ECONNREFUSED" || msg.includes("connection refused")) {
    return "Connection refused. Please verify that the remote libSQL server is running and accessible.";
  }

  if (errorObj.code === "ENOTFOUND" || msg.includes("enotfound") || msg.includes("hostname not found")) {
    return "Hostname not found. Please check that the database URL or Turso instance address is correct.";
  }

  if (errorObj.code === "ETIMEDOUT" || msg.includes("timed out") || msg.includes("timeout")) {
    return "Connection timed out. Please check your database URL and network connectivity.";
  }

  if (msg.includes("invalid url") || msg.includes("url parse")) {
    return "Invalid database URL format. Please provide a valid libsql:// or https:// URL.";
  }

  return errorObj.message || "Failed to connect to the SQLite (libSQL / Turso) database.";
}

export function resolveSqliteUri(config: {
  connectionString?: string;
  url?: string;
  authToken?: string;
  database?: string;
}): {
  uri: string;
  host: string;
  port: number;
  database: string;
  authToken?: string;
} {
  const rawInput = (config.connectionString || config.url || "").trim();
  if (!rawInput) {
    throw new Error("Database URL or connection string is required.");
  }

  let parseable = rawInput;
  if (
    !parseable.startsWith("libsql://") &&
    !parseable.startsWith("https://") &&
    !parseable.startsWith("http://")
  ) {
    parseable = `libsql://${parseable}`;
  }

  const parsed = parseConnectionString(parseable);
  const token = (config.authToken && config.authToken.trim()) || parsed.authToken;
  const db = (config.database && config.database.trim()) || parsed.database || "main";

  const canonicalUri = serializeToConnectionString({
    engine: "sqlite",
    host: parsed.host,
    port: parsed.port,
    database: db,
    authToken: token,
  });

  return {
    uri: canonicalUri,
    host: parsed.host,
    port: parsed.port || 443,
    database: db,
    authToken: token,
  };
}

export async function testSqliteConnection(
  uri: string,
  authToken?: string
): Promise<{
  success: boolean;
  version: string;
}> {
  const client = createClient({
    url: uri,
    authToken,
  });

  try {
    const rs = await client.execute("SELECT sqlite_version() as version;");
    const version = String(rs.rows[0]?.version || "libSQL");
    return { success: true, version };
  } finally {
    client.close();
  }
}

export async function listSqliteTablesAndRows(
  uri: string,
  authToken?: string
): Promise<{
  database: string;
  tables: SqliteTableInfo[];
  version: string;
}> {
  const client = createClient({
    url: uri,
    authToken,
  });

  try {
    const versionRs = await client.execute("SELECT sqlite_version() as version;");
    const version = String(versionRs.rows[0]?.version || "libSQL");

    const tableRs = await client.execute(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name NOT LIKE '_libsql%' ORDER BY name ASC;"
    );

    const tables: SqliteTableInfo[] = [];

    for (const row of tableRs.rows) {
      const tableName = String(row.name);
      try {
        const countRs = await client.execute(
          `SELECT COUNT(*) as count FROM "${tableName.replace(/"/g, '""')}";`
        );
        const rowCount = Number(countRs.rows[0]?.count ?? 0);
        tables.push({ name: tableName, rowCount });
      } catch {
        tables.push({ name: tableName, rowCount: 0 });
      }
    }

    const parsed = parseConnectionString(uri);
    const database = parsed.database || "main";

    return {
      database,
      tables,
      version,
    };
  } finally {
    client.close();
  }
}
