import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { databaseBackup, savedConnection } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { decrypt, parseConnectionString } from "@/lib/crypto";
import {
  backupPostgresDatabaseToS3,
  POSTGRES_SYSTEM_DATABASES,
  type PostgresBackupConnectionOptions,
} from "@/lib/postgres-backup";
import { parsePostgresErrorMessage } from "@/lib/postgres-connection";

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
 * GET /api/postgres/backups
 * Returns all PostgreSQL database backups created by the authenticated user.
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
          eq(databaseBackup.engine, "postgres")
        )
      )
      .orderBy(desc(databaseBackup.createdAt));

    return NextResponse.json({
      success: true,
      backups,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch PostgreSQL database backups.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/postgres/backups
 * Takes a live backup of the specified PostgreSQL database and uploads to S3.
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

    if (POSTGRES_SYSTEM_DATABASES.has(cleanDbName.toLowerCase())) {
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

    let connectionOptions: PostgresBackupConnectionOptions;
    let displayHost = "localhost";
    let displayPort = 5432;

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
      displayPort = parsed.port || 5432;

      connectionOptions = {
        uri: canonicalUri,
      };
    } else if (connInfo.mode === "uri") {
      let uri = connInfo.connectionString?.trim() || "";
      if (!uri) {
        return NextResponse.json(
          { error: "Connection string is required." },
          { status: 400 }
        );
      }

      if (!uri.startsWith("postgresql://") && !uri.startsWith("postgres://")) {
        uri = `postgresql://${uri}`;
      }

      try {
        const parsed = parseConnectionString(uri);
        displayHost = parsed.host;
        displayPort = parsed.port || 5432;
      } catch {
        displayHost = "custom-connection";
      }

      connectionOptions = {
        uri,
      };
    } else {
      const host = connInfo.host?.trim() || "localhost";
      const user = connInfo.user?.trim() || "postgres";
      const password = connInfo.password ?? "";
      const portRaw = connInfo.port;

      let port = 5432;
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
      };
    }

    // Execute streaming backup to S3
    const backupResult = await backupPostgresDatabaseToS3({
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
      engine: "postgres",
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
    console.error("PostgreSQL backup creation failed:", err);
    const message = parsePostgresErrorMessage(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
