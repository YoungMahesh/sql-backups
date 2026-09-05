import { relations } from "drizzle-orm/_relations";
import {
  mysqlTable,
  varchar,
  int,
  bigint,
  timestamp,
  index,
} from "drizzle-orm/mysql-core";
import { user } from "./auth";

export const databaseBackup = mysqlTable(
  "database_backup",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    databaseName: varchar("database_name", { length: 255 }).notNull(),
    host: varchar("host", { length: 255 }).notNull(),
    port: int("port").default(3306).notNull(),
    s3Key: varchar("s3_key", { length: 512 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
  },
  (table) => [
    index("database_backup_userId_idx").on(table.userId),
    index("database_backup_createdAt_idx").on(table.createdAt),
    index("database_backup_lookup_idx").on(table.userId, table.databaseName),
  ]
);

export const databaseBackupRelations = relations(databaseBackup, ({ one }) => ({
  user: one(user, {
    fields: [databaseBackup.userId],
    references: [user.id],
  }),
}));
