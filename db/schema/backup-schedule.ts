import { relations } from "drizzle-orm/_relations";
import {
  pgTable,
  varchar,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { savedConnection } from "./saved-connection";

export const backupSchedule = pgTable(
  "backup_schedule",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    savedConnectionId: varchar("saved_connection_id", { length: 36 })
      .notNull()
      .references(() => savedConnection.id, { onDelete: "cascade" }),
    databaseName: varchar("database_name", { length: 255 }).notNull(),
    engine: varchar("engine", { length: 32 }).$type<"mysql" | "postgres" | "sqlite">().default("mysql").notNull(),
    cronExpression: varchar("cron_expression", { length: 100 }).notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    retentionCount: integer("retention_count").default(7).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: "date" }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("backup_schedule_userId_idx").on(table.userId),
    index("backup_schedule_tick_idx").on(table.enabled, table.nextRunAt),
    uniqueIndex("backup_schedule_unique_idx").on(
      table.savedConnectionId,
      table.databaseName
    ),
  ]
);

export const backupScheduleRelations = relations(
  backupSchedule,
  ({ one }) => ({
    user: one(user, {
      fields: [backupSchedule.userId],
      references: [user.id],
    }),
    savedConnection: one(savedConnection, {
      fields: [backupSchedule.savedConnectionId],
      references: [savedConnection.id],
    }),
  })
);
