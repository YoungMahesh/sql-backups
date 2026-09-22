import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { db } from "@/db";
import { savedConnection } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt, encrypt, parseConnectionString, serializeToConnectionString } from "@/lib/crypto";
import {
  listPostgresUserDatabases,
  parsePostgresErrorMessage,
  resolvePostgresUri,
  testPostgresConnection,
} from "@/lib/postgres-connection";

export const runtime = "nodejs";

interface ConnectionPayload {
  mode: "uri" | "params" | "saved";
  connectionString?: string;
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  database?: string;
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
    let displayPort = 5432;
    let displayUser = "postgres";
    let targetDatabase: string | undefined = undefined;
    let canonicalUri = "";

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
      displayPort = parsed.port;
      displayUser = parsed.user;
      targetDatabase = parsed.database;
    } else if (body.mode === "uri") {
      const uriInput = body.connectionString?.trim() || "";
      if (!uriInput) {
        return NextResponse.json(
          { error: "Connection string is required." },
          { status: 400 }
        );
      }

      const resolved = resolvePostgresUri({ connectionString: uriInput });
      canonicalUri = resolved.uri;
      displayHost = resolved.host;
      displayPort = resolved.port;
      displayUser = resolved.user;
      targetDatabase = resolved.database;
    } else {
      const host = body.host?.trim();
      const user = body.user?.trim();
      const password = body.password ?? "";
      const portRaw = body.port;
      const database = body.database?.trim();

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
      targetDatabase = database;

      canonicalUri = serializeToConnectionString({
        engine: "postgres",
        host,
        port,
        user,
        password,
        database: database || "postgres",
      });
    }

    // If testOnly is requested, test connectivity without listing databases or saving
    if (body.testOnly) {
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

    // Connect to PostgreSQL and fetch user databases (excluding postgres, template0, template1)
    const { databases, version } = await listPostgresUserDatabases(canonicalUri);

    let effectiveSavedConnectionId =
      body.mode === "saved" ? body.savedConnectionId : undefined;

    // Persist or update saved connection upon successful connection
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
              eq(savedConnection.port, displayPort),
              eq(savedConnection.username, displayUser),
              eq(savedConnection.engine, "postgres")
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
              database: targetDatabase || null,
              engine: "postgres",
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
            username: displayUser,
            database: targetDatabase || null,
            engine: "postgres",
            encryptedConnectionString: encrypted,
            createdAt: now,
            updatedAt: now,
          });
        }
      } catch (persistErr) {
        console.error("Failed to persist PostgreSQL saved connection:", persistErr);
      }
    }

    return NextResponse.json({
      success: true,
      databases,
      count: databases.length,
      savedConnectionId: effectiveSavedConnectionId,
      serverInfo: {
        host: displayHost,
        port: displayPort,
        user: displayUser,
        version,
      },
    });
  } catch (err: unknown) {
    const message = parsePostgresErrorMessage(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
