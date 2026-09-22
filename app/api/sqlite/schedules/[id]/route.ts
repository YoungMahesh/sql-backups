import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { backupRun, backupSchedule, savedConnection } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { validateScheduleInput } from "@/lib/schedule-validation";
import { nextRunAt } from "@/lib/cron";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface UpdateScheduleBody {
  cronExpression?: string;
  timezone?: string;
  retentionCount?: number;
  enabled?: boolean;
}

async function loadOwnedSqliteSchedule(userId: string, id: string) {
  const [row] = await db
    .select({
      id: backupSchedule.id,
      userId: backupSchedule.userId,
      savedConnectionId: backupSchedule.savedConnectionId,
      databaseName: backupSchedule.databaseName,
      cronExpression: backupSchedule.cronExpression,
      timezone: backupSchedule.timezone,
      retentionCount: backupSchedule.retentionCount,
      enabled: backupSchedule.enabled,
      lastRunAt: backupSchedule.lastRunAt,
      nextRunAt: backupSchedule.nextRunAt,
      createdAt: backupSchedule.createdAt,
      updatedAt: backupSchedule.updatedAt,
      connectionEngine: savedConnection.engine,
    })
    .from(backupSchedule)
    .innerJoin(
      savedConnection,
      eq(savedConnection.id, backupSchedule.savedConnectionId)
    )
    .where(
      and(
        eq(backupSchedule.id, id),
        eq(backupSchedule.userId, userId),
        eq(savedConnection.engine, "sqlite")
      )
    )
    .limit(1);

  return row ?? null;
}

/**
 * GET /api/sqlite/schedules/[id]
 * Returns a single SQLite schedule and its most recent runs.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to view schedules." },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const schedule = await loadOwnedSqliteSchedule(session.user.id, id);
    if (!schedule) {
      return NextResponse.json(
        { error: "Schedule not found." },
        { status: 404 }
      );
    }

    const runs = await db
      .select()
      .from(backupRun)
      .where(eq(backupRun.scheduleId, id))
      .orderBy(desc(backupRun.startedAt))
      .limit(20);

    return NextResponse.json({ success: true, schedule, runs });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch SQLite schedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/sqlite/schedules/[id]
 * Partially updates an SQLite schedule. Only enabled, cronExpression, timezone, and
 * retentionCount are mutable. Re-validates inputs and re-computes next_run_at
 * if the cron expression or timezone changes.
 */
export async function PATCH(req: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to update schedules." },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const existing = await loadOwnedSqliteSchedule(session.user.id, id);
    if (!existing) {
      return NextResponse.json(
        { error: "Schedule not found." },
        { status: 404 }
      );
    }

    const body = (await req.json()) as UpdateScheduleBody;
    const updates: Partial<typeof backupSchedule.$inferInsert> = {};

    if (body.cronExpression !== undefined || body.timezone !== undefined) {
      const targetTimezone = body.timezone ?? existing.timezone;
      const validated = validateScheduleInput({
        cronExpression: body.cronExpression ?? existing.cronExpression,
        timezone: targetTimezone,
        databaseName: existing.databaseName,
        retentionCount:
          body.retentionCount !== undefined
            ? body.retentionCount
            : existing.retentionCount,
      });
      if (!validated.ok) {
        return NextResponse.json(
          { error: "Validation failed.", details: validated.errors },
          { status: 400 }
        );
      }
      updates.cronExpression = validated.value.cronExpression;
      if (body.timezone !== undefined) {
        updates.timezone = validated.value.timezone;
      }

      let nextRun: Date | null;
      try {
        nextRun = nextRunAt(
          validated.value.cronExpression,
          validated.value.timezone
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not compute next run.";
        return NextResponse.json({ error: message }, { status: 400 });
      }
      updates.nextRunAt = nextRun;
    }

    if (body.retentionCount !== undefined) {
      const validated = validateScheduleInput({
        cronExpression: existing.cronExpression,
        timezone: "UTC",
        databaseName: existing.databaseName,
        retentionCount: body.retentionCount,
      });
      if (!validated.ok) {
        return NextResponse.json(
          { error: "Validation failed.", details: validated.errors },
          { status: 400 }
        );
      }
      updates.retentionCount = validated.value.retentionCount;
    }

    if (body.enabled !== undefined) {
      updates.enabled = !!body.enabled;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No updatable fields supplied." },
        { status: 400 }
      );
    }

    updates.updatedAt = new Date();

    await db
      .update(backupSchedule)
      .set(updates)
      .where(
        and(eq(backupSchedule.id, id), eq(backupSchedule.userId, session.user.id))
      );

    const [updated] = await db
      .select()
      .from(backupSchedule)
      .where(eq(backupSchedule.id, id))
      .limit(1);

    return NextResponse.json({ success: true, schedule: updated });
  } catch (err: unknown) {
    console.error("SQLite schedule update failed:", err);
    const message =
      err instanceof Error ? err.message : "Failed to update schedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/sqlite/schedules/[id]
 * Deletes the SQLite schedule. Cascades to backup_run rows.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to delete schedules." },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const existing = await loadOwnedSqliteSchedule(session.user.id, id);
    if (!existing) {
      return NextResponse.json(
        { error: "Schedule not found." },
        { status: 404 }
      );
    }

    await db
      .delete(backupSchedule)
      .where(
        and(eq(backupSchedule.id, id), eq(backupSchedule.userId, session.user.id))
      );

    return NextResponse.json({
      success: true,
      message: "Schedule deleted.",
    });
  } catch (err: unknown) {
    console.error("SQLite schedule deletion failed:", err);
    const message =
      err instanceof Error ? err.message : "Failed to delete schedule.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
