import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { fetchBackupManifest } from "@/lib/s3";
import { parseManifest } from "@/lib/manifest";
import { loadOwnedBackup } from "@/lib/backup-ownership";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/mysql/backups/[id]/manifest
 *
 * Returns the Backup Manifest sibling JSON for the requested Database Backup,
 * or 404 `manifest_unavailable` when the backup exists but has no manifest
 * (predates the inspection feature or manifest upload failed at backup time).
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

    const { id } = await context.params;

    const backup = await loadOwnedBackup(session.user.id, id);
    if (!backup) {
      return NextResponse.json(
        { error: "Backup record not found." },
        { status: 404 }
      );
    }

    const manifestBytes = await fetchBackupManifest(backup.s3Key);
    if (!manifestBytes) {
      return NextResponse.json(
        { error: "manifest_unavailable" },
        { status: 404 }
      );
    }

    const manifest = parseManifest(manifestBytes);
    if (!manifest) {
      return NextResponse.json(
        { error: "manifest_unavailable" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      manifest,
    });
  } catch (err: unknown) {
    console.error("Failed to fetch backup manifest:", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch backup manifest.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
