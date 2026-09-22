import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { fetchBackupManifest, getBackupRawUrl } from "@/lib/s3";
import { parseManifest } from "@/lib/manifest";
import { loadOwnedBackup } from "@/lib/backup-ownership";

export const runtime = "nodejs";

const MAX_RAW_VIEW_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/sqlite/backups/[id]/raw-url
 *
 * Checks whether the uncompressed backup size is within the 50 MB browser
 * viewer limit. If allowed, generates and returns a pre-signed S3 URL without
 * attachment disposition so the browser can decompress and display the raw SQL.
 * If over 50 MB, refuses with allowed: false and the byte count.
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
    if (!backup || backup.engine !== "sqlite") {
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

    if (manifest.uncompressedSizeBytes > MAX_RAW_VIEW_SIZE_BYTES) {
      return NextResponse.json({
        success: true,
        allowed: false,
        sizeBytes: manifest.uncompressedSizeBytes,
      });
    }

    const url = await getBackupRawUrl(backup.s3Key);

    return NextResponse.json({
      success: true,
      allowed: true,
      url,
    });
  } catch (err: unknown) {
    console.error("Failed to generate raw SQLite backup URL:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate raw backup URL.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
