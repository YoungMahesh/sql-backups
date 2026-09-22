import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import zlib from "node:zlib";
import { promisify } from "node:util";
import {
  escapeSqliteIdentifier,
  escapeSqliteValue,
  formatSqliteInsertStatement,
  backupSqliteDatabaseToS3,
} from "@/lib/sqlite-backup";
import type { BackupManifest } from "@/lib/manifest";
import type { Client, ResultSet, Row } from "@libsql/client";

const gunzip = promisify(zlib.gunzip);

let capturedUploadedStreams: Buffer[] = [];

vi.mock("@/lib/s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/s3")>();
  return {
    ...actual,
    uploadBackupStream: vi.fn().mockImplementation(async (_key: string, stream: AsyncIterable<Buffer>) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      capturedUploadedStreams.push(Buffer.concat(chunks));
    }),
  };
});

interface FakeTableDef {
  name: string;
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

interface FakeViewDef {
  name: string;
  sql: string;
}

interface FakeIndexDef {
  name: string;
  tbl_name: string;
  sql: string;
}

interface FakeSequenceDef {
  name: string;
  seq: number;
}

function makeFakeLibsqlClient(config: {
  tables: FakeTableDef[];
  views?: FakeViewDef[];
  indexes?: FakeIndexDef[];
  sequence?: FakeSequenceDef[];
}): Client & { calls: string[] } {
  const calls: string[] = [];
  const views = config.views || [];
  const indexes = config.indexes || [];
  const sequence = config.sequence || [];

  function makeResultSet(columns: string[], rows: Record<string, unknown>[]): ResultSet {
    return {
      columns,
      columnTypes: columns.map(() => "text"),
      rows: rows as unknown as Row[],
      rowsAffected: 0,
      lastInsertRowid: undefined,
      toJSON: () => ({ columns, rows: rows as unknown as Row[], rowsAffected: 0 }),
    };
  }

  const fakeClient = {
    calls,
    execute: vi.fn().mockImplementation(async (stmt: unknown): Promise<ResultSet> => {
      const query = typeof stmt === "string" ? stmt : (stmt as { sql: string }).sql;
      calls.push(query);
      const trimmed = query.trim();

      // 1. sqlite_schema table query
      if (trimmed.includes("FROM sqlite_schema") && trimmed.includes("type = 'table'")) {
        if (trimmed.includes("name = 'sqlite_sequence'")) {
          // Check for sqlite_sequence table existence
          if (sequence.length > 0) {
            return makeResultSet(["1"], [{ 1: 1 }]);
          }
          return makeResultSet(["1"], []);
        }

        return makeResultSet(
          ["name", "sql"],
          config.tables.map((t) => ({ name: t.name, sql: t.sql }))
        );
      }

      // 2. sqlite_schema views query
      if (trimmed.includes("FROM sqlite_schema") && trimmed.includes("type = 'view'")) {
        return makeResultSet(
          ["name", "sql"],
          views.map((v) => ({ name: v.name, sql: v.sql }))
        );
      }

      // 3. sqlite_schema indexes query
      if (trimmed.includes("FROM sqlite_schema") && trimmed.includes("type = 'index'")) {
        return makeResultSet(
          ["name", "tbl_name", "sql"],
          indexes.map((idx) => ({ name: idx.name, tbl_name: idx.tbl_name, sql: idx.sql }))
        );
      }

      // 4. sqlite_sequence state query
      if (trimmed.includes("FROM sqlite_sequence")) {
        return makeResultSet(
          ["name", "seq"],
          sequence.map((s) => ({ name: s.name, seq: s.seq }))
        );
      }

      // 5. Data rows query: SELECT * FROM "tableName";
      const selectMatch = trimmed.match(/SELECT \* FROM "([^"]+)";/i);
      if (selectMatch) {
        const tableName = selectMatch[1];
        const table = config.tables.find((t) => t.name === tableName);
        return makeResultSet(table ? table.columns : [], table ? table.rows : []);
      }

      return makeResultSet([], []);
    }),
    close: vi.fn(),
  };

  return fakeClient as unknown as Client & { calls: string[] };
}

interface CapturedManifest {
  dumpKey: string;
  bytes: Buffer;
  manifest: BackupManifest | null;
}

function capturingManifestSink(): {
  sink: { uploadManifest(key: string, bytes: Buffer | Uint8Array): Promise<void> };
  get: () => CapturedManifest[];
} {
  const captures: CapturedManifest[] = [];
  return {
    sink: {
      async uploadManifest(dumpKey, bytes) {
        const buf = Buffer.from(bytes);
        const parsed = JSON.parse(buf.toString("utf8"));
        captures.push({
          dumpKey,
          bytes: buf,
          manifest: parsed,
        });
      },
    },
    get: () => captures,
  };
}

describe("SQLite Backup Helpers", () => {
  describe("escapeSqliteIdentifier", () => {
    it("wraps identifiers in double quotes", () => {
      assert.equal(escapeSqliteIdentifier("users"), '"users"');
      assert.equal(escapeSqliteIdentifier("order_items_2026"), '"order_items_2026"');
    });

    it("escapes embedded double quotes by doubling them", () => {
      assert.equal(escapeSqliteIdentifier('test"table'), '"test""table"');
    });
  });

  describe("escapeSqliteValue", () => {
    it("serializes null and undefined as NULL", () => {
      assert.equal(escapeSqliteValue(null), "NULL");
      assert.equal(escapeSqliteValue(undefined), "NULL");
    });

    it("serializes booleans as 1 and 0", () => {
      assert.equal(escapeSqliteValue(true), "1");
      assert.equal(escapeSqliteValue(false), "0");
    });

    it("serializes numbers and bigints", () => {
      assert.equal(escapeSqliteValue(42), "42");
      assert.equal(escapeSqliteValue(3.1415), "3.1415");
      assert.equal(escapeSqliteValue(BigInt(9007199254740991)), "9007199254740991");
      assert.equal(escapeSqliteValue(NaN), "NULL");
      assert.equal(escapeSqliteValue(Infinity), "NULL");
    });

    it("escapes strings with single quotes", () => {
      assert.equal(escapeSqliteValue("simple"), "'simple'");
      assert.equal(escapeSqliteValue("O'Reilly"), "'O''Reilly'");
      assert.equal(escapeSqliteValue("first\nsecond"), "'first\nsecond'");
    });

    it("formats Date as ISO string", () => {
      const d = new Date("2026-09-22T15:30:00.000Z");
      assert.equal(escapeSqliteValue(d), "'2026-09-22T15:30:00.000Z'");
    });

    it("serializes Buffer, Uint8Array, and ArrayBuffer as hex blob literal X'...' in uppercase", () => {
      const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
      assert.equal(escapeSqliteValue(buf), "X'DEADBEEF'");

      const uint8 = new Uint8Array([0xca, 0xfe]);
      assert.equal(escapeSqliteValue(uint8), "X'CAFE'");
    });

    it("serializes JSON objects and arrays with quote escaping", () => {
      const obj = { message: "It's working", count: 5 };
      assert.equal(escapeSqliteValue(obj), "'{\"message\":\"It''s working\",\"count\":5}'");
    });
  });

  describe("formatSqliteInsertStatement", () => {
    it("formats batched INSERT INTO statement with double-quoted identifiers", () => {
      const rows = [
        { id: 1, name: "Alice", is_admin: true },
        { id: 2, name: "Bob's Team", is_admin: false },
      ];
      const sql = formatSqliteInsertStatement("users", rows);
      assert.equal(
        sql,
        'INSERT INTO "users" ("id", "name", "is_admin") VALUES (1, \'Alice\', 1), (2, \'Bob\'\'s Team\', 0);\n'
      );
    });

    it("returns empty string when rows is empty", () => {
      assert.equal(formatSqliteInsertStatement("users", []), "");
    });
  });
});

describe("SQLite Streaming Backup Pipeline & Manifest", () => {
  it("streams schema DDL, batched rows, views, indexes, and autoincrement sequence counters", async () => {
    capturedUploadedStreams = [];
    const manifestSink = capturingManifestSink();

    const fakeClient = makeFakeLibsqlClient({
      tables: [
        {
          name: "users",
          sql: 'CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL, "avatar" BLOB)',
          columns: ["id", "name", "avatar"],
          rows: [
            { id: 1, name: "Alice", avatar: Buffer.from([0x01, 0x02]) },
            { id: 2, name: "Bob's Café", avatar: null },
          ],
        },
        {
          name: "settings",
          sql: 'CREATE TABLE "settings" ("key" TEXT PRIMARY KEY, "value" TEXT)',
          columns: ["key", "value"],
          rows: [{ key: "theme", value: "light" }],
        },
      ],
      views: [
        {
          name: "active_users",
          sql: 'CREATE VIEW "active_users" AS SELECT "id", "name" FROM "users"',
        },
      ],
      indexes: [
        {
          name: "idx_users_name",
          tbl_name: "users",
          sql: 'CREATE INDEX "idx_users_name" ON "users" ("name")',
        },
      ],
      sequence: [{ name: "users", seq: 42 }],
    });

    const result = await backupSqliteDatabaseToS3({
      connectionOptions: { uri: "libsql://my-db.turso.io" },
      databaseName: "my_sqlite_db",
      userId: "user_test_123",
      client: fakeClient,
      manifestSink: manifestSink.sink,
    });

    assert.ok(result.s3Key.startsWith("backups/user_test_123/my_sqlite_db_"));
    assert.ok(result.s3Key.endsWith(".sql.gz"));
    assert.ok(result.sizeBytes > 0);

    // Decompress and verify emitted SQL dump
    assert.equal(capturedUploadedStreams.length, 1);
    const decompressed = await gunzip(capturedUploadedStreams[0]);
    const dumpText = decompressed.toString("utf8");

    // Header & Pragmas
    assert.ok(dumpText.includes("SQLite Database Backup created by SQL Backups"));
    assert.ok(dumpText.includes('Database: "my_sqlite_db"'));
    assert.ok(dumpText.includes("PRAGMA foreign_keys = OFF;"));
    assert.ok(dumpText.includes("BEGIN TRANSACTION;"));

    // Table DDL & data
    assert.ok(dumpText.includes('DROP TABLE IF EXISTS "users";'));
    assert.ok(dumpText.includes('CREATE TABLE "users" ("id" INTEGER PRIMARY KEY AUTOINCREMENT, "name" TEXT NOT NULL, "avatar" BLOB);'));
    assert.ok(dumpText.includes('INSERT INTO "users" ("id", "name", "avatar") VALUES (1, \'Alice\', X\'0102\'), (2, \'Bob\'\'s Café\', NULL);'));

    // Views & Indexes
    assert.ok(dumpText.includes('DROP VIEW IF EXISTS "active_users";'));
    assert.ok(dumpText.includes('CREATE VIEW "active_users" AS SELECT "id", "name" FROM "users";'));
    assert.ok(dumpText.includes('CREATE INDEX "idx_users_name" ON "users" ("name");'));

    // Sequence preservation
    assert.ok(dumpText.includes("DELETE FROM sqlite_sequence;"));
    assert.ok(dumpText.includes("INSERT INTO sqlite_sequence VALUES ('users', 42);"));

    // Finalize
    assert.ok(dumpText.includes("COMMIT;"));
    assert.ok(dumpText.includes("PRAGMA foreign_keys = ON;"));

    // Manifest verification
    const captures = manifestSink.get();
    assert.equal(captures.length, 1);
    assert.equal(captures[0].dumpKey, result.s3Key);
    assert.equal(captures[0].manifest?.version, 1);
    assert.equal(captures[0].manifest?.tables.length, 2);
    assert.deepEqual(captures[0].manifest?.tables, [
      { name: "users", rowCount: 2 },
      { name: "settings", rowCount: 1 },
    ]);
    assert.ok((captures[0].manifest?.uncompressedSizeBytes ?? 0) > 0);
  });

  it("does not fail the backup if manifest upload fails", async () => {
    const fakeClient = makeFakeLibsqlClient({
      tables: [{ name: "notes", sql: 'CREATE TABLE "notes" ("content" TEXT)', columns: ["content"], rows: [] }],
    });

    const failingManifestSink = {
      async uploadManifest() {
        throw new Error("S3 manifest network timeout");
      },
    };

    const result = await backupSqliteDatabaseToS3({
      connectionOptions: { uri: "libsql://my-db.turso.io" },
      databaseName: "failing_manifest_db",
      userId: "user_test_123",
      client: fakeClient,
      manifestSink: failingManifestSink,
    });

    assert.ok(result.s3Key.includes("failing_manifest_db"));
  });

  it("propagates client query errors and destroys the stream", async () => {
    const failingClient = {
      execute: vi.fn().mockRejectedValue(new Error("libSQL connection severed")),
      close: vi.fn(),
    } as unknown as Client;

    await assert.rejects(
      backupSqliteDatabaseToS3({
        connectionOptions: { uri: "libsql://my-db.turso.io" },
        databaseName: "error_db",
        userId: "user_test_123",
        client: failingClient,
      }),
      /libSQL connection severed/
    );
  });
});
