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
});
