import postgres from "postgres";
import { parseConnectionString, serializeToConnectionString } from "./crypto";

export const POSTGRES_SYSTEM_DATABASES = new Set([
  "postgres",
  "template0",
  "template1",
]);

export interface PostgresConnectionConfig {
  mode: "params" | "uri" | "saved";
  connectionString?: string;
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | "require" | "prefer" | "allow" | "verify-full";
}

export function parsePostgresErrorMessage(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return "An unexpected error occurred while connecting to the PostgreSQL server.";
  }

  const errorObj = err as { code?: string; errno?: number; message?: string };

  if (errorObj.code === "ECONNREFUSED") {
    return "Connection refused. Please verify that the PostgreSQL server is running and accessible on the specified host and port.";
  }
  if (errorObj.code === "ENOTFOUND") {
    return "Hostname not found. Please check that the server path / address is correct.";
  }
  if (errorObj.code === "ETIMEDOUT") {
    return "Connection timed out (10s limit). Please check your server availability and network/firewall rules.";
  }
  if (
    errorObj.code === "28P01" ||
    (errorObj.message && errorObj.message.toLowerCase().includes("password authentication failed"))
  ) {
    return "Password authentication failed. Please check your username and password.";
  }
  if (
    errorObj.message &&
    (errorObj.message.toLowerCase().includes("ssl") ||
      errorObj.message.toLowerCase().includes("insecure") ||
      errorObj.message.toLowerCase().includes("sslmode"))
  ) {
    return errorObj.message;
  }
  if (errorObj.code === "28000") {
    return errorObj.message || "Invalid authorization specification. Please verify user credentials.";
  }
  if (errorObj.code === "3D000") {
    return "Target database does not exist on this server.";
  }
  if (errorObj.code === "EHOSTUNREACH") {
    return "Host unreachable. Please verify network routing and that the PostgreSQL server is reachable.";
  }

  return errorObj.message || "Failed to connect to the PostgreSQL server.";
}

export function resolvePostgresUri(config: {
  connectionString?: string;
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | string;
}): {
  uri: string;
  host: string;
  port: number;
  user: string;
  database?: string;
} {
  if (config.connectionString?.trim()) {
    let uri = config.connectionString.trim();
    if (!uri.startsWith("postgresql://") && !uri.startsWith("postgres://")) {
      uri = `postgresql://${uri}`;
    }
    const parsed = parseConnectionString(uri);
    return {
      uri,
      host: parsed.host,
      port: parsed.port || 5432,
      user: parsed.user || "postgres",
      database: parsed.database,
    };
  }

  const host = config.host?.trim() || "localhost";
  const port = config.port ? Number(config.port) : 5432;
  const user = config.user?.trim() || "postgres";
  const password = config.password ?? "";
  const database = config.database?.trim() || undefined;

  const uri = serializeToConnectionString({
    engine: "postgres",
    host,
    port,
    user,
    password,
    database: database || "postgres", // PostgreSQL requires a database to connect; default to postgres
    ssl: config.ssl,
  });

  return {
    uri,
    host,
    port,
    user,
    database,
  };
}

export async function testPostgresConnection(uri: string): Promise<{
  success: boolean;
  version: string;
}> {
  const sql = postgres(uri, {
    connect_timeout: 10,
    max: 1,
    idle_timeout: 5,
  });

  try {
    const rows = await sql<{ version: string }[]>`SELECT version() as version;`;
    const version = rows[0]?.version || "Unknown";
    return { success: true, version };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function listPostgresUserDatabases(uri: string): Promise<{
  databases: string[];
  version: string;
}> {
  const sql = postgres(uri, {
    connect_timeout: 10,
    max: 1,
    idle_timeout: 5,
  });

  try {
    const versionRows = await sql<{ version: string }[]>`SELECT version() as version;`;
    const version = versionRows[0]?.version || "Unknown";

    const dbRows = await sql<{ datname: string; datistemplate: boolean }[]>`
      SELECT datname, datistemplate FROM pg_database WHERE datistemplate = false ORDER BY datname ASC;
    `;

    const databases = dbRows
      .map((row) => row.datname)
      .filter((name) => !POSTGRES_SYSTEM_DATABASES.has(name.toLowerCase()));

    return {
      databases,
      version,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}
