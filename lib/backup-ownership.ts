import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { databaseBackup } from "@/db/schema/database-backup";

export type DatabaseBackupRow = typeof databaseBackup.$inferSelect;

/**
 * Loads a Database Backup by id, scoped to the calling user.
 *
 * Returns null when the row does not exist or belongs to a different user.
 * Returning null in both cases prevents cross-user existence leaks: the
 * caller maps null to a 404 response and never reveals whether the id
 * exists under another account.
 *
 * The single-row query is bounded by the `database_backup` primary key.
 */
export async function loadOwnedBackup(
  userId: string,
  backupId: string
): Promise<DatabaseBackupRow | null> {
  const [row] = await db
    .select()
    .from(databaseBackup)
    .where(
      and(
        eq(databaseBackup.id, backupId),
        eq(databaseBackup.userId, userId)
      )
    )
    .limit(1);

  return row ?? null;
}
