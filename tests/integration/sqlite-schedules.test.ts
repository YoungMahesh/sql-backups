import { describe, it, expect, vi } from "vitest";
import { db } from "@/db";
import {
  user,
  savedConnection,
  backupSchedule,
  backupRun,
  databaseBackup,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { executeScheduledBackup, applyRetention } from "@/lib/scheduler";
import * as s3Module from "@/lib/s3";
import crypto from "node:crypto";

describe("SQLite Backup Schedules, Runner & Retention Integration", () => {
  async function createTestSqliteFixture() {
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "SQLite Schedule Test User",
      email: `${userId}@example.com`,
    });

    const connId = crypto.randomUUID();
    await db.insert(savedConnection).values({
      id: connId,
      userId: userId,
      host: "my-app.turso.io",
      port: 443,
      username: "token",
      database: "main",
      engine: "sqlite",
      encryptedConnectionString: encrypt(
        "libsql://my-app.turso.io?authToken=test-token-123"
      ),
    });

    return { userId, connId };
  }

  it("creates and queries SQLite scheduled backups with joined relations", async () => {
    const { userId, connId } = await createTestSqliteFixture();
    const scheduleId = crypto.randomUUID();
    const nextRun = new Date(Date.now() + 6 * 60 * 60 * 1000);

    // 1. Create schedule
    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId,
      savedConnectionId: connId,
      databaseName: "main",
      cronExpression: "0 4 * * *",
      timezone: "America/New_York",
      retentionCount: 7,
      enabled: true,
      nextRunAt: nextRun,
    });

    // 2. Query schedule joined with savedConnection
    const [fetched] = await db
      .select({
        schedule: backupSchedule,
        savedConnection,
      })
      .from(backupSchedule)
      .innerJoin(
        savedConnection,
        eq(backupSchedule.savedConnectionId, savedConnection.id)
      )
      .where(eq(backupSchedule.id, scheduleId));

    expect(fetched).toBeDefined();
    expect(fetched.schedule.id).toBe(scheduleId);
    expect(fetched.schedule.databaseName).toBe("main");
    expect(fetched.schedule.cronExpression).toBe("0 4 * * *");
    expect(fetched.schedule.timezone).toBe("America/New_York");
    expect(fetched.schedule.retentionCount).toBe(7);
    expect(fetched.schedule.enabled).toBe(true);
    expect(fetched.savedConnection.engine).toBe("sqlite");
    expect(fetched.savedConnection.host).toBe("my-app.turso.io");
  });

  it("scheduler executes due SQLite schedule, dispatches through runner, logs run record, and records engine", async () => {
    const { userId, connId } = await createTestSqliteFixture();
    const scheduleId = crypto.randomUUID();

    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId,
      savedConnectionId: connId,
      databaseName: "main",
      cronExpression: "0 2 * * *",
      timezone: "UTC",
      retentionCount: 5,
      enabled: true,
    });

    const runId = crypto.randomUUID();
    await db.insert(backupRun).values({
      id: runId,
      scheduleId,
      startedAt: new Date(),
      status: "running",
    });

    // Mock runner to simulate successful SQLite backup
    const s3Key = `backups/${userId}/main_2026-09-22T02-00-00.sql.gz`;
    const runnerModule = await import("@/lib/backup-runner");
    const runBackupSpy = vi.spyOn(runnerModule, "runBackup").mockResolvedValue({
      s3Key,
      sizeBytes: 1048576,
    });

    await executeScheduledBackup(scheduleId, runId);

    expect(runBackupSpy).toHaveBeenCalledTimes(1);
    expect(runBackupSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "sqlite",
        databaseName: "main",
        userId,
      })
    );

    // Verify backup_run row is updated to success
    const [run] = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.id, runId));

    expect(run).toBeDefined();
    expect(run.status).toBe("success");
    expect(run.finishedAt).not.toBeNull();
    expect(run.backupId).not.toBeNull();

    // Verify database_backup row is recorded with engine = "sqlite"
    const [backup] = await db
      .select()
      .from(databaseBackup)
      .where(eq(databaseBackup.id, run.backupId!));

    expect(backup).toBeDefined();
    expect(backup.userId).toBe(userId);
    expect(backup.databaseName).toBe("main");
    expect(backup.engine).toBe("sqlite");
    expect(backup.s3Key).toBe(s3Key);
    expect(backup.sizeBytes).toBe(1048576);

    runBackupSpy.mockRestore();
  });

  it("applies retention pruning correctly to SQLite backups", async () => {
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "SQLite Retention User",
      email: `${userId}@example.com`,
    });

    const host = "retention-test.turso.io";
    const port = 443;
    const dbName = "app_prod";

    // Insert 4 backups with timestamps spaced 1 hour apart
    const baseTime = Date.now() - 4 * 60 * 60 * 1000;
    const backupIds: string[] = [];

    for (let i = 0; i < 4; i++) {
      const id = crypto.randomUUID();
      backupIds.push(id);
      await db.insert(databaseBackup).values({
        id,
        userId,
        databaseName: dbName,
        host,
        port,
        engine: "sqlite",
        s3Key: `backups/${userId}/sqlite_retention_${i}.sql.gz`,
        sizeBytes: 1024,
        createdAt: new Date(baseTime + i * 60 * 60 * 1000),
      });
    }

    const deleteSpy = vi.spyOn(s3Module, "deleteBackupObject").mockResolvedValue(undefined);

    // Retain only 2 backups
    await applyRetention(userId, dbName, host, port, 2, "sqlite");

    // The oldest 2 should be deleted
    expect(deleteSpy).toHaveBeenCalledWith(`backups/${userId}/sqlite_retention_0.sql.gz`);
    expect(deleteSpy).toHaveBeenCalledWith(`backups/${userId}/sqlite_retention_1.sql.gz`);

    // Verify remaining backups in DB
    const remaining = await db
      .select({ id: databaseBackup.id })
      .from(databaseBackup)
      .where(
        and(
          eq(databaseBackup.userId, userId),
          eq(databaseBackup.databaseName, dbName),
          eq(databaseBackup.engine, "sqlite")
        )
      );

    expect(remaining.length).toBe(2);
    const remainingIds = remaining.map((r) => r.id);
    expect(remainingIds).toContain(backupIds[2]);
    expect(remainingIds).toContain(backupIds[3]);

    deleteSpy.mockRestore();
  });
});
