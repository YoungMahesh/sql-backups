import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import zlib from "node:zlib";
import { promisify } from "node:util";
import {
  escapeIdentifier,
  formatInsertStatement,
} from "@/lib/mysql-backup";
import { extractTableSchema, extractTableRows } from "@/lib/backup-parser";

const gzip = promisify(zlib.gzip);

interface TableFixture {
  name: string;
  createSql: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

function buildDumpText(tables: TableFixture[], opts?: { views?: string[]; triggers?: string[] }): string {
  const parts: string[] = [];
  parts.push(`-- ------------------------------------------------------`);
  parts.push(`-- MySQL Database Backup created by SQL Backups`);
  parts.push(`-- Database: ${"`shop`"}`);
  parts.push(`-- Backup Date: 2026-09-05T12:30:00.000Z`);
  parts.push(`-- ------------------------------------------------------`);
  parts.push(``);
  parts.push(`SET NAMES utf8mb4;`);
  parts.push(`SET foreign_key_checks = 0;`);
  parts.push(``);

  for (const t of tables) {
    parts.push(`--`);
    parts.push(`-- Table structure for table ${escapeIdentifier(t.name)}`);
    parts.push(`--`);
    parts.push(`DROP TABLE IF EXISTS ${escapeIdentifier(t.name)};`);
    parts.push(`${t.createSql};`);
    parts.push(``);
    parts.push(`--`);
    parts.push(`-- Dumping data for table ${escapeIdentifier(t.name)}`);
    parts.push(`--`);
    for (const row of t.rows) {
      parts.push(formatInsertStatement(t.name, [row]));
    }
    parts.push(``);
  }

  if (opts?.views) {
    for (const v of opts.views) {
      parts.push(`--`);
      parts.push(`-- View structure for ${escapeIdentifier(v)}`);
      parts.push(`--`);
      parts.push(`DROP VIEW IF EXISTS ${escapeIdentifier(v)};`);
      parts.push(`CREATE VIEW ${escapeIdentifier(v)} AS SELECT 1;`);
      parts.push(``);
    }
  }

  if (opts?.triggers) {
    parts.push(`--`);
    parts.push(`-- Triggers for database ${"`shop`"}`);
    parts.push(`--`);
    for (const trig of opts.triggers) {
      parts.push(`DELIMITER ;;`);
      parts.push(`${trig};;`);
      parts.push(`DELIMITER ;`);
      parts.push(``);
    }
  }

  parts.push(`SET foreign_key_checks = 1;`);
  parts.push(`-- Backup completed on 2026-09-05T12:30:01.000Z`);
  return parts.join("\n");
}

async function streamDump(text: string): Promise<Readable> {
  const gz = await gzip(Buffer.from(text, "utf8"));
  return Readable.from(gz);
}

describe("backup parser", () => {
  describe("extractTableSchema", () => {
    it("returns the matching CREATE TABLE statement verbatim", async () => {
      const sql = buildDumpText([
        {
          name: "users",
          createSql: "CREATE TABLE `users` (\n  `id` int NOT NULL,\n  `name` varchar(64)\n)",
          columns: ["id", "name"],
          rows: [],
        },
      ]);
      const stream = await streamDump(sql);
      const schema = await extractTableSchema(stream, "users");
      assert.equal(
        schema,
        "CREATE TABLE `users` (\n  `id` int NOT NULL,\n  `name` varchar(64)\n)"
      );
    });

    it("returns null when the table is not in the dump", async () => {
      const sql = buildDumpText([
        {
          name: "users",
          createSql: "CREATE TABLE `users` (`id` int)",
          columns: ["id"],
          rows: [],
        },
      ]);
      const stream = await streamDump(sql);
      assert.equal(await extractTableSchema(stream, "orders"), null);
    });

    it("returns the correct schema when multiple tables are present", async () => {
      const sql = buildDumpText([
        {
          name: "users",
          createSql: "CREATE TABLE `users` (`id` int)",
          columns: ["id"],
          rows: [],
        },
        {
          name: "orders",
          createSql: "CREATE TABLE `orders` (`order_id` int, `total` decimal(10,2))",
          columns: ["order_id", "total"],
          rows: [],
        },
      ]);
      const stream = await streamDump(sql);
      const orders = await extractTableSchema(stream, "orders");
      assert.equal(orders, "CREATE TABLE `orders` (`order_id` int, `total` decimal(10,2))");
    });

    it("handles backticked identifiers with embedded backticks", async () => {
      const sql = buildDumpText([
        {
          name: "weird`table",
          createSql: "CREATE TABLE `weird``table` (`id` int)",
          columns: ["id"],
          rows: [],
        },
      ]);
      const stream = await streamDump(sql);
      const schema = await extractTableSchema(stream, "weird`table");
      assert.equal(schema, "CREATE TABLE `weird``table` (`id` int)");
    });
  });

  describe("extractTableRows", () => {
    it("returns parsed rows for a simple table", async () => {
      const sql = buildDumpText([
        {
          name: "users",
          createSql: "CREATE TABLE `users` (`id` int, `name` varchar(64))",
          columns: ["id", "name"],
          rows: [
            { id: 1, name: "Alice" },
            { id: 2, name: "Bob" },
          ],
        },
      ]);
      const stream = await streamDump(sql);
      const rows = await extractTableRows(stream, "users", 100);
      assert.deepEqual(rows, [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ]);
    });

    it("returns null when the table is not in the dump", async () => {
      const sql = buildDumpText([
        {
          name: "users",
          createSql: "CREATE TABLE `users` (`id` int)",
          columns: ["id"],
          rows: [{ id: 1 }],
        },
      ]);
      const stream = await streamDump(sql);
      assert.equal(await extractTableRows(stream, "missing", 100), null);
    });

    it("returns an empty array for an empty table", async () => {
      const sql = buildDumpText([
        {
          name: "empty_table",
          createSql: "CREATE TABLE `empty_table` (`id` int)",
          columns: ["id"],
          rows: [],
        },
      ]);
      const stream = await streamDump(sql);
      const rows = await extractTableRows(stream, "empty_table", 100);
      assert.deepEqual(rows, []);
    });

    it("decodes every value type the writer emits", async () => {
      const sql = buildDumpText([
        {
          name: "kitchen_sink",
          createSql:
            "CREATE TABLE `kitchen_sink` (" +
            "`n` int, `b` tinyint, `f` double, `d` datetime, `h` varbinary(64), " +
            "`o` json, `s` varchar(255))",
          columns: ["n", "b", "f", "d", "h", "o", "s"],
          rows: [
            {
              n: 42,
              b: true,
              f: 3.1415,
              d: new Date(2026, 8, 5, 12, 30, 0, 0),
              h: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
              o: { hello: "world", n: 1 },
              s: "O'Reilly\\path\nline\rend\0end\x1aend",
            },
          ],
        },
      ]);
      const stream = await streamDump(sql);
      const rows = await extractTableRows(stream, "kitchen_sink", 100);
      assert.ok(rows);
      const row = rows![0];
      assert.equal(row.n, 42);
      assert.equal(row.b, true);
      assert.equal(row.f, 3.1415);
      assert.equal(row.d, "2026-09-05 12:30:00.000");
      assert.ok(Buffer.isBuffer(row.h));
      assert.deepEqual(row.h, Buffer.from([0xde, 0xad, 0xbe, 0xef]));
      assert.deepEqual(row.o, { hello: "world", n: 1 });
      assert.equal(row.s, "O'Reilly\\path\nline\rend\0end\x1aend");
    });

    it("decodes NULL as null", async () => {
      const sql = buildDumpText([
        {
          name: "t",
          createSql: "CREATE TABLE `t` (`v` varchar(64))",
          columns: ["v"],
          rows: [{ v: null }, { v: "ok" }],
        },
      ]);
      const stream = await streamDump(sql);
      const rows = await extractTableRows(stream, "t", 100);
      assert.deepEqual(rows, [{ v: null }, { v: "ok" }]);
    });

    it("never returns rows from a different table when multiple tables are present", async () => {
      const sql = buildDumpText([
        {
          name: "users",
          createSql: "CREATE TABLE `users` (`id` int)",
          columns: ["id"],
          rows: [{ id: 1 }, { id: 2 }],
        },
        {
          name: "orders",
          createSql: "CREATE TABLE `orders` (`order_id` int)",
          columns: ["order_id"],
          rows: [{ order_id: 100 }, { order_id: 200 }, { order_id: 300 }],
        },
      ]);
      const userRows = await extractTableRows(await streamDump(sql), "users", 100);
      const orderRows = await extractTableRows(await streamDump(sql), "orders", 100);
      assert.deepEqual(userRows, [{ id: 1 }, { id: 2 }]);
      assert.deepEqual(orderRows, [{ order_id: 100 }, { order_id: 200 }, { order_id: 300 }]);
    });

    it("caps the returned rows at the requested limit", async () => {
      const rows = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
      const sql = buildDumpText([
        {
          name: "many",
          createSql: "CREATE TABLE `many` (`id` int)",
          columns: ["id"],
          rows,
        },
      ]);
      const stream = await streamDump(sql);
      const out = await extractTableRows(stream, "many", 100);
      assert.equal(out!.length, 100);
      assert.equal(out![0].id, 1);
      assert.equal(out![99].id, 100);
    });

    it("decodes row values containing every escape sequence", async () => {
      const sql = buildDumpText([
        {
          name: "escapes",
          createSql: "CREATE TABLE `escapes` (`s` varchar(255))",
          columns: ["s"],
          rows: [
            { s: "back\\slash" },
            { s: "it's" },
            { s: "nul\0byte" },
            { s: "line\nfeed" },
            { s: "carriage\rreturn" },
            { s: "ctrl\x1aZ" },
          ],
        },
      ]);
      const stream = await streamDump(sql);
      const rows = await extractTableRows(stream, "escapes", 100);
      assert.deepEqual(rows, [
        { s: "back\\slash" },
        { s: "it's" },
        { s: "nul\0byte" },
        { s: "line\nfeed" },
        { s: "carriage\rreturn" },
        { s: "ctrl\x1aZ" },
      ]);
    });
  });

  describe("non-table sections", () => {
    it("skips view sections without raising errors", async () => {
      const sql = buildDumpText(
        [
          {
            name: "users",
            createSql: "CREATE TABLE `users` (`id` int)",
            columns: ["id"],
            rows: [{ id: 1 }],
          },
        ],
        { views: ["user_summary"] }
      );
      const rows = await extractTableRows(await streamDump(sql), "users", 100);
      assert.deepEqual(rows, [{ id: 1 }]);
      const schema = await extractTableSchema(await streamDump(sql), "users");
      assert.match(schema ?? "", /CREATE TABLE `users`/);
    });

    it("skips trigger sections (DELIMITER ;; ... ;; DELIMITER ;) without raising errors", async () => {
      const sql = buildDumpText(
        [
          {
            name: "users",
            createSql: "CREATE TABLE `users` (`id` int)",
            columns: ["id"],
            rows: [{ id: 1 }],
          },
        ],
        { triggers: ["CREATE TRIGGER `trg` BEFORE INSERT ON `users` FOR EACH ROW SET @x = 1"] }
      );
      const rows = await extractTableRows(await streamDump(sql), "users", 100);
      assert.deepEqual(rows, [{ id: 1 }]);
    });
  });

  describe("streaming behaviour", () => {
    it("operates on a Readable of gzipped bytes without buffering the dump fully in memory", async () => {
      const rows = Array.from({ length: 5000 }, (_, i) => ({ id: i + 1, payload: "x".repeat(64) }));
      const sql = buildDumpText([
        {
          name: "big",
          createSql: "CREATE TABLE `big` (`id` int, `payload` varchar(64))",
          columns: ["id", "payload"],
          rows,
        },
      ]);
      const stream = await streamDump(sql);
      const out = await extractTableRows(stream, "big", 10);
      assert.equal(out!.length, 10);
    });

    it("does not throw on a truncated stream", async () => {
      const sql = buildDumpText([
        {
          name: "users",
          createSql: "CREATE TABLE `users` (\n  `id` int,\n  `name` varchar(255),\n  `payload` text\n)",
          columns: ["id", "name", "payload"],
          rows: [{ id: 1, name: "x", payload: "y".repeat(1024) }],
        },
      ]);
      const gz = await gzip(Buffer.from(sql, "utf8"));
      const truncated = gz.subarray(0, 64);
      const stream = Readable.from(truncated);
      let outcome: unknown;
      try {
        outcome = await extractTableSchema(stream, "users");
      } catch (err) {
        assert.fail(`extractTableSchema threw on a truncated stream: ${err}`);
      }
      assert.ok(outcome === null || typeof outcome === "string");
    });
  });

  describe("PostgreSQL dialect support", () => {
    function buildPostgresDumpText(
      tables: {
        schema: string;
        name: string;
        createSql: string;
        columns: string[];
        rows: Record<string, unknown>[];
      }[],
      opts?: { views?: { schema: string; name: string }[] }
    ): string {
      const parts: string[] = [];
      parts.push(`-- ------------------------------------------------------`);
      parts.push(`-- PostgreSQL Database Backup created by SQL Backups`);
      parts.push(`-- Database: "prod_db"`);
      parts.push(`-- Backup Date: 2026-09-22T12:00:00.000Z`);
      parts.push(`-- ------------------------------------------------------`);
      parts.push(``);
      parts.push(`SET client_encoding = 'UTF8';`);
      parts.push(`SET standard_conforming_strings = on;`);
      parts.push(``);

      for (const t of tables) {
        const qualified = `"${t.schema}"."${t.name}"`;
        parts.push(`--`);
        parts.push(`-- Table structure for table ${qualified}`);
        parts.push(`--`);
        parts.push(`DROP TABLE IF EXISTS ${qualified} CASCADE;`);
        parts.push(`${t.createSql};`);
        parts.push(``);
        parts.push(`--`);
        parts.push(`-- Dumping data for table ${qualified}`);
        parts.push(`--`);
        if (t.rows.length > 0) {
          const cols = t.columns.map((c) => `"${c}"`).join(", ");
          const vals = t.rows.map((r) => {
            const rowVals = t.columns.map((c) => {
              const val = r[c];
              if (val === null) return "NULL";
              if (typeof val === "boolean") return val ? "TRUE" : "FALSE";
              if (typeof val === "number") return String(val);
              if (Buffer.isBuffer(val)) return `'\\x${val.toString("hex")}'`;
              if (typeof val === "object") return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
              return `'${String(val).replace(/'/g, "''")}'`;
            });
            return `(${rowVals.join(", ")})`;
          });
          parts.push(`INSERT INTO ${qualified} (${cols}) VALUES ${vals.join(", ")};`);
        }
        parts.push(``);
      }

      if (opts?.views) {
        for (const v of opts.views) {
          const qualified = `"${v.schema}"."${v.name}"`;
          parts.push(`--`);
          parts.push(`-- View structure for ${qualified}`);
          parts.push(`--`);
          parts.push(`DROP VIEW IF EXISTS ${qualified} CASCADE;`);
          parts.push(`CREATE VIEW ${qualified} AS SELECT 1;`);
          parts.push(``);
        }
      }

      parts.push(`-- Backup completed on 2026-09-22T12:00:01.000Z`);
      return parts.join("\n");
    }

    it("extracts schema for PostgreSQL table with schema qualification", async () => {
      const sql = buildPostgresDumpText([
        {
          schema: "public",
          name: "users",
          createSql: `CREATE TABLE "public"."users" (\n  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,\n  "username" character varying(64) NOT NULL,\n  CONSTRAINT "users_pkey" PRIMARY KEY (id)\n)`,
          columns: ["id", "username"],
          rows: [],
        },
      ]);
      const stream1 = await streamDump(sql);
      const schema1 = await extractTableSchema(stream1, "public.users");
      assert.equal(
        schema1,
        `CREATE TABLE "public"."users" (\n  "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,\n  "username" character varying(64) NOT NULL,\n  CONSTRAINT "users_pkey" PRIMARY KEY (id)\n)`
      );

      // Also matches when searched by unqualified name "users"
      const stream2 = await streamDump(sql);
      const schema2 = await extractTableSchema(stream2, "users");
      assert.equal(schema2, schema1);
    });

    it("extracts schema for custom schema table", async () => {
      const sql = buildPostgresDumpText([
        {
          schema: "public",
          name: "users",
          createSql: `CREATE TABLE "public"."users" ("id" int)`,
          columns: ["id"],
          rows: [],
        },
        {
          schema: "analytics",
          name: "events",
          createSql: `CREATE TABLE "analytics"."events" (\n  "event_id" uuid NOT NULL,\n  "payload" jsonb\n)`,
          columns: ["event_id", "payload"],
          rows: [],
        },
      ]);
      const stream = await streamDump(sql);
      const schema = await extractTableSchema(stream, "analytics.events");
      assert.equal(
        schema,
        `CREATE TABLE "analytics"."events" (\n  "event_id" uuid NOT NULL,\n  "payload" jsonb\n)`
      );
    });

    it("extracts rows with booleans, bytea, JSONB, and escaped single quotes", async () => {
      const sql = buildPostgresDumpText([
        {
          schema: "public",
          name: "accounts",
          createSql: `CREATE TABLE "public"."accounts" ("id" int, "title" text, "is_active" boolean, "meta" jsonb, "avatar" bytea)`,
          columns: ["id", "title", "is_active", "meta", "avatar"],
          rows: [
            {
              id: 1,
              title: "O'Reilly's Pub",
              is_active: true,
              meta: { tier: "gold", tags: ["vip", "early"] },
              avatar: Buffer.from("hello"),
            },
            {
              id: 2,
              title: "Normal Store",
              is_active: false,
              meta: { tier: "free" },
              avatar: null,
            },
          ],
        },
      ]);

      const stream = await streamDump(sql);
      const rows = await extractTableRows(stream, "public.accounts", 10);
      assert.ok(rows);
      assert.equal(rows.length, 2);

      assert.equal(rows[0].id, 1);
      assert.equal(rows[0].title, "O'Reilly's Pub");
      assert.equal(rows[0].is_active, true);
      assert.deepEqual(rows[0].meta, { tier: "gold", tags: ["vip", "early"] });
      assert.ok(Buffer.isBuffer(rows[0].avatar));
      assert.equal((rows[0].avatar as Buffer).toString("utf8"), "hello");

      assert.equal(rows[1].id, 2);
      assert.equal(rows[1].title, "Normal Store");
      assert.equal(rows[1].is_active, false);
      assert.equal(rows[1].avatar, null);
    });

    it("caps rows at the requested limit for PostgreSQL tables", async () => {
      const sql = buildPostgresDumpText([
        {
          schema: "public",
          name: "items",
          createSql: `CREATE TABLE "public"."items" ("id" int)`,
          columns: ["id"],
          rows: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })),
        },
      ]);
      const stream = await streamDump(sql);
      const rows = await extractTableRows(stream, "public.items", 5);
      assert.equal(rows?.length, 5);
    });

    it("skips PostgreSQL views without error", async () => {
      const sql = buildPostgresDumpText(
        [
          {
            schema: "public",
            name: "users",
            createSql: `CREATE TABLE "public"."users" ("id" int)`,
            columns: ["id"],
            rows: [{ id: 100 }],
          },
        ],
        { views: [{ schema: "public", name: "active_users" }] }
      );
      const stream = await streamDump(sql);
      const rows = await extractTableRows(stream, "public.users", 10);
      assert.deepEqual(rows, [{ id: 100 }]);
    });
  });

  describe("SQLite dump parsing parity", () => {
    function buildSqliteDumpText(
      tables: { name: string; createSql: string; insertSqls?: string[] }[],
      sequence?: { name: string; seq: number }[]
    ): string {
      const parts: string[] = [];
      parts.push(`-- ------------------------------------------------------`);
      parts.push(`-- SQLite Database Backup created by SQL Backups`);
      parts.push(`-- Database: "app_db"`);
      parts.push(`-- Backup Date: 2026-09-22T12:00:00.000Z`);
      parts.push(`-- ------------------------------------------------------`);
      parts.push(``);
      parts.push(`PRAGMA foreign_keys = OFF;`);
      parts.push(`BEGIN TRANSACTION;`);
      parts.push(``);

      for (const t of tables) {
        parts.push(`--`);
        parts.push(`-- Table structure for table "${t.name}"`);
        parts.push(`--`);
        parts.push(`DROP TABLE IF EXISTS "${t.name}";`);
        parts.push(`${t.createSql};`);
        parts.push(``);
        parts.push(`--`);
        parts.push(`-- Dumping data for table "${t.name}"`);
        parts.push(`--`);
        if (t.insertSqls) {
          for (const s of t.insertSqls) {
            parts.push(s);
          }
        }
        parts.push(``);
      }

      if (sequence && sequence.length > 0) {
        parts.push(`--`);
        parts.push(`-- Sequence state for autoincrement tables`);
        parts.push(`--`);
        parts.push(`DELETE FROM sqlite_sequence;`);
        for (const s of sequence) {
          parts.push(`INSERT INTO sqlite_sequence VALUES ('${s.name}', ${s.seq});`);
        }
        parts.push(``);
      }

      parts.push(`COMMIT;`);
      parts.push(`PRAGMA foreign_keys = ON;`);
      parts.push(`-- Backup completed on 2026-09-22T12:00:01.000Z`);
      return parts.join("\n");
    }

    it("extracts schema for SQLite table verbatim", async () => {
      const sql = buildSqliteDumpText([
        {
          name: "products",
          createSql: `CREATE TABLE "products" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n  "sku" TEXT NOT NULL UNIQUE,\n  "price" REAL\n)`,
        },
      ]);

      const stream = await streamDump(sql);
      const schema = await extractTableSchema(stream, "products");
      assert.equal(
        schema,
        `CREATE TABLE "products" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n  "sku" TEXT NOT NULL UNIQUE,\n  "price" REAL\n)`
      );
    });

    it("extracts rows from SQLite batched INSERTs with booleans, blobs, and JSON", async () => {
      const insertSql =
        `INSERT INTO "customers" ("id", "name", "is_active", "avatar", "meta") VALUES ` +
        `(1, 'O''Connor', 1, X'CAFE', '{"plan":"pro"}'), ` +
        `(2, 'Alice Smith', 0, NULL, '{"plan":"free"}');\n`;

      const sql = buildSqliteDumpText([
        {
          name: "customers",
          createSql: `CREATE TABLE "customers" ("id" INT, "name" TEXT, "is_active" INT, "avatar" BLOB, "meta" TEXT)`,
          insertSqls: [insertSql],
        },
      ]);

      const stream = await streamDump(sql);
      const rows = await extractTableRows(stream, "customers", 10);
      assert.ok(rows);
      assert.equal(rows.length, 2);

      assert.equal(rows[0].id, 1);
      assert.equal(rows[0].name, "O'Connor");
      assert.equal(rows[0].is_active, 1);
      assert.ok(Buffer.isBuffer(rows[0].avatar));
      assert.deepEqual(rows[0].avatar, Buffer.from([0xca, 0xfe]));
      assert.deepEqual(rows[0].meta, { plan: "pro" });

      assert.equal(rows[1].id, 2);
      assert.equal(rows[1].name, "Alice Smith");
      assert.equal(rows[1].is_active, 0);
      assert.equal(rows[1].avatar, null);
      assert.deepEqual(rows[1].meta, { plan: "free" });
    });
  });
});
