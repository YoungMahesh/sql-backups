import { describe, it, expect } from "vitest";
import { db } from "@/db";
import { user, savedConnection, backupSchedule, backupRun } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import crypto from "node:crypto";

describe("Backup Schedules & Runs Integration", () => {
  async function createTestFixture() {
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "Schedule Test User",
      email: `${userId}@example.com`,
    });

    const connId = crypto.randomUUID();
    await db.insert(savedConnection).values({
      id: connId,
      userId: userId,
      host: "db.staging.internal",
      port: 3306,
      username: "appuser",
      database: "storefront",
      encryptedConnectionString: encrypt("mysql://appuser:secret@db.staging.internal:3306/storefront"),
    });

    return { userId, connId };
  }

  it("creates and queries scheduled backups with relations", async () => {
    const { userId, connId } = await createTestFixture();
    const scheduleId = crypto.randomUUID();

    const nextRun = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // 1. Create schedule
    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId,
      savedConnectionId: connId,
      databaseName: "storefront",
      cronExpression: "0 2 * * *",
      timezone: "America/New_York",
      retentionCount: 14,
      enabled: true,
      nextRunAt: nextRun,
    });

    // 2. Query schedule with relations
    const [fetched] = await db
      .select({
        schedule: backupSchedule,
        user,
        savedConnection,
      })
      .from(backupSchedule)
      .innerJoin(user, eq(backupSchedule.userId, user.id))
      .innerJoin(savedConnection, eq(backupSchedule.savedConnectionId, savedConnection.id))
      .where(eq(backupSchedule.id, scheduleId));

    expect(fetched).toBeDefined();
    expect(fetched.schedule.id).toBe(scheduleId);
    expect(fetched.schedule.databaseName).toBe("storefront");
    expect(fetched.schedule.cronExpression).toBe("0 2 * * *");
    expect(fetched.schedule.timezone).toBe("America/New_York");
    expect(fetched.schedule.retentionCount).toBe(14);
    expect(fetched.schedule.enabled).toBe(true);
    expect(fetched.user.id).toBe(userId);
    expect(fetched.savedConnection.id).toBe(connId);
  });

  it("creates backup runs and transitions statuses through lifecycle", async () => {
    const { userId, connId } = await createTestFixture();
    const scheduleId = crypto.randomUUID();

    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId,
      savedConnectionId: connId,
      databaseName: "storefront",
      cronExpression: "0 4 * * *",
      timezone: "UTC",
      retentionCount: 7,
      enabled: true,
    });

    const runId1 = crypto.randomUUID();
    const startTime1 = new Date();

    // 1. Start Run 1: running
    await db.insert(backupRun).values({
      id: runId1,
      scheduleId,
      status: "running",
      startedAt: startTime1,
    });

    const [run1] = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.id, runId1));
    expect(run1.status).toBe("running");
    expect(run1.finishedAt).toBeNull();

    // 2. Complete Run 1: completed
    const finishTime1 = new Date();
    await db
      .update(backupRun)
      .set({
        status: "completed",
        finishedAt: finishTime1,
      })
      .where(eq(backupRun.id, runId1));

    const [completedRun1] = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.id, runId1));
    expect(completedRun1.status).toBe("completed");
    expect(completedRun1.finishedAt).toBeInstanceOf(Date);

    // 3. Start Run 2: running -> failed
    const runId2 = crypto.randomUUID();
    await db.insert(backupRun).values({
      id: runId2,
      scheduleId,
      status: "running",
      startedAt: new Date(),
    });

    await db
      .update(backupRun)
      .set({
        status: "failed",
        errorMessage: "Network timeout connecting to MySQL target",
        finishedAt: new Date(),
      })
      .where(eq(backupRun.id, runId2));

    const [failedRun2] = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.id, runId2));
    expect(failedRun2.status).toBe("failed");
    expect(failedRun2.errorMessage).toBe("Network timeout connecting to MySQL target");

    // 4. Query all runs for schedule
    const allRuns = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.scheduleId, scheduleId));
    expect(allRuns.length).toBe(2);
  });

  it("cascades deletions when parent schedule, connection, or user is deleted", async () => {
    const { userId, connId } = await createTestFixture();
    const scheduleId = crypto.randomUUID();

    await db.insert(backupSchedule).values({
      id: scheduleId,
      userId,
      savedConnectionId: connId,
      databaseName: "storefront",
      cronExpression: "0 0 * * *",
      timezone: "UTC",
    });

    const runId = crypto.randomUUID();
    await db.insert(backupRun).values({
      id: runId,
      scheduleId,
      status: "completed",
      startedAt: new Date(),
      finishedAt: new Date(),
    });

    // Verify run exists
    const [existingRun] = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.id, runId));
    expect(existingRun).toBeDefined();

    // 1. Deleting schedule cascades to its backup runs
    await db.delete(backupSchedule).where(eq(backupSchedule.id, scheduleId));

    const [cascadedRun] = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.id, runId));
    expect(cascadedRun).toBeUndefined();

    // 2. Create another schedule and test cascading from savedConnection
    const scheduleId2 = crypto.randomUUID();
    await db.insert(backupSchedule).values({
      id: scheduleId2,
      userId,
      savedConnectionId: connId,
      databaseName: "storefront_archive",
      cronExpression: "0 1 * * *",
      timezone: "UTC",
    });

    await db.delete(savedConnection).where(eq(savedConnection.id, connId));

    const [cascadedSchedule] = await db
      .select()
      .from(backupSchedule)
      .where(eq(backupSchedule.id, scheduleId2));
    expect(cascadedSchedule).toBeUndefined();

    // 3. Deleting user cascades all related entities
    await db.delete(user).where(eq(user.id, userId));
    const [deletedUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId));
    expect(deletedUser).toBeUndefined();
  });
});
