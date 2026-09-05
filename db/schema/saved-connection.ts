import { relations } from "drizzle-orm/_relations";
import {
  mysqlTable,
  varchar,
  text,
  int,
  timestamp,
  index,
} from "drizzle-orm/mysql-core";
import { user } from "./auth";

export const savedConnection = mysqlTable(
  "saved_connection",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    host: varchar("host", { length: 255 }).notNull(),
    port: int("port").default(3306).notNull(),
    username: varchar("username", { length: 255 }).notNull(),
    database: varchar("database", { length: 255 }),
    encryptedConnectionString: text("encrypted_connection_string").notNull(),
    createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { fsp: 3 })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("saved_connection_userId_idx").on(table.userId),
    index("saved_connection_lookup_idx").on(
      table.userId,
      table.host,
      table.port,
      table.username
    ),
  ]
);

export const savedConnectionRelations = relations(savedConnection, ({ one }) => ({
  user: one(user, {
    fields: [savedConnection.userId],
    references: [user.id],
  }),
}));
