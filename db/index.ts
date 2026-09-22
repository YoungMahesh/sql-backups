import { defineRelations } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Cache the database connection in development. This avoids creating a new connection on every HMR update.
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

const conn = globalForDb.conn ?? postgres(process.env.DATABASE_URL!);
if (process.env.NODE_ENV !== "production") globalForDb.conn = conn;

export const client = conn;
export { conn };

export const db = drizzle({
  client: conn,
  relations: defineRelations(schema),
});

export async function closeDb(): Promise<void> {
  if (conn) {
    await conn.end({ timeout: 5 });
  }
  if (globalForDb.conn) {
    globalForDb.conn = undefined;
  }
}
