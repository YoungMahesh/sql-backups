import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import {
  backupSchedule,
  savedConnection,
  user as userTable,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { decrypt, parseConnectionString } from "@/lib/crypto";
import { validateScheduleInput } from "@/lib/schedule-validation";
import { nextRunAt } from "@/lib/cron";
import {
  parseSqliteErrorMessage,
  testSqliteConnection,
} from "@/lib/sqlite-connection";

export const runtime = "nodejs";

interface CreateScheduleBody {
  savedConnectionId?: string;
  databaseName?: string;
  cronExpression?: string;
  timezone?: string;
  retentionCount?: number;
}

async function resolveSavedSqliteConnection(
  userId: string,
  savedConnectionId: string
): Promise<
  | {
      ok: true;
      canonicalUri: string;
      displayHost: string;
      displayPort: number;
      database: string;
      authToken?: string;
    }
  | { ok: false; status: number; error: string }
> {
  const [saved] = await db
    .select()
    .from(savedConnection)
    .where(
      and(
        eq(savedConnection.id, savedConnectionId),
        eq(savedConnection.userId, userId),
        eq(savedConnection.engine, "sqlite")
      )
    )
    .limit(1);

  if (!saved) {
    return { ok: false, status: 404, error: "Saved SQLite connection not found." };
  }

  let canonicalUri: string;
  try {
    canonicalUri = decrypt(saved.encryptedConnectionString);
  } catch {
    return {
      ok: false,
      status: 500,
      error: "Could not decrypt saved connection credentials.",
    };
  }

  const parsed = parseConnectionString(canonicalUri);

  return {
    ok: true,
    canonicalUri,
    displayHost: saved.host || parsed.host,
    displayPort: saved.port || parsed.port || 443,
    database: saved.database || parsed.database || "main",
    authToken: parsed.authToken,
  };
}

async function verifySqliteConnectionAccessible(
  canonicalUri: string,
  authToken?: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  try {
    await testSqliteConnection(canonicalUri, authToken);
    return { ok: true };
  } catch (err) {
    const message = parseSqliteErrorMessage(err);
    return { ok: false, status: 502, error: message };
  }
}

/**
 * GET /api/sqlite/schedules
 * Returns all SQLite Scheduled Backups owned by the authenticated user, joined with
 * their Saved Connection info for display.
 */
export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to view schedules." },
        { status: 401 }
      );
    }

    const rows = await db
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
        connectionHost: savedConnection.host,
        connectionPort: savedConnection.port,
        connectionUsername: savedConnection.username,
        connectionEngine: savedConnection.engine,
      })
      .from(backupSchedule)
      .innerJoin(
        savedConnection,
        eq(savedConnection.id, backupSchedule.savedConnectionId)
      )
      .where(
        and(
          eq(backupSchedule.userId, session.user.id),
          eq(savedConnection.engine, "sqlite")
        )
      )
      .orderBy(desc(backupSchedule.createdAt));

    return NextResponse.json({ success: true, schedules: rows });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch SQLite schedules.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/sqlite/schedules
 * Creates a new Scheduled Backup for an SQLite database. Validates input,
 * confirms the saved connection is owned by the user and is an SQLite target,
 * verifies connectivity to the target database, and persists the schedule.
 */
export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to create schedules." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as CreateScheduleBody;
    const { savedConnectionId } = body;

    if (!savedConnectionId || typeof savedConnectionId !== "string") {
      return NextResponse.json(
        { error: "Saved connection ID is required." },
        { status: 400 }
      );
    }

    const validated = validateScheduleInput({
      cronExpression: body.cronExpression ?? "",
      timezone: body.timezone ?? "",
      databaseName: body.databaseName ?? "",
      retentionCount:
        typeof body.retentionCount === "number" ? body.retentionCount : NaN,
    });

    if (!validated.ok) {
      return NextResponse.json(
        { error: "Validation failed.", details: validated.errors },
        { status: 400 }
      );
    }

    const resolved = await resolveSavedSqliteConnection(
      session.user.id,
      savedConnectionId
    );
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status }
      );
    }

    const dbCheck = await verifySqliteConnectionAccessible(
      resolved.canonicalUri,
      resolved.authToken
    );
    if (!dbCheck.ok) {
      return NextResponse.json(
        { error: dbCheck.error },
        { status: dbCheck.status }
      );
    }

    let nextRun: Date | null;
    try {
      nextRun = nextRunAt(
        validated.value.cronExpression,
        validated.value.timezone
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not compute next run time.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const now = new Date();
    const scheduleId = crypto.randomUUID();

    try {
      await db.insert(backupSchedule).values({
        id: scheduleId,
        userId: session.user.id,
        savedConnectionId,
        databaseName: validated.value.databaseName,
        cronExpression: validated.value.cronExpression,
        timezone: validated.value.timezone,
        retentionCount: validated.value.retentionCount,
        enabled: true,
        nextRunAt: nextRun,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err: unknown) {
      const errorObj = err as { code?: string; cause?: { code?: string; message?: string } };
      const message =
        err instanceof Error ? err.message : "Failed to create SQLite schedule.";
      const causeMessage = errorObj?.cause?.message || "";
      const isUnique =
        errorObj?.code === "23505" ||
        errorObj?.cause?.code === "23505" ||
        /duplicate|unique/i.test(message) ||
        /duplicate|unique/i.test(causeMessage);

      if (isUnique) {
        return NextResponse.json(
          {
            error: `A schedule already exists for "${validated.value.databaseName}" on this connection.`,
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: message }, { status: 500 });
    }

    if (validated.value.timezone) {
      try {
        const [currentUser] = await db
          .select({ timezone: userTable.timezone })
          .from(userTable)
          .where(eq(userTable.id, session.user.id))
          .limit(1);
        if (!currentUser || currentUser.timezone !== validated.value.timezone) {
          await db
            .update(userTable)
            .set({ timezone: validated.value.timezone, updatedAt: now })
            .where(eq(userTable.id, session.user.id));
        }
      } catch (err) {
        console.warn(
          "Failed to update user.timezone alongside SQLite schedule creation:",
          err
        );
      }
    }

    const [created] = await db
      .select()
      .from(backupSchedule)
      .where(eq(backupSchedule.id, scheduleId))
      .limit(1);

    return NextResponse.json({ success: true, schedule: created }, { status: 201 });
  } catch (err: unknown) {
    console.error("SQLite schedule creation failed:", err);
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
