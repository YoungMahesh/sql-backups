import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { savedConnection } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt, parseConnectionString } from "@/lib/crypto";
import {
  listSqliteTablesAndRows,
  parseSqliteErrorMessage,
} from "@/lib/sqlite-connection";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized." },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    const [conn] = await db
      .select()
      .from(savedConnection)
      .where(
        and(
          eq(savedConnection.id, id),
          eq(savedConnection.userId, session.user.id)
        )
      )
      .limit(1);

    if (!conn) {
      return NextResponse.json(
        { error: "Saved connection not found." },
        { status: 404 }
      );
    }

    let rawUri = "";
    try {
      rawUri = decrypt(conn.encryptedConnectionString);
    } catch {
      return NextResponse.json(
        { error: "Could not decrypt saved connection credentials." },
        { status: 500 }
      );
    }

    const parsed = parseConnectionString(rawUri);
    const { database, tables, version } = await listSqliteTablesAndRows(
      rawUri,
      parsed.authToken
    );

    const dbName = conn.database || database || "main";

    return NextResponse.json({
      success: true,
      databases: [dbName],
      database: dbName,
      tables,
      count: 1,
      serverInfo: {
        host: conn.host,
        port: conn.port,
        user: conn.username,
        version,
      },
    });
  } catch (err: unknown) {
    const message = parseSqliteErrorMessage(err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
