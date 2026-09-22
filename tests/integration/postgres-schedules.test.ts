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

describe("PostgreSQL Backup Schedules, Runner & Retention Integration", () => {
  async function createTestPostgresFixture() {
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "PG Schedule Test User",
      email: `${userId}@example.com`,
    });

    const connId = crypto.randomUUID();
    await db.insert(savedConnection).values({
      id: connId,
      userId: userId,
      host: "pg.staging.internal",
      port: 5432,
      username: "pguser",
      database: "crm_prod",
      engine: "postgres",
      encryptedConnectionString: encrypt(
        "postgresql://pguser:secret@pg.staging.internal:5432/crm_prod"
      ),
    });

    return { userId, connId };
  }

  it("creates and queries PostgreSQL scheduled backups with joined relations", async () => {
    const { userId, connId } = await createTestPostgresFixture();
    const scheduleId = crypto.randomUUID();
    const nextRun = new Date(Date.now() + 12 * 60 * 60 * 1000);

    // 1. Create schedule
    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId,
      savedConnectionId: connId,
      databaseName: "crm_prod",
      cronExpression: "30 3 * * *",
      timezone: "Europe/London",
      retentionCount: 10,
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
    expect(fetched.schedule.databaseName).toBe("crm_prod");
    expect(fetched.schedule.cronExpression).toBe("30 3 * * *");
    expect(fetched.schedule.timezone).toBe("Europe/London");
    expect(fetched.schedule.retentionCount).toBe(10);
    expect(fetched.schedule.enabled).toBe(true);
    expect(fetched.savedConnection.engine).toBe("postgres");
    expect(fetched.savedConnection.port).toBe(5432);
  });

  it("scheduler executes due PostgreSQL schedule, dispatches through runner, logs run record, and records engine", async () => {
    const { userId, connId } = await createTestPostgresFixture();
    const scheduleId = crypto.randomUUID();

    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId,
      savedConnectionId: connId,
      databaseName: "crm_prod",
      cronExpression: "0 1 * * *",
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

    // Mock runBackup to verify polymorphic dispatching
    const backupRunnerModule = await import("@/lib/backup-runner");
    const runBackupSpy = vi.spyOn(backupRunnerModule, "runBackup").mockResolvedValueOnce({
      s3Key: `backups/${userId}/crm_prod_2026-09-22T10-00-00-000Z.sql.gz`,
      sizeBytes: 8192,
    });

    await executeScheduledBackup(scheduleId, runId);

    expect(runBackupSpy).toHaveBeenCalledTimes(1);
    expect(runBackupSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "postgres",
        databaseName: "crm_prod",
        userId,
      })
    );

    // Verify backup_run was updated to success
    const [runRecord] = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.id, runId));

    expect(runRecord).toBeDefined();
    expect(runRecord.status).toBe("success");
    expect(runRecord.finishedAt).toBeInstanceOf(Date);
    expect(runRecord.backupId).toBeTruthy();

    // Verify database_backup was recorded with engine: 'postgres'
    const [createdBackup] = await db
      .select()
      .from(databaseBackup)
      .where(eq(databaseBackup.id, runRecord.backupId!));

    expect(createdBackup).toBeDefined();
    expect(createdBackup.engine).toBe("postgres");
    expect(createdBackup.databaseName).toBe("crm_prod");
    expect(createdBackup.host).toBe("pg.staging.internal");
    expect(createdBackup.port).toBe(5432);
    expect(createdBackup.sizeBytes).toBe(8192);

    runBackupSpy.mockRestore();
  });

  it("scheduler records failed status and error details when backup fails", async () => {
    const { userId, connId } = await createTestPostgresFixture();
    const scheduleId = crypto.randomUUID();

    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId,
      savedConnectionId: connId,
      databaseName: "crm_prod",
      cronExpression: "0 1 * * *",
      timezone: "UTC",
    });

    const runId = crypto.randomUUID();
    await db.insert(backupRun).values({
      id: runId,
      scheduleId,
      startedAt: new Date(),
      status: "running",
    });

    const backupRunnerModule = await import("@/lib/backup-runner");
    const runBackupSpy = vi
      .spyOn(backupRunnerModule, "runBackup")
      .mockRejectedValueOnce(new Error("Connection timeout to PostgreSQL server"));

    await executeScheduledBackup(scheduleId, runId);

    const [runRecord] = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.id, runId));

    expect(runRecord).toBeDefined();
    expect(runRecord.status).toBe("failed");
    expect(runRecord.errorMessage).toContain("Connection timeout to PostgreSQL server");
    expect(runRecord.finishedAt).toBeInstanceOf(Date);

    runBackupSpy.mockRestore();
  });

  it("enforces retention count by deleting older S3 dump objects, manifest sidecars, and database records", async () => {
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "Retention User",
      email: `${userId}@example.com`,
    });

    const deletedS3Keys: string[] = [];
    vi.spyOn(s3Module, "deleteBackupObject").mockImplementation(async (key: string) => {
      deletedS3Keys.push(key);
    });

    const baseTime = Date.now();
    const backupIds: string[] = [];

    // Create 4 backups for retentionCount = 2
    for (let i = 0; i < 4; i++) {
      const bId = crypto.randomUUID();
      backupIds.push(bId);
      await db.insert(databaseBackup).values({
        id: bId,
        userId,
        databaseName: "billing_pg",
        host: "pg.internal",
        port: 5432,
        engine: "postgres",
        s3Key: `backups/${userId}/billing_pg_2026-09-22T0${i}-00-00-000Z.sql.gz`,
        sizeBytes: 1000 + i,
        createdAt: new Date(baseTime + i * 60000),
      });
    }

    // Apply retention count 2
    await applyRetention(userId, "billing_pg", "pg.internal", 5432, 2, "postgres");

    // The two oldest backups (index 0 and 1) should be deleted
    const remainingBackups = await db
      .select()
      .from(databaseBackup)
      .where(
        and(
          eq(databaseBackup.userId, userId),
          eq(databaseBackup.databaseName, "billing_pg")
        )
      );

    expect(remainingBackups.length).toBe(2);
    const remainingIds = remainingBackups.map((b) => b.id);
    expect(remainingIds).toContain(backupIds[2]);
    expect(remainingIds).toContain(backupIds[3]);
    expect(remainingIds).not.toContain(backupIds[0]);
    expect(remainingIds).not.toContain(backupIds[1]);

    // Check S3 deletion: both .sql.gz and .manifest.json sidecars should be deleted
    expect(deletedS3Keys).toContain(
      `backups/${userId}/billing_pg_2026-09-22T00-00-00-000Z.sql.gz`
    );
    expect(deletedS3Keys).toContain(
      `backups/${userId}/billing_pg_2026-09-22T00-00-00-000Z.manifest.json`
    );
    expect(deletedS3Keys).toContain(
      `backups/${userId}/billing_pg_2026-09-22T01-00-00-000Z.sql.gz`
    );
    expect(deletedS3Keys).toContain(
      `backups/${userId}/billing_pg_2026-09-22T01-00-00-000Z.manifest.json`
    );
  });

  it("updates PostgreSQL schedule fields (cron, timezone, retention, enabled)", async () => {
    const { userId, connId } = await createTestPostgresFixture();
    const scheduleId = crypto.randomUUID();

    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId,
      savedConnectionId: connId,
      databaseName: "crm_prod",
      cronExpression: "0 0 * * *",
      timezone: "UTC",
      retentionCount: 7,
      enabled: true,
    });

    // Update fields
    await db
      .update(backupSchedule)
      .set({
        cronExpression: "0 4 * * 1",
        timezone: "America/New_York",
        retentionCount: 30,
        enabled: false,
        updatedAt: new Date(),
      })
      .where(eq(backupSchedule.id, scheduleId));

    const [updated] = await db
      .select()
      .from(backupSchedule)
      .where(eq(backupSchedule.id, scheduleId));

    expect(updated).toBeDefined();
    expect(updated.cronExpression).toBe("0 4 * * 1");
    expect(updated.timezone).toBe("America/New_York");
    expect(updated.retentionCount).toBe(30);
    expect(updated.enabled).toBe(false);
  });

  it("cascades deletion of PostgreSQL backup runs when schedule is deleted", async () => {
    const { userId, connId } = await createTestPostgresFixture();
    const scheduleId = crypto.randomUUID();

    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId,
      savedConnectionId: connId,
      databaseName: "crm_prod",
      cronExpression: "0 2 * * *",
      timezone: "UTC",
    });

    const runId = crypto.randomUUID();
    await db.insert(backupRun).values({
      id: runId,
      scheduleId,
      status: "success",
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    // Deleting schedule cascades to runs
    await db.delete(backupSchedule).where(eq(backupSchedule.id, scheduleId));

    const [deletedRun] = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.id, runId));

    expect(deletedRun).toBeUndefined();
  });

  it("correctly isolates MySQL and PostgreSQL schedules in joined queries", async () => {
    const { userId, connId: pgConnId } = await createTestPostgresFixture();
    const mysqlConnId = crypto.randomUUID();

    await db.insert(savedConnection).values({
      id: mysqlConnId,
      userId,
      host: "mysql.staging.internal",
      port: 3306,
      username: "myuser",
      database: "store_my",
      engine: "mysql",
      encryptedConnectionString: encrypt(
        "mysql://myuser:secret@mysql.staging.internal:3306/store_my"
      ),
    });

    const pgSchedId = crypto.randomUUID();
    const mySchedId = crypto.randomUUID();

    await db.insert(backupSchedule).values({
      id: pgSchedId,
      userId,
      savedConnectionId: pgConnId,
      databaseName: "crm_prod",
      cronExpression: "0 1 * * *",
      timezone: "UTC",
    });

    await db.insert(backupSchedule).values({
      id: mySchedId,
      userId,
      savedConnectionId: mysqlConnId,
      databaseName: "store_my",
      cronExpression: "0 2 * * *",
      timezone: "UTC",
    });

    // Query PostgreSQL schedules only
    const pgRows = await db
      .select({ id: backupSchedule.id, engine: savedConnection.engine })
      .from(backupSchedule)
      .innerJoin(
        savedConnection,
        eq(savedConnection.id, backupSchedule.savedConnectionId)
      )
      .where(
        and(
          eq(backupSchedule.userId, userId),
          eq(savedConnection.engine, "postgres")
        )
      );

    expect(pgRows.length).toBe(1);
    expect(pgRows[0].id).toBe(pgSchedId);
    expect(pgRows[0].engine).toBe("postgres");

    // Query MySQL schedules only
    const mysqlRows = await db
      .select({ id: backupSchedule.id, engine: savedConnection.engine })
      .from(backupSchedule)
      .innerJoin(
        savedConnection,
        eq(savedConnection.id, backupSchedule.savedConnectionId)
      )
      .where(
        and(
          eq(backupSchedule.userId, userId),
          eq(savedConnection.engine, "mysql")
        )
      );

    expect(mysqlRows.length).toBe(1);
    expect(mysqlRows[0].id).toBe(mySchedId);
    expect(mysqlRows[0].engine).toBe("mysql");
  });
});

