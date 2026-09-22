import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { savedConnection } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt, encrypt, parseConnectionString } from "@/lib/crypto";
import {
  listSqliteTablesAndRows,
  parseSqliteErrorMessage,
  resolveSqliteUri,
  testSqliteConnection,
} from "@/lib/sqlite-connection";

export const runtime = "nodejs";

interface ConnectionPayload {
  mode: "uri" | "params" | "saved";
  connectionString?: string;
  url?: string;
  authToken?: string;
  database?: string;
  databaseName?: string;
  savedConnectionId?: string;
  testOnly?: boolean;
}

export async function POST(req: Request) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized. Please sign in to connect to databases." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as ConnectionPayload;

    let displayHost = "localhost";
    let displayPort = 443;
    let targetDatabase: string | undefined = undefined;
    let canonicalUri = "";
    let effectiveAuthToken: string | undefined = undefined;

    if (body.mode === "saved") {
      if (!body.savedConnectionId) {
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
            eq(savedConnection.id, body.savedConnectionId),
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
      displayPort = parsed.port || 443;
      targetDatabase = saved.database || parsed.database;
      effectiveAuthToken = parsed.authToken;
    } else if (body.mode === "uri") {
      const uriInput = body.connectionString?.trim() || "";
      if (!uriInput) {
        return NextResponse.json(
          { error: "Connection string is required." },
          { status: 400 }
        );
      }

      const resolved = resolveSqliteUri({ connectionString: uriInput });
      canonicalUri = resolved.uri;
      displayHost = resolved.host;
      displayPort = resolved.port;
      targetDatabase = resolved.database;
      effectiveAuthToken = resolved.authToken;
    } else {
      const urlInput = (body.url || body.connectionString || "").trim();
      const authToken = (body.authToken || "").trim();
      const dbInput = (body.database || body.databaseName || "").trim();

      if (!urlInput) {
        return NextResponse.json(
          { error: "Database URL is required." },
          { status: 400 }
        );
      }

      const resolved = resolveSqliteUri({
        url: urlInput,
        authToken: authToken || undefined,
        database: dbInput || undefined,
      });

      canonicalUri = resolved.uri;
      displayHost = resolved.host;
      displayPort = resolved.port;
      targetDatabase = resolved.database;
      effectiveAuthToken = resolved.authToken;
    }

    if (body.testOnly) {
      const testResult = await testSqliteConnection(canonicalUri, effectiveAuthToken);
      return NextResponse.json({
        success: true,
        message: "Successfully connected to SQLite (libSQL / Turso) database.",
        serverInfo: {
          host: displayHost,
          port: displayPort,
          user: "token",
          version: testResult.version,
        },
      });
    }

    const { database, tables, version } = await listSqliteTablesAndRows(
      canonicalUri,
      effectiveAuthToken
    );

    const finalDatabaseName = targetDatabase || database || "main";

    let effectiveSavedConnectionId =
      body.mode === "saved" ? body.savedConnectionId : undefined;

    // Persist or bump saved connection timestamp
    if (body.mode === "saved" && body.savedConnectionId) {
      try {
        await db
          .update(savedConnection)
          .set({ updatedAt: new Date() })
          .where(
            and(
              eq(savedConnection.id, body.savedConnectionId),
              eq(savedConnection.userId, session.user.id)
            )
          );
      } catch (persistErr) {
        console.error("Failed to bump saved connection timestamp:", persistErr);
      }
    } else if (canonicalUri) {
      try {
        const [existing] = await db
          .select({ id: savedConnection.id })
          .from(savedConnection)
          .where(
            and(
              eq(savedConnection.userId, session.user.id),
              eq(savedConnection.host, displayHost),
              eq(savedConnection.engine, "sqlite")
            )
          )
          .limit(1);

        const encrypted = encrypt(canonicalUri);
        const now = new Date();

        if (existing) {
          effectiveSavedConnectionId = existing.id;
          await db
            .update(savedConnection)
            .set({
              encryptedConnectionString: encrypted,
              updatedAt: now,
              database: finalDatabaseName,
              port: displayPort,
              username: "token",
              engine: "sqlite",
            })
            .where(eq(savedConnection.id, existing.id));
        } else {
          const newId = crypto.randomUUID();
          effectiveSavedConnectionId = newId;
          await db.insert(savedConnection).values({
            id: newId,
            userId: session.user.id,
            host: displayHost,
            port: displayPort,
            username: "token",
            database: finalDatabaseName,
            engine: "sqlite",
            encryptedConnectionString: encrypted,
            createdAt: now,
            updatedAt: now,
          });
        }
      } catch (persistErr) {
        console.error("Failed to persist SQLite saved connection:", persistErr);
      }
    }

    return NextResponse.json({
      success: true,
      databases: [finalDatabaseName],
      database: finalDatabaseName,
      tables,
      count: 1,
      savedConnectionId: effectiveSavedConnectionId,
      serverInfo: {
        host: displayHost,
        port: displayPort,
        user: "token",
        version,
      },
    });
  } catch (err: unknown) {
    const message = parseSqliteErrorMessage(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
