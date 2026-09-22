import fs from "node:fs";
import path from "node:path";
import { afterAll } from "vitest";
import {
  cloneSuiteDatabase,
  dropDatabase,
  getActiveTemplateDatabase,
} from "./db-admin";

const TEMPLATE_TRACKING_FILE = path.resolve(
  process.cwd(),
  ".scratch/current-test-template.txt"
);

// 1. Resolve active template database
let templateDbName = process.env.TEST_TEMPLATE_DATABASE;
if (!templateDbName && fs.existsSync(TEMPLATE_TRACKING_FILE)) {
  templateDbName = fs.readFileSync(TEMPLATE_TRACKING_FILE, "utf-8").trim();
}
if (!templateDbName) {
  templateDbName = (await getActiveTemplateDatabase()) ?? undefined;
}

if (!templateDbName) {
  throw new Error(
    "No active template database found. Ensure globalSetup provisioned a template database."
  );
}

// 2. Clone an isolated database for this suite using top-level await before test modules evaluate
const suiteDb = await cloneSuiteDatabase(templateDbName);
process.env.DATABASE_URL = suiteDb.url;

// 3. Dynamically import closeDb from @/db after process.env.DATABASE_URL has been assigned
const { closeDb } = await import("@/db");

// 4. Register graceful teardown to drain connection pool and drop the suite database
afterAll(async () => {
  try {
    await closeDb();
  } catch (err) {
    console.warn(`[SUITE TEARDOWN] Error closing db connection for ${suiteDb.name}:`, err);
  }

  try {
    await dropDatabase(suiteDb.name);
  } catch (err) {
    console.warn(`[SUITE TEARDOWN] Error dropping suite db ${suiteDb.name}:`, err);
  }
});

// Best-effort cleanup on process interrupt
const abortCleanup = async () => {
  try {
    await closeDb();
  } catch {
    // ignore
  }
  try {
    await dropDatabase(suiteDb.name);
  } catch {
    // ignore
  }
};
process.once("SIGINT", abortCleanup);
process.once("SIGTERM", abortCleanup);
