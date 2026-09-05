import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { escapeIdentifier, escapeSqlValue, formatInsertStatement } from "./mysql-dumper";

describe("MySQL Dumper Helpers", () => {
  describe("escapeIdentifier", () => {
    it("wraps identifiers in backticks", () => {
      assert.equal(escapeIdentifier("users"), "`users`");
      assert.equal(escapeIdentifier("orders_2026"), "`orders_2026`");
    });

    it("escapes existing backticks", () => {
      assert.equal(escapeIdentifier("test`table"), "`test``table`");
    });
  });

  describe("escapeSqlValue", () => {
    it("handles null and undefined as NULL", () => {
      assert.equal(escapeSqlValue(null), "NULL");
      assert.equal(escapeSqlValue(undefined), "NULL");
    });

    it("handles numbers and booleans", () => {
      assert.equal(escapeSqlValue(42), "42");
      assert.equal(escapeSqlValue(3.1415), "3.1415");
      assert.equal(escapeSqlValue(true), "1");
      assert.equal(escapeSqlValue(false), "0");
    });

    it("escapes strings with special characters", () => {
      assert.equal(escapeSqlValue("hello world"), "'hello world'");
      assert.equal(escapeSqlValue("O'Reilly"), "'O\\'Reilly'");
      assert.equal(escapeSqlValue("line 1\nline 2"), "'line 1\\nline 2'");
      assert.equal(escapeSqlValue("path\\to\\file"), "'path\\\\to\\\\file'");
    });

    it("handles Date objects", () => {
      const d = new Date("2026-09-05T12:00:00.000Z");
      assert.ok(escapeSqlValue(d).startsWith("'2026-09-05"));
    });

    it("handles Buffer / binary data", () => {
      const buf = Buffer.from("abc");
      assert.equal(escapeSqlValue(buf), "X'616263'");
    });
  });

  describe("formatInsertStatement", () => {
    it("formats a multi-row INSERT INTO statement", () => {
      const rows = [
        { id: 1, name: "Alice", active: true },
        { id: 2, name: "Bob's Diner", active: false },
      ];
      const sql = formatInsertStatement("users", rows);
      assert.equal(
        sql,
        "INSERT INTO `users` (`id`, `name`, `active`) VALUES (1, 'Alice', 1), (2, 'Bob\\'s Diner', 0);\n"
      );
    });

    it("returns empty string if rows is empty", () => {
      assert.equal(formatInsertStatement("users", []), "");
    });
  });
});
