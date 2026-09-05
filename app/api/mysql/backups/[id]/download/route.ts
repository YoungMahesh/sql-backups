import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { databaseBackup } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getBackupDownloadUrl } from "@/lib/s3";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/mysql/backups/[id]/download
 * Returns a pre-signed S3 download URL for the requested backup.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to download backups." },
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
          eq(databaseBackup.userId, session.user.id)
        )
      )
      .limit(1);

    if (!backup) {
      return NextResponse.json(
        { error: "Backup record not found." },
        { status: 404 }
      );
    }

    const dateStr = backup.createdAt.toISOString().slice(0, 10);
    const downloadFilename = `${backup.databaseName}_${dateStr}.sql.gz`;

    const downloadUrl = await getBackupDownloadUrl(
      backup.s3Key,
      downloadFilename
    );

    return NextResponse.json({
      success: true,
      downloadUrl,
      filename: downloadFilename,
    });
  } catch (err: unknown) {
    console.error("Failed to generate backup download URL:", err);
    const message =
      err instanceof Error
        ? err.message
        : "Failed to generate backup download link.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
