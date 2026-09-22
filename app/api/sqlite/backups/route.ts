import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { databaseBackup, savedConnection } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { decrypt, parseConnectionString } from "@/lib/crypto";
import { backupSqliteDatabaseToS3 } from "@/lib/sqlite-backup";
import {
  parseSqliteErrorMessage,
  resolveSqliteUri,
} from "@/lib/sqlite-connection";

export const runtime = "nodejs";

interface BackupRequestBody {
  databaseName: string;
  connection: {
    mode: "uri" | "params" | "saved";
    connectionString?: string;
    url?: string;
    authToken?: string;
    savedConnectionId?: string;
  };
}

/**
 * GET /api/sqlite/backups
 * Returns all SQLite database backups created by the authenticated user.
 */
export async function GET() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to view backups." },
        { status: 401 }
      );
    }

    const backups = await db
      .select()
      .from(databaseBackup)
      .where(
        and(
          eq(databaseBackup.userId, session.user.id),
          eq(databaseBackup.engine, "sqlite")
        )
      )
      .orderBy(desc(databaseBackup.createdAt));

    return NextResponse.json({
      success: true,
      backups,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch SQLite database backups.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/sqlite/backups
 * Takes a live backup of the specified SQLite (libSQL / Turso) database and uploads to S3.
 */
export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to create database backups." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as BackupRequestBody;
    const { databaseName, connection: connInfo } = body;

    if (!databaseName || typeof databaseName !== "string" || !databaseName.trim()) {
      return NextResponse.json(
        { error: "Database name is required." },
        { status: 400 }
      );
    }

    const cleanDbName = databaseName.trim();

    if (!connInfo || !connInfo.mode) {
      return NextResponse.json(
        { error: "Connection information is required." },
        { status: 400 }
      );
    }

    let uriToBackup: string;
    let displayHost = "localhost";
    let displayPort = 443;

    if (connInfo.mode === "saved") {
      if (!connInfo.savedConnectionId) {
        return NextResponse.json(
          { error: "Saved connection ID is required." },
          { status: 400 }
        );
      }

      const [saved] = await db
        .select()
        .from(savedConnection)
        .where(
          and(
            eq(savedConnection.id, connInfo.savedConnectionId),
            eq(savedConnection.userId, session.user.id),
            eq(savedConnection.engine, "sqlite")
          )
        )
        .limit(1);

      if (!saved) {
        return NextResponse.json(
          { error: "Saved SQLite connection not found." },
          { status: 404 }
        );
      }

      let canonicalUri: string;
      try {
        canonicalUri = decrypt(saved.encryptedConnectionString);
      } catch {
        return NextResponse.json(
          { error: "Could not decrypt saved connection credentials." },
          { status: 500 }
        );
      }

      const parsed = parseConnectionString(canonicalUri);
      displayHost = saved.host || parsed.host;
      displayPort = saved.port || parsed.port || 443;
      uriToBackup = canonicalUri;
    } else if (connInfo.mode === "uri") {
      const rawUri = connInfo.connectionString?.trim() || "";
      if (!rawUri) {
        return NextResponse.json(
          { error: "Connection string or Database URL is required." },
          { status: 400 }
        );
      }

      const resolved = resolveSqliteUri({
        connectionString: rawUri,
        database: cleanDbName,
      });

      displayHost = resolved.host;
      displayPort = resolved.port;
      uriToBackup = resolved.uri;
    } else {
      const resolved = resolveSqliteUri({
        url: connInfo.url,
        authToken: connInfo.authToken,
        database: cleanDbName,
      });

      displayHost = resolved.host;
      displayPort = resolved.port;
      uriToBackup = resolved.uri;
    }

    // Execute streaming backup to S3
    const backupResult = await backupSqliteDatabaseToS3({
      connectionOptions: {
        uri: uriToBackup,
        database: cleanDbName,
      },
      databaseName: cleanDbName,
      userId: session.user.id,
    });

    // Register backup record in database
    const backupId = crypto.randomUUID();
    const now = new Date();

    await db.insert(databaseBackup).values({
      id: backupId,
      userId: session.user.id,
      databaseName: cleanDbName,
      host: displayHost,
      port: displayPort,
      engine: "sqlite",
      s3Key: backupResult.s3Key,
      sizeBytes: backupResult.sizeBytes,
      createdAt: now,
    });

    const [createdBackup] = await db
      .select()
      .from(databaseBackup)
      .where(eq(databaseBackup.id, backupId))
      .limit(1);

    return NextResponse.json({
      success: true,
      backup: createdBackup,
    });
  } catch (err: unknown) {
    console.error("SQLite backup creation failed:", err);
    const message = parseSqliteErrorMessage(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
