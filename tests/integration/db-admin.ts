import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import crypto from "node:crypto";

let adminClientInstance: postgres.Sql | null = null;

export function getTestServerUrl(): string {
  const server = process.env.TEST_DATABASE_SERVER;
  if (!server) {
    throw new Error(
      "TEST_DATABASE_SERVER environment variable is not defined. " +
        "Run integration tests with `pnpm test:integration` or provide TEST_DATABASE_SERVER in your environment."
    );
  }
  return server;
}

export function getAdminDatabaseUrl(): string {
  const url = new URL(getTestServerUrl());
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/postgres";
  }
  return url.toString();
}

export function getDatabaseUrl(dbName: string): string {
  const url = new URL(getTestServerUrl());
  url.pathname = `/${dbName}`;
  return url.toString();
}

export function getAdminClient(): postgres.Sql {
  if (!adminClientInstance) {
    adminClientInstance = postgres(getAdminDatabaseUrl(), {
      max: 5,
      connect_timeout: 10,
    });
  }
  return adminClientInstance;
}

export async function closeAdminClient(): Promise<void> {
  if (adminClientInstance) {
    await adminClientInstance.end({ timeout: 5 });
    adminClientInstance = null;
  }
}

export function generateTestDatabaseName(type: "template" | "suite"): string {
  const rand = crypto.randomBytes(3).toString("hex");
  return `db_test_${type}_${Date.now()}_${rand}`;
}

export function extractDatabaseTimestamp(name: string): number | null {
  const match = name.match(/^db_test_.*_(\d+)(?:_[a-z0-9]+)?$/);
  if (!match) return null;
  const ts = parseInt(match[1], 10);
  return Number.isNaN(ts) ? null : ts;
}

export async function createTemplateDatabase(
  customName?: string
): Promise<{ name: string; url: string }> {
  const admin = getAdminClient();
  const templateName = customName ?? generateTestDatabaseName("template");
  const templateUrl = getDatabaseUrl(templateName);

  // 1. Create the template database
  await admin.unsafe(`CREATE DATABASE ${templateName};`);

  // 2. Apply programmatic Drizzle schema migrations
  const migrationClient = postgres(templateUrl, { max: 1 });
  try {
    const drizzleDb = drizzle({ client: migrationClient });
    const migrationsFolder = path.resolve(process.cwd(), "drizzle");
    await migrate(drizzleDb, { migrationsFolder });
  } finally {
    await migrationClient.end({ timeout: 5 });
  }

  // 3. Lock template to prevent incoming connections and allow fast cloning
  await admin.unsafe(
    `ALTER DATABASE ${templateName} WITH ALLOW_CONNECTIONS = false;`
  );

  return { name: templateName, url: templateUrl };
}

export async function cloneSuiteDatabase(
  templateName: string,
  customName?: string
): Promise<{ name: string; url: string }> {
  const admin = getAdminClient();
  const suiteName = customName ?? generateTestDatabaseName("suite");
  const suiteUrl = getDatabaseUrl(suiteName);

  await admin.unsafe(
    `CREATE DATABASE ${suiteName} TEMPLATE ${templateName};`
  );

  return { name: suiteName, url: suiteUrl };
}

export async function dropDatabase(dbName: string): Promise<void> {
  const admin = getAdminClient();
  // Terminate any remaining backends
  await admin.unsafe(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`,
    [dbName]
  );
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);`);
}

export async function sweepOrphanDatabases(
  maxAgeMs: number = 2 * 60 * 60 * 1000
): Promise<string[]> {
  const admin = getAdminClient();
  const rows = await admin<{ datname: string }[]>`
    SELECT datname FROM pg_database WHERE datname LIKE 'db_test_%'
  `;

  const dropped: string[] = [];
  const now = Date.now();

  for (const row of rows) {
    const name = row.datname;
    const ts = extractDatabaseTimestamp(name);

    // If timestamp is unparseable/malformed OR older than maxAgeMs, sweep it
    if (ts === null || now - ts > maxAgeMs) {
      try {
        await dropDatabase(name);
        dropped.push(name);
      } catch (err) {
        console.warn(`Failed to sweep orphan database ${name}:`, err);
      }
    }
  }

  return dropped;
}

export async function getActiveTemplateDatabase(): Promise<string | null> {
  const admin = getAdminClient();
  const rows = await admin<{ datname: string }[]>`
    SELECT datname FROM pg_database
    WHERE datname LIKE 'db_test_template_%'
    ORDER BY datname DESC
    LIMIT 1
  `;
  return rows.length > 0 ? rows[0].datname : null;
}
