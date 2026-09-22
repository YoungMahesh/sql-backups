import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { savedConnection } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt, parseConnectionString } from "@/lib/crypto";

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
        { error: "Failed to decrypt connection string. The encryption key may have changed." },
        { status: 500 }
      );
    }

    const parsed = parseConnectionString(rawUri);

    return NextResponse.json({
      success: true,
      connection: {
        id: conn.id,
        engine: conn.engine || "postgres",
        host: conn.host,
        port: conn.port,
        username: conn.username,
        database: conn.database,
        connectionString: rawUri,
        user: parsed.user,
        password: parsed.password || "",
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load connection details.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
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

    await db
      .delete(savedConnection)
      .where(
        and(
          eq(savedConnection.id, id),
          eq(savedConnection.userId, session.user.id)
        )
      );

    return NextResponse.json({
      success: true,
      message: "Saved connection deleted.",
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to delete saved connection.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
