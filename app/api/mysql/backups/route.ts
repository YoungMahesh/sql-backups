import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { databaseBackup, savedConnection } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { ConnectionOptions } from "mysql2/promise";
import { decrypt, parseConnectionString } from "@/lib/crypto";
import { backupDatabaseToS3, SYSTEM_DATABASES } from "@/lib/mysql-backup";

export const runtime = "nodejs";

interface BackupRequestBody {
  databaseName: string;
  connection: {
    mode: "uri" | "params" | "saved";
    connectionString?: string;
    host?: string;
    port?: number | string;
    user?: string;
    password?: string;
    savedConnectionId?: string;
  };
}

/**
 * GET /api/mysql/backups
 * Returns all database backups created by the authenticated user.
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
      .where(eq(databaseBackup.userId, session.user.id))
      .orderBy(desc(databaseBackup.createdAt));

    return NextResponse.json({
      success: true,
      backups,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch database backups.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/mysql/backups
 * Takes a live backup of the specified database and uploads to S3.
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

    if (SYSTEM_DATABASES.has(cleanDbName.toLowerCase())) {
      return NextResponse.json(
        { error: `Cannot backup system database "${cleanDbName}".` },
        { status: 400 }
      );
    }

    if (!connInfo || !connInfo.mode) {
      return NextResponse.json(
        { error: "Connection information is required." },
        { status: 400 }
      );
    }

    let connectionOptions: ConnectionOptions;
    let displayHost = "localhost";
    let displayPort = 3306;

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
            eq(savedConnection.userId, session.user.id)
          )
        )
        .limit(1);

      if (!saved) {
        return NextResponse.json(
          { error: "Saved connection not found." },
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
      displayHost = parsed.host;
      displayPort = parsed.port;

      connectionOptions = {
        uri: canonicalUri,
        connectTimeout: 15000,
      };
    } else if (connInfo.mode === "uri") {
      let uri = connInfo.connectionString?.trim() || "";
      if (!uri) {
        return NextResponse.json(
          { error: "Connection string is required." },
          { status: 400 }
        );
      }

      if (!uri.startsWith("mysql://") && !uri.startsWith("mysqls://")) {
        uri = `mysql://${uri}`;
      }

      try {
        const parsed = parseConnectionString(uri);
        displayHost = parsed.host;
        displayPort = parsed.port;
      } catch {
        displayHost = "custom-connection";
      }

      connectionOptions = {
        uri,
        connectTimeout: 15000,
      };
    } else {
      const host = connInfo.host?.trim() || "localhost";
      const user = connInfo.user?.trim() || "root";
      const password = connInfo.password ?? "";
      const portRaw = connInfo.port;

      let port = 3306;
      if (portRaw !== undefined && portRaw !== null && String(portRaw).trim() !== "") {
        const parsedPort = parseInt(String(portRaw).trim(), 10);
        if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
          port = parsedPort;
        }
      }

      displayHost = host;
      displayPort = port;

      connectionOptions = {
        host,
        port,
        user,
        password,
        connectTimeout: 15000,
      };
    }

    // Execute streaming backup to S3
    const backupResult = await backupDatabaseToS3({
      connectionOptions,
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
    console.error("Backup creation failed:", err);
    const message =
      err instanceof Error ? err.message : "An unexpected error occurred during database backup.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
