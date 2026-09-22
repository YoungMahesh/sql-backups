import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { savedConnection } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { decrypt, encrypt, maskConnectionString, serializeToConnectionString } from "@/lib/crypto";
import { parsePostgresErrorMessage, testPostgresConnection } from "@/lib/postgres-connection";
import crypto from "node:crypto";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to view saved connections." },
        { status: 401 }
      );
    }

    const connections = await db
      .select()
      .from(savedConnection)
      .where(
        and(
          eq(savedConnection.userId, session.user.id),
          eq(savedConnection.engine, "postgres")
        )
      )
      .orderBy(desc(savedConnection.updatedAt));

    const sanitized = connections.map((conn) => {
      let maskedUri = "postgresql://...";
      try {
        const decrypted = decrypt(conn.encryptedConnectionString);
        maskedUri = maskConnectionString(decrypted);
      } catch {
        maskedUri = `postgresql://${conn.username}:••••@${conn.host}:${conn.port}`;
      }

      return {
        id: conn.id,
        engine: conn.engine,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        database: conn.database,
        maskedUri,
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
      };
    });

    return NextResponse.json({
      success: true,
      connections: sanitized,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch saved connections.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to manage connections." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as {
      action?: "test" | "save";
      host?: string;
      port?: number | string;
      user?: string;
      password?: string;
      database?: string;
      connectionString?: string;
    };

    let canonicalUri = "";
    let displayHost = "localhost";
    let displayPort = 5432;
    let displayUser = "postgres";
    let targetDatabase = body.database?.trim();

    if (body.connectionString?.trim()) {
      let uri = body.connectionString.trim();
      if (!uri.startsWith("postgresql://") && !uri.startsWith("postgres://")) {
        uri = `postgresql://${uri}`;
      }
      canonicalUri = uri;
      try {
        const url = new URL(uri);
        displayHost = url.hostname || "localhost";
        displayPort = url.port ? parseInt(url.port, 10) : 5432;
        displayUser = decodeURIComponent(url.username || "postgres");
        const pathDb = url.pathname.replace(/^\//, "").trim();
        if (pathDb) targetDatabase = decodeURIComponent(pathDb);
      } catch {
        displayHost = "postgres-connection";
      }
    } else {
      const host = body.host?.trim();
      const user = body.user?.trim();
      const password = body.password ?? "";
      const portRaw = body.port;

      if (!host) {
        return NextResponse.json(
          { error: "Server path / host is required." },
          { status: 400 }
        );
      }

      if (!user) {
        return NextResponse.json(
          { error: "Username is required." },
          { status: 400 }
        );
      }

      let port = 5432;
      if (portRaw !== undefined && portRaw !== null && String(portRaw).trim() !== "") {
        const parsedPort = parseInt(String(portRaw).trim(), 10);
        if (isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
          return NextResponse.json(
            { error: "Port must be a valid number between 1 and 65535." },
            { status: 400 }
          );
        }
        port = parsedPort;
      }

      displayHost = host;
      displayPort = port;
      displayUser = user;

      canonicalUri = serializeToConnectionString({
        engine: "postgres",
        host,
        port,
        user,
        password,
        database: targetDatabase || "postgres",
      });
    }

    if (body.action === "test") {
      const testResult = await testPostgresConnection(canonicalUri);
      return NextResponse.json({
        success: true,
        message: "Successfully connected to PostgreSQL server.",
        serverInfo: {
          host: displayHost,
          port: displayPort,
          user: displayUser,
          version: testResult.version,
        },
      });
    }

    // Otherwise, test and save
    const testResult = await testPostgresConnection(canonicalUri);

    const [existing] = await db
      .select({ id: savedConnection.id })
      .from(savedConnection)
      .where(
        and(
          eq(savedConnection.userId, session.user.id),
          eq(savedConnection.host, displayHost),
          eq(savedConnection.port, displayPort),
          eq(savedConnection.username, displayUser),
          eq(savedConnection.engine, "postgres")
        )
      )
      .limit(1);

    const encrypted = encrypt(canonicalUri);
    const now = new Date();
    let savedId = existing?.id;

    if (existing) {
      await db
        .update(savedConnection)
        .set({
          encryptedConnectionString: encrypted,
          updatedAt: now,
          database: targetDatabase || null,
          engine: "postgres",
        })
        .where(eq(savedConnection.id, existing.id));
    } else {
      savedId = crypto.randomUUID();
      await db.insert(savedConnection).values({
        id: savedId,
        userId: session.user.id,
        host: displayHost,
        port: displayPort,
        username: displayUser,
        database: targetDatabase || null,
        engine: "postgres",
        encryptedConnectionString: encrypted,
        createdAt: now,
        updatedAt: now,
      });
    }

    return NextResponse.json({
      success: true,
      connection: {
        id: savedId,
        engine: "postgres",
        host: displayHost,
        port: displayPort,
        username: displayUser,
        database: targetDatabase || null,
        maskedUri: maskConnectionString(canonicalUri),
      },
      serverInfo: {
        host: displayHost,
        port: displayPort,
        user: displayUser,
        version: testResult.version,
      },
    });
  } catch (err: unknown) {
    const message = parsePostgresErrorMessage(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
