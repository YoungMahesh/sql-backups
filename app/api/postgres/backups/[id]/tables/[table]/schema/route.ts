import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { NoSuchKey, S3ServiceException } from "@aws-sdk/client-s3";
import { loadOwnedBackup } from "@/lib/backup-ownership";
import { getBackupDumpStream } from "@/lib/s3";
import { extractTableSchema } from "@/lib/backup-parser";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string; table: string }>;
}

/**
 * GET /api/postgres/backups/[id]/tables/[table]/schema
 *
 * Streams the gzipped dump from S3, runs the parser, and returns the
 * matching `CREATE TABLE` SQL for `table` (which may be schema-qualified e.g. "public.users").
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to inspect backups." },
        { status: 401 }
      );
    }

    const { id, table } = await context.params;
    const decodedTable = decodeURIComponent(table);

    const backup = await loadOwnedBackup(session.user.id, id);
    if (!backup || backup.engine !== "postgres") {
      return NextResponse.json(
        { error: "Backup record not found." },
        { status: 404 }
      );
    }

    let stream;
    try {
      stream = await getBackupDumpStream(backup.s3Key);
    } catch (s3Err) {
      if (s3Err instanceof S3ServiceException && s3Err.name === NoSuchKey.name) {
        return NextResponse.json(
          { error: "Backup dump not found." },
          { status: 404 }
        );
      }
      throw s3Err;
    }

    const schema = await extractTableSchema(stream, decodedTable);
    if (schema === null) {
      return NextResponse.json(
        { error: "Table not found in backup." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      schema,
    });
  } catch (err: unknown) {
    console.error("Failed to fetch PostgreSQL table schema:", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch table schema.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
