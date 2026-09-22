import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { savedConnection } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { decrypt, encrypt, maskConnectionString } from "@/lib/crypto";
import {
  parseSqliteErrorMessage,
  resolveSqliteUri,
  testSqliteConnection,
} from "@/lib/sqlite-connection";
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
          eq(savedConnection.engine, "sqlite")
        )
      )
      .orderBy(desc(savedConnection.updatedAt));

    const sanitized = connections.map((conn) => {
      let maskedUri = "libsql://...";
      try {
        const decrypted = decrypt(conn.encryptedConnectionString);
        maskedUri = maskConnectionString(decrypted);
      } catch {
        maskedUri = `libsql://${conn.host}`;
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
      url?: string;
      authToken?: string;
      database?: string;
      databaseName?: string;
      connectionString?: string;
    };

    const resolved = resolveSqliteUri({
      connectionString: body.connectionString,
      url: body.url,
      authToken: body.authToken,
      database: body.database || body.databaseName,
    });

    if (body.action === "test") {
      const testResult = await testSqliteConnection(resolved.uri, resolved.authToken);
      return NextResponse.json({
        success: true,
        message: "Successfully connected to SQLite (libSQL / Turso) database.",
        serverInfo: {
          host: resolved.host,
          port: resolved.port,
          user: "token",
          version: testResult.version,
        },
      });
    }

    // Test connectivity before saving
    const testResult = await testSqliteConnection(resolved.uri, resolved.authToken);

    const [existing] = await db
      .select({ id: savedConnection.id })
      .from(savedConnection)
      .where(
        and(
          eq(savedConnection.userId, session.user.id),
          eq(savedConnection.host, resolved.host),
          eq(savedConnection.engine, "sqlite")
        )
      )
      .limit(1);

    const encrypted = encrypt(resolved.uri);
    const now = new Date();
    let savedId = existing?.id;

    if (existing) {
      await db
        .update(savedConnection)
        .set({
          encryptedConnectionString: encrypted,
          updatedAt: now,
          database: resolved.database || null,
          port: resolved.port,
          username: "token",
          engine: "sqlite",
        })
        .where(eq(savedConnection.id, existing.id));
    } else {
      savedId = crypto.randomUUID();
      await db.insert(savedConnection).values({
        id: savedId,
        userId: session.user.id,
        host: resolved.host,
        port: resolved.port,
        username: "token",
        database: resolved.database || null,
        engine: "sqlite",
        encryptedConnectionString: encrypted,
        createdAt: now,
        updatedAt: now,
      });
    }

    return NextResponse.json({
      success: true,
      connection: {
        id: savedId,
        engine: "sqlite",
        host: resolved.host,
        port: resolved.port,
        username: "token",
        database: resolved.database || null,
        maskedUri: maskConnectionString(resolved.uri),
      },
      serverInfo: {
        host: resolved.host,
        port: resolved.port,
        user: "token",
        version: testResult.version,
      },
    });
  } catch (err: unknown) {
    const message = parseSqliteErrorMessage(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
