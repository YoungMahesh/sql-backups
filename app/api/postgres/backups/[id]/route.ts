import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { databaseBackup } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { deleteBackupObject } from "@/lib/s3";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * DELETE /api/postgres/backups/[id]
 * Deletes the backup from S3 storage and removes the record from the database.
 */
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to delete backups." },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    const [backup] = await db
      .select()
      .from(databaseBackup)
      .where(
        and(
          eq(databaseBackup.id, id),
          eq(databaseBackup.userId, session.user.id),
          eq(databaseBackup.engine, "postgres")
        )
      )
      .limit(1);

    if (!backup) {
      return NextResponse.json(
        { error: "Backup record not found." },
        { status: 404 }
      );
    }

    // Attempt to delete object from S3 storage
    try {
      await deleteBackupObject(backup.s3Key);
    } catch (s3Err) {
      console.warn(
        `Could not delete S3 object ${backup.s3Key}, continuing database deletion:`,
        s3Err
      );
    }

    // Delete record from database
    await db
      .delete(databaseBackup)
      .where(
        and(
          eq(databaseBackup.id, id),
          eq(databaseBackup.userId, session.user.id)
        )
      );

    return NextResponse.json({
      success: true,
      message: "Database backup deleted successfully.",
    });
  } catch (err: unknown) {
    console.error("Failed to delete PostgreSQL backup:", err);
    const message =
      err instanceof Error ? err.message : "Failed to delete database backup.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
