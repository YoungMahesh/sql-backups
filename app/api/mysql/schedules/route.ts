import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import mysql, { type Connection, type ConnectionOptions } from "mysql2/promise";
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

export const runtime = "nodejs";

interface CreateScheduleBody {
  savedConnectionId?: string;
  databaseName?: string;
  cronExpression?: string;
  timezone?: string;
  retentionCount?: number;
}

async function resolveSavedConnection(
  userId: string,
  savedConnectionId: string
): Promise<
  | {
      ok: true;
      connectionOptions: ConnectionOptions;
      displayHost: string;
      displayPort: number;
    }
  | { ok: false; status: number; error: string }
> {
  const [saved] = await db
    .select()
    .from(savedConnection)
    .where(
      and(
        eq(savedConnection.id, savedConnectionId),
        eq(savedConnection.userId, userId)
      )
    )
    .limit(1);

  if (!saved) {
    return { ok: false, status: 404, error: "Saved connection not found." };
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
    connectionOptions: { uri: canonicalUri, connectTimeout: 10000 },
    displayHost: parsed.host,
    displayPort: parsed.port,
  };
}

async function verifyDatabaseExists(
  connectionOptions: ConnectionOptions,
  databaseName: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  let conn: Connection | null = null;
  try {
    conn = await mysql.createConnection(connectionOptions);
    const [rows] = await conn.query(
      "SHOW DATABASES LIKE ?",
      [databaseName]
    );
    const matches = Array.isArray(rows) && rows.length > 0;
    if (!matches) {
      return {
        ok: false,
        status: 400,
        error: `Database "${databaseName}" does not exist on the target server.`,
      };
    }
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not connect to target server.";
    return { ok: false, status: 502, error: message };
  } finally {
    if (conn) {
      try {
        await conn.end();
      } catch {
        // Ignore close errors
      }
    }
  }
}

/**
 * GET /api/mysql/schedules
 * Returns all Scheduled Backups owned by the authenticated user, joined with
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
      })
      .from(backupSchedule)
      .innerJoin(
        savedConnection,
        eq(savedConnection.id, backupSchedule.savedConnectionId)
      )
      .where(eq(backupSchedule.userId, session.user.id))
      .orderBy(desc(backupSchedule.createdAt));

    return NextResponse.json({ success: true, schedules: rows });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch schedules.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/mysql/schedules
 * Creates a new Scheduled Backup. Validates input, confirms the saved connection
 * is owned by the user, confirms the database exists on the target server, and
 * persists the schedule with a computed next_run_at.
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

    const resolved = await resolveSavedConnection(
      session.user.id,
      savedConnectionId
    );
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status }
      );
    }

    const dbCheck = await verifyDatabaseExists(
      resolved.connectionOptions,
      validated.value.databaseName
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
      const message =
        err instanceof Error ? err.message : "Failed to create schedule.";
      if (/duplicate|unique/i.test(message)) {
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
          "Failed to update user.timezone alongside schedule creation:",
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
    console.error("Schedule creation failed:", err);
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
