import crypto from "node:crypto";
import { and, asc, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import {
  backupRun,
  backupSchedule,
  databaseBackup,
  savedConnection,
} from "@/db/schema";
import { decrypt, parseConnectionString } from "@/lib/crypto";
import { runBackup } from "@/lib/backup-runner";
import { deleteBackupObject } from "@/lib/s3";
import { deriveManifestKey } from "@/lib/manifest";
import { nextRunAt } from "@/lib/cron";

const TICK_INTERVAL_MS = 60_000;
const STUCK_RUN_THRESHOLD_MS = 2 * 60 * 60 * 1000;

declare global {
  var __backup_scheduler_started: boolean | undefined;
}

export async function executeScheduledBackup(scheduleId: string, runId: string): Promise<void> {
  const [schedule] = await db
    .select()
    .from(backupSchedule)
    .where(eq(backupSchedule.id, scheduleId))
    .limit(1);

  if (!schedule) {
    await failRun(runId, "schedule_not_found");
    return;
  }

  const [connection] = await db
    .select()
    .from(savedConnection)
    .where(eq(savedConnection.id, schedule.savedConnectionId))
    .limit(1);

  if (!connection) {
    await failRun(runId, "saved_connection_not_found");
    return;
  }

  let canonicalUri: string;
  try {
    canonicalUri = decrypt(connection.encryptedConnectionString);
  } catch (err) {
    await failRun(runId, `decrypt_failed: ${describeError(err)}`);
    return;
  }

  const parsed = parseConnectionString(canonicalUri);
  const engine = connection.engine ?? parsed.engine ?? "mysql";

  let backupResult;
  try {
    backupResult = await runBackup({
      engine,
      databaseName: schedule.databaseName,
      userId: schedule.userId,
      connectionOptions: {
        uri: canonicalUri,
        connectTimeout: 15000,
      },
    });
  } catch (err) {
    await failRun(runId, describeError(err));
    return;
  }

  const backupId = crypto.randomUUID();
  const now = new Date();

  try {
    await db.insert(databaseBackup).values({
      id: backupId,
      userId: schedule.userId,
      databaseName: schedule.databaseName,
      host: parsed.host,
      port: parsed.port,
      engine,
      s3Key: backupResult.s3Key,
      sizeBytes: backupResult.sizeBytes,
      createdAt: now,
    });

    await db
      .update(backupRun)
      .set({
        status: "success",
        finishedAt: now,
        backupId,
      })
      .where(eq(backupRun.id, runId));
  } catch (err) {
    await failRun(runId, `persist_failed: ${describeError(err)}`);
    return;
  }

  await applyRetention(
    schedule.userId,
    schedule.databaseName,
    parsed.host,
    parsed.port,
    schedule.retentionCount,
    engine
  );
}

export async function failRun(runId: string, errorMessage: string): Promise<void> {
  try {
    await db
      .update(backupRun)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: errorMessage.slice(0, 4000),
      })
      .where(eq(backupRun.id, runId));
  } catch (err) {
    console.error(`[backup-scheduler] failed to mark run ${runId} as failed:`, err);
  }
}

export async function applyRetention(
  userId: string,
  databaseName: string,
  host: string,
  port: number,
  retentionCount: number,
  engine?: "mysql" | "postgres" | "sqlite"
): Promise<void> {
  const conditions = [
    eq(databaseBackup.userId, userId),
    eq(databaseBackup.databaseName, databaseName),
    eq(databaseBackup.host, host),
    eq(databaseBackup.port, port),
  ];
  if (engine) {
    conditions.push(eq(databaseBackup.engine, engine));
  }

  const allBackups = await db
    .select({ id: databaseBackup.id, s3Key: databaseBackup.s3Key, createdAt: databaseBackup.createdAt })
    .from(databaseBackup)
    .where(and(...conditions))
    .orderBy(asc(databaseBackup.createdAt));

  if (allBackups.length <= retentionCount) return;

  const toDelete = allBackups.slice(0, allBackups.length - retentionCount);
  for (const row of toDelete) {
    try {
      await deleteBackupObject(row.s3Key);
    } catch (err) {
      console.warn(
        `[backup-scheduler] failed to delete S3 object ${row.s3Key}:`,
        err
      );
    }

    const manifestKey = deriveManifestKey(row.s3Key);
    if (manifestKey) {
      try {
        await deleteBackupObject(manifestKey);
      } catch (err) {
        console.warn(
          `[backup-scheduler] failed to delete S3 manifest ${manifestKey}:`,
          err
        );
      }
    }

    try {
      await db.delete(databaseBackup).where(eq(databaseBackup.id, row.id));
    } catch (err) {
      console.error(
        `[backup-scheduler] failed to delete backup row ${row.id}:`,
        err
      );
    }
  }
}

export async function processSchedule(schedule: typeof backupSchedule.$inferSelect): Promise<void> {
  const runId = crypto.randomUUID();
  const now = new Date();

  const twoHoursAgo = new Date(now.getTime() - STUCK_RUN_THRESHOLD_MS);
  const [running] = await db
    .select({ id: backupRun.id })
    .from(backupRun)
    .where(
      and(
        eq(backupRun.scheduleId, schedule.id),
        eq(backupRun.status, "running"),
        gt(backupRun.startedAt, twoHoursAgo)
      )
    )
    .limit(1);

  if (running) {
    try {
      await db.insert(backupRun).values({
        id: runId,
        scheduleId: schedule.id,
        startedAt: now,
        finishedAt: now,
        status: "skipped",
        skipReason: "previous_still_running",
      });
    } catch (err) {
      console.error(`[backup-scheduler] failed to insert skip row for ${schedule.id}:`, err);
    }
    await advanceSchedule(schedule);
    return;
  }

  try {
    await db.insert(backupRun).values({
      id: runId,
      scheduleId: schedule.id,
      startedAt: now,
      status: "running",
    });
  } catch (err) {
    console.error(`[backup-scheduler] failed to insert running row for ${schedule.id}:`, err);
    return;
  }

  await advanceSchedule(schedule);

  void executeScheduledBackup(schedule.id, runId).catch((err) => {
    console.error(`[backup-scheduler] unhandled error in backup for ${schedule.id}:`, err);
  });
}

async function advanceSchedule(schedule: typeof backupSchedule.$inferSelect): Promise<void> {
  const now = new Date();
  let nextRun: Date | null = null;
  try {
    nextRun = nextRunAt(schedule.cronExpression, schedule.timezone, now);
  } catch {
    // The PATCH endpoint validates cron; we fall back to advancing by 1 hour
    nextRun = new Date(now.getTime() + 60 * 60 * 1000);
  }

  try {
    await db
      .update(backupSchedule)
      .set({ lastRunAt: now, nextRunAt: nextRun, updatedAt: now })
      .where(eq(backupSchedule.id, schedule.id));
  } catch (err) {
    console.error(`[backup-scheduler] failed to advance schedule ${schedule.id}:`, err);
  }
}

async function recoverOrphanedRuns(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STUCK_RUN_THRESHOLD_MS);
    await db
      .update(backupRun)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: "orphaned_after_restart",
      })
      .where(
        and(eq(backupRun.status, "running"), lt(backupRun.startedAt, cutoff))
      );
  } catch (err) {
    console.error("[backup-scheduler] failed to recover orphaned runs:", err);
  }
}

export async function tick(): Promise<void> {
  await recoverOrphanedRuns();

  const now = new Date();
  let dueSchedules: Array<typeof backupSchedule.$inferSelect>;
  try {
    dueSchedules = await db
      .select()
      .from(backupSchedule)
      .where(
        and(eq(backupSchedule.enabled, true), lt(backupSchedule.nextRunAt, now))
      );
  } catch (err) {
    console.error("[backup-scheduler] failed to query due schedules:", err);
    return;
  }

  for (const schedule of dueSchedules) {
    try {
      await processSchedule(schedule);
    } catch (err) {
      console.error(`[backup-scheduler] tick failed for schedule ${schedule.id}:`, err);
    }
  }
}

export function startScheduler(): void {
  if (globalThis.__backup_scheduler_started) return;
  globalThis.__backup_scheduler_started = true;

  console.log("[backup-scheduler] starting in-process scheduler (60s tick)");

  void tick().catch((err) => {
    console.error("[backup-scheduler] initial tick failed:", err);
  });

  setInterval(() => {
    void tick().catch((err) => {
      console.error("[backup-scheduler] tick failed:", err);
    });
  }, TICK_INTERVAL_MS);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
