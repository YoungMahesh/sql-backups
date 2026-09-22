import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { backupRun, backupSchedule, savedConnection } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/postgres/schedules/[id]/runs
 * Returns recent Backup Run rows for the given PostgreSQL schedule, newest first.
 */
export async function GET(req: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to view runs." },
        { status: 401 }
      );
    }

    const { id } = await context.params;
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    let limit = 50;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 200) {
        limit = parsed;
      }
    }

    const [schedule] = await db
      .select({ id: backupSchedule.id })
      .from(backupSchedule)
      .innerJoin(
        savedConnection,
        eq(savedConnection.id, backupSchedule.savedConnectionId)
      )
      .where(
        and(
          eq(backupSchedule.id, id),
          eq(backupSchedule.userId, session.user.id),
          eq(savedConnection.engine, "postgres")
        )
      )
      .limit(1);

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
      .limit(limit);

    return NextResponse.json({ success: true, runs });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch PostgreSQL runs.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
