import { describe, it, expect } from "vitest";
import { db } from "@/db";
import {
  user,
  savedConnection,
  backupSchedule,
  backupRun,
  databaseBackup,
} from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { formatManifest, parseManifest, type BackupManifest } from "@/lib/manifest";
import crypto from "node:crypto";

describe("Database Backups & Manifest Inspection Integration", () => {
  async function createTestUser() {
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "Backup Test User",
      email: `${userId}@example.com`,
    });
    return userId;
  }

  it("persists and queries database backup metadata records", async () => {
    const userId = await createTestUser();
    const backupId = crypto.randomUUID();
    const s3Key = `backups/${userId}/prod_db_2026-09-22T08-00-00-000Z.sql.gz`;
    const sizeBytes = 25 * 1024 * 1024; // 25 MB

    // 1. Insert backup record
    await db.insert(databaseBackup).values({
      id: backupId,
      userId,
      databaseName: "prod_db",
      host: "mysql.prod.internal",
      port: 3306,
      s3Key,
      sizeBytes,
    });

    // 2. Query backup record by id
    const [fetched] = await db
      .select()
      .from(databaseBackup)
      .where(eq(databaseBackup.id, backupId));

    expect(fetched).toBeDefined();
    expect(fetched.id).toBe(backupId);
    expect(fetched.userId).toBe(userId);
    expect(fetched.databaseName).toBe("prod_db");
    expect(fetched.host).toBe("mysql.prod.internal");
    expect(fetched.port).toBe(3306);
    expect(fetched.s3Key).toBe(s3Key);
    expect(fetched.sizeBytes).toBe(sizeBytes);
    expect(fetched.createdAt).toBeInstanceOf(Date);

    // 3. Query backups by user and databaseName ordered by createdAt desc
    const list = await db
      .select()
      .from(databaseBackup)
      .where(
        and(
          eq(databaseBackup.userId, userId),
          eq(databaseBackup.databaseName, "prod_db")
        )
      )
      .orderBy(desc(databaseBackup.createdAt));

    expect(list.length).toBe(1);
    expect(list[0].id).toBe(backupId);
  });

  it("links backup runs to database backups and respects set null on delete", async () => {
    const userId = await createTestUser();

    // 1. Create connection and schedule
    const connId = crypto.randomUUID();
    await db.insert(savedConnection).values({
      id: connId,
      userId,
      host: "mysql.prod.internal",
      port: 3306,
      username: "root",
      encryptedConnectionString: encrypt("mysql://root:pass@mysql.prod.internal:3306"),
    });

    const scheduleId = crypto.randomUUID();
    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId,
      savedConnectionId: connId,
      databaseName: "ecommerce",
      cronExpression: "0 1 * * *",
      timezone: "UTC",
    });

    // 2. Create database backup
    const backupId = crypto.randomUUID();
    await db.insert(databaseBackup).values({
      id: backupId,
      userId,
      databaseName: "ecommerce",
      host: "mysql.prod.internal",
      port: 3306,
      s3Key: `backups/${userId}/ecommerce_dump.sql.gz`,
      sizeBytes: 1048576,
    });

    // 3. Create backup run linked to the backup
    const runId = crypto.randomUUID();
    await db.insert(backupRun).values({
      id: runId,
      scheduleId,
      status: "completed",
      backupId,
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    // 4. Verify relation lookup
    const [runWithBackup] = await db
      .select({
        run: backupRun,
        backup: databaseBackup,
      })
      .from(backupRun)
      .leftJoin(databaseBackup, eq(backupRun.backupId, databaseBackup.id))
      .where(eq(backupRun.id, runId));

    expect(runWithBackup).toBeDefined();
    expect(runWithBackup.run.backupId).toBe(backupId);
    expect(runWithBackup.backup?.id).toBe(backupId);
    expect(runWithBackup.backup?.databaseName).toBe("ecommerce");

    // 5. Delete the database backup; backupRun.backupId must become null (onDelete: "set null")
    await db.delete(databaseBackup).where(eq(databaseBackup.id, backupId));

    const [updatedRun] = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.id, runId));

    expect(updatedRun).toBeDefined();
    expect(updatedRun.backupId).toBeNull();
  });

  it("verifies backup manifest inspection records and data integrity", async () => {
    const userId = await createTestUser();
    const backupId = crypto.randomUUID();
    const dumpKey = `backups/${userId}/analytics_2026-09-22T08-00-00-000Z.sql.gz`;

    // Construct a backup manifest
    const manifest: BackupManifest = {
      version: 1,
      uncompressedSizeBytes: 52428800, // 50 MB
      tables: [
        { name: "events", rowCount: 150000 },
        { name: "users", rowCount: 4200 },
        { name: "sessions", rowCount: 89000 },
      ],
    };

    // Serialize manifest
    const manifestBytes = formatManifest(manifest);
    expect(manifestBytes.length).toBeGreaterThan(0);

    // Round-trip parse manifest
    const parsed = parseManifest(manifestBytes);
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe(1);
    expect(parsed?.tables.length).toBe(3);
    expect(parsed?.uncompressedSizeBytes).toBe(52428800);

    // Save backup metadata record
    await db.insert(databaseBackup).values({
      id: backupId,
      userId,
      databaseName: "analytics",
      host: "analytics-db.prod",
      port: 3306,
      s3Key: dumpKey,
      sizeBytes: 12582912, // compressed 12 MB
    });

    const [savedRecord] = await db
      .select()
      .from(databaseBackup)
      .where(eq(databaseBackup.id, backupId));

    expect(savedRecord.databaseName).toBe("analytics");
    expect(savedRecord.sizeBytes).toBe(12582912);
  });
});
