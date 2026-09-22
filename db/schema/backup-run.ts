import { relations } from "drizzle-orm/_relations";
import {
  pgTable,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { backupSchedule } from "./backup-schedule";
import { databaseBackup } from "./database-backup";

export const backupRun = pgTable(
  "backup_run",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    scheduleId: varchar("schedule_id", { length: 36 })
      .notNull()
      .references(() => backupSchedule.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    status: varchar("status", { length: 16 }).notNull(),
    errorMessage: text("error_message"),
    skipReason: varchar("skip_reason", { length: 64 }),
    backupId: varchar("backup_id", { length: 36 })
      .references(() => databaseBackup.id, { onDelete: "set null" }),
  },
  (table) => [
    index("backup_run_schedule_idx").on(table.scheduleId, table.startedAt),
    index("backup_run_status_idx").on(table.status),
  ]
);

export const backupRunRelations = relations(backupRun, ({ one }) => ({
  schedule: one(backupSchedule, {
    fields: [backupRun.scheduleId],
    references: [backupSchedule.id],
  }),
  backup: one(databaseBackup, {
    fields: [backupRun.backupId],
    references: [databaseBackup.id],
  }),
}));
