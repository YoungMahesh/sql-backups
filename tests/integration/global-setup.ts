import fs from "node:fs";
import path from "node:path";
import {
  getTestServerUrl,
  getAdminClient,
  closeAdminClient,
  createTemplateDatabase,
  dropDatabase,
  sweepOrphanDatabases,
} from "./db-admin";

const TEMPLATE_TRACKING_FILE = path.resolve(
  process.cwd(),
  ".scratch/current-test-template.txt"
);

export default async function globalSetup() {
  // 1. Fail fast if TEST_DATABASE_SERVER is missing
  let serverUrl: string;
  try {
    serverUrl = getTestServerUrl();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n[FAIL-FAST] Integration test prerequisite check failed: ${message}\n`);
    throw new Error(`TEST_DATABASE_SERVER is missing. Run integration tests with 'pnpm test:integration' or 'dotenvx run -- ...': ${message}`);
  }

  // 2. Validate reachability of TEST_DATABASE_SERVER
  try {
    const admin = getAdminClient();
    await admin`SELECT 1`;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const parsedUrl = new URL(serverUrl);
    console.error(`\n[FAIL-FAST] Could not connect to PostgreSQL test server at ${parsedUrl.host}: ${message}\n`);
    throw new Error(`TEST_DATABASE_SERVER at ${parsedUrl.host} is unreachable: ${message}`);
  }

  // 3. Pre-flight orphan sweep: remove stranded test databases older than 2 hours or malformed
  const swept = await sweepOrphanDatabases();
  if (swept.length > 0) {
    console.log(`[ORPHAN-SWEEPER] Cleaned up ${swept.length} orphaned test database(s):`, swept);
  }

  // 4. Create the timestamped template database and apply programmatic migrations once
  console.log("[TEMPLATE] Provisioning integration test template database...");
  const template = await createTemplateDatabase();
  console.log(`[TEMPLATE] Ready: ${template.name}`);

  // Expose template name to child workers/forks
  process.env.TEST_TEMPLATE_DATABASE = template.name;
  fs.mkdirSync(path.dirname(TEMPLATE_TRACKING_FILE), { recursive: true });
  fs.writeFileSync(TEMPLATE_TRACKING_FILE, template.name, "utf-8");

  // 5. Global teardown function called at the end of the Vitest run
  return async () => {
    console.log(`[TEARDOWN] Dropping template database ${template.name}...`);
    try {
      await dropDatabase(template.name);
    } catch (err) {
      console.warn(`[TEARDOWN] Failed to drop template database ${template.name}:`, err);
    }

    if (fs.existsSync(TEMPLATE_TRACKING_FILE)) {
      try {
        fs.unlinkSync(TEMPLATE_TRACKING_FILE);
      } catch {
        // ignore
      }
    }

    await closeAdminClient();
    console.log("[TEARDOWN] Integration test cleanup complete.");
  };
}
