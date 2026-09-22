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
import { decrypt } from "@/lib/crypto";
import { validateScheduleInput } from "@/lib/schedule-validation";
import { nextRunAt } from "@/lib/cron";
import {
  listPostgresUserDatabases,
  parsePostgresErrorMessage,
} from "@/lib/postgres-connection";

export const runtime = "nodejs";

interface CreateScheduleBody {
  savedConnectionId?: string;
  databaseName?: string;
  cronExpression?: string;
  timezone?: string;
  retentionCount?: number;
}

async function resolveSavedPostgresConnection(
  userId: string,
  savedConnectionId: string
): Promise<
  | {
      ok: true;
      canonicalUri: string;
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
        eq(savedConnection.userId, userId),
        eq(savedConnection.engine, "postgres")
      )
    )
    .limit(1);

  if (!saved) {
    return { ok: false, status: 404, error: "Saved PostgreSQL connection not found." };
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

  return {
    ok: true,
    canonicalUri,
    displayHost: saved.host,
    displayPort: saved.port,
  };
}

async function verifyPostgresDatabaseExists(
  canonicalUri: string,
  databaseName: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  try {
    const { databases } = await listPostgresUserDatabases(canonicalUri);
    const matches = databases.includes(databaseName);
    if (!matches) {
      return {
        ok: false,
        status: 400,
        error: `Database "${databaseName}" does not exist on the target PostgreSQL server.`,
      };
    }
    return { ok: true };
  } catch (err) {
    const message = parsePostgresErrorMessage(err);
    return { ok: false, status: 502, error: message };
  }
}

/**
 * GET /api/postgres/schedules
 * Returns all PostgreSQL Scheduled Backups owned by the authenticated user, joined with
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
          eq(savedConnection.engine, "postgres")
        )
      )
      .orderBy(desc(backupSchedule.createdAt));

    return NextResponse.json({ success: true, schedules: rows });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch PostgreSQL schedules.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/postgres/schedules
 * Creates a new Scheduled Backup for a PostgreSQL database. Validates input,
 * confirms the saved connection is owned by the user and is a PostgreSQL target,
 * verifies the database exists on the target server, and persists the schedule.
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

    const resolved = await resolveSavedPostgresConnection(
      session.user.id,
      savedConnectionId
    );
    if (!resolved.ok) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status }
      );
    }

    const dbCheck = await verifyPostgresDatabaseExists(
      resolved.canonicalUri,
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
      const errorObj = err as { code?: string; cause?: { code?: string; message?: string } };
      const message =
        err instanceof Error ? err.message : "Failed to create PostgreSQL schedule.";
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
          "Failed to update user.timezone alongside PostgreSQL schedule creation:",
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
    console.error("PostgreSQL schedule creation failed:", err);
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
