import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import mysql, { type Connection } from "mysql2/promise";
import crypto from "node:crypto";
import { db } from "@/db";
import { savedConnection } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  decrypt,
  encrypt,
  parseConnectionString,
  serializeToConnectionString,
} from "@/lib/crypto";

export const runtime = "nodejs";

interface ConnectionPayload {
  mode: "uri" | "params" | "saved";
  connectionString?: string;
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  savedConnectionId?: string;
  testOnly?: boolean;
}

const SYSTEM_DATABASES = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);

function parseErrorMessage(err: unknown): string {
  if (typeof err !== "object" || err === null) {
    return "An unexpected error occurred while connecting to the MySQL server.";
  }

  const errorObj = err as { code?: string; errno?: number; message?: string; sqlMessage?: string };

  if (errorObj.code === "ECONNREFUSED") {
    return "Connection refused. Please verify that the MySQL server is running and accessible on the specified host and port.";
  }
  if (errorObj.code === "ENOTFOUND") {
    return "Hostname not found. Please check that the server path / address is correct.";
  }
  if (errorObj.code === "ETIMEDOUT") {
    return "Connection timed out (10s limit). Please check your server availability and network/firewall rules.";
  }
  if (errorObj.code === "ER_ACCESS_DENIED_ERROR") {
    return errorObj.sqlMessage || "Access denied. Please check your username and password.";
  }
  if (errorObj.code === "EHOSTUNREACH") {
    return "Host unreachable. Please verify network routing and that the MySQL server is publicly or locally reachable.";
  }

  return errorObj.sqlMessage || errorObj.message || "Failed to connect to the MySQL server.";
}

export async function POST(req: Request) {
  let connection: Connection | null = null;

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

    let connectionOptions: mysql.ConnectionOptions;
    let displayHost = "localhost";
    let displayPort = 3306;
    let displayUser = "root";
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

      connectionOptions = {
        uri: canonicalUri,
        connectTimeout: 10000,
      };
    } else if (body.mode === "uri") {
      let uri = body.connectionString?.trim() || "";
      if (!uri) {
        return NextResponse.json(
          { error: "Connection string is required." },
          { status: 400 }
        );
      }

      // Automatically add mysql:// scheme if omitted
      if (!uri.startsWith("mysql://") && !uri.startsWith("mysqls://")) {
        uri = `mysql://${uri}`;
      }

      try {
        const parsed = parseConnectionString(uri);
        displayHost = parsed.host;
        displayPort = parsed.port;
        displayUser = parsed.user;
        targetDatabase = parsed.database;
      } catch {
        displayHost = "custom-connection";
      }

      canonicalUri = uri;
      connectionOptions = {
        uri,
        connectTimeout: 10000,
      };
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

      let port = 3306;
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
        host,
        port,
        user,
        password,
      });

      connectionOptions = {
        host,
        port,
        user,
        password,
        connectTimeout: 10000,
      };
    }

    // Attempt to establish connection
    connection = await mysql.createConnection(connectionOptions);

    // Fetch MySQL version
    let serverVersion = "Unknown";
    try {
      const [versionResult] = await connection.query("SELECT VERSION() as version;");
      if (Array.isArray(versionResult) && versionResult.length > 0) {
        const row = versionResult[0] as Record<string, unknown>;
        serverVersion = String(row.version ?? "Unknown");
      }
    } catch {
      // Non-critical, continue
    }

    if (body.testOnly) {
      return NextResponse.json({
        success: true,
        message: "Successfully connected to MySQL server.",
        serverInfo: {
          host: displayHost,
          port: displayPort,
          user: displayUser,
          version: serverVersion,
        },
      });
    }

    // Fetch user databases (excluding MySQL system databases)
    const [rows] = await connection.query("SHOW DATABASES;");

    const rawDatabases: string[] = Array.isArray(rows)
      ? rows
          .map((row) => {
            const r = row as Record<string, unknown>;
            return String(r.Database ?? r.database ?? Object.values(r)[0] ?? "");
          })
          .filter(Boolean)
      : [];

    const databases = rawDatabases.filter(
      (db) => !SYSTEM_DATABASES.has(db.toLowerCase())
    );

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
              eq(savedConnection.engine, "mysql")
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
              engine: "mysql",
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
            engine: "mysql",
            encryptedConnectionString: encrypted,
            createdAt: now,
            updatedAt: now,
          });
        }
      } catch (persistErr) {
        console.error("Failed to persist saved connection:", persistErr);
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
        version: serverVersion,
      },
    });
  } catch (err: unknown) {
    const message = parseErrorMessage(err);
    return NextResponse.json(
      {
        error: message,
      },
      { status: 400 }
    );
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        // Ignore disconnection errors
      }
    }
  }
}
