import { describe, it, expect } from "vitest";
import { db, closeDb } from "@/db";
import { user } from "@/db/schema";
import { sql } from "drizzle-orm";
import {
  getAdminClient,
  cloneSuiteDatabase,
  dropDatabase,
  sweepOrphanDatabases,
  getActiveTemplateDatabase,
} from "./db-admin";
import postgres from "postgres";

describe("Database Lifecycle & Isolation", () => {
  it("clones schema migrations from template into suite database", async () => {
    // Verify that all migrated application tables exist in the public schema
    const tables = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const tableNames = tables.map((t) => t.table_name);

    expect(tableNames).toContain("user");
    expect(tableNames).toContain("session");
    expect(tableNames).toContain("account");
    expect(tableNames).toContain("verification");
    expect(tableNames).toContain("saved_connection");
    expect(tableNames).toContain("database_backup");
    expect(tableNames).toContain("backup_schedule");
    expect(tableNames).toContain("backup_run");

    // Verify Drizzle migration tracking table exists
    const migrationTables = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_name = '__drizzle_migrations'`
    );
    expect(migrationTables.length).toBeGreaterThan(0);
  });

  it("verifies suite database isolation across separate clones", async () => {
    const suiteDbUrl = process.env.DATABASE_URL!;
    expect(suiteDbUrl).toContain("db_test_suite_");

    // Insert user in the current suite database
    const testUserId = `user_iso_${Date.now()}`;
    await db.insert(user).values({
      id: testUserId,
      name: "Isolation Test User",
      email: `${testUserId}@example.com`,
    });

    // Create a second isolated clone from the active template
    const templateDb = await getActiveTemplateDatabase();
    expect(templateDb).toBeDefined();

    const secondSuite = await cloneSuiteDatabase(templateDb!);
    const secondClient = postgres(secondSuite.url);

    try {
      // Query the second suite database to ensure user_iso does NOT exist there
      const rows = await secondClient`
        SELECT * FROM "user" WHERE id = ${testUserId}
      `;
      expect(rows.length).toBe(0);
    } finally {
      await secondClient.end({ timeout: 5 });
      await dropDatabase(secondSuite.name);
    }
  }, 20000);

  it("drains pool connections cleanly without hanging", async () => {
    // Verify closeDb() resolves cleanly
    await expect(closeDb()).resolves.toBeUndefined();
  });

  it("sweeps orphaned test databases older than 2 hours or malformed", async () => {
    const admin = getAdminClient();
    const oldTimestamp = Date.now() - 3 * 60 * 60 * 1000; // 3 hours ago (> 2-hour TTL)
    const oldDbName = `db_test_suite_${oldTimestamp}_old123`;
    const malformedDbName = `db_test_malformed_probe_xyz`;
    const recentDbName = `db_test_suite_${Date.now()}_rec123`;

    // Create the test databases
    await admin.unsafe(`CREATE DATABASE ${oldDbName};`);
    await admin.unsafe(`CREATE DATABASE ${malformedDbName};`);
    await admin.unsafe(`CREATE DATABASE ${recentDbName};`);

    try {
      // Run sweeper
      const swept = await sweepOrphanDatabases();

      expect(swept).toContain(oldDbName);
      expect(swept).toContain(malformedDbName);
      expect(swept).not.toContain(recentDbName);

      // Verify old and malformed databases were actually dropped
      const existing = await admin<{ datname: string }[]>`
        SELECT datname FROM pg_database WHERE datname IN (${oldDbName}, ${malformedDbName}, ${recentDbName})
      `;
      const existingNames = existing.map((r) => r.datname);
      expect(existingNames).not.toContain(oldDbName);
      expect(existingNames).not.toContain(malformedDbName);
      expect(existingNames).toContain(recentDbName);
    } finally {
      // Clean up the recent database
      await dropDatabase(recentDbName);
    }
  }, 20000);
});
