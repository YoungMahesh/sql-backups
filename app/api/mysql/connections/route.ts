import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { savedConnection } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { decrypt, maskConnectionString } from "@/lib/crypto";

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
      .where(eq(savedConnection.userId, session.user.id))
      .orderBy(desc(savedConnection.updatedAt));

    const sanitized = connections.map((conn) => {
      let maskedUri = "mysql://...";
      try {
        const decrypted = decrypt(conn.encryptedConnectionString);
        maskedUri = maskConnectionString(decrypted);
      } catch {
        maskedUri = `mysql://${conn.username}:••••@${conn.host}:${conn.port}`;
      }

      return {
        id: conn.id,
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
