import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  escapeIdentifier,
  escapeSqlValue,
  formatInsertStatement,
  backupDatabaseToS3,
  type BackupDatabaseOptions,
} from "./mysql-backup";
import type { BackupManifest } from "./manifest";

describe("MySQL Backup Helpers", () => {
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
      assert.equal(escapeSqlValue(true), "'1'");
      assert.equal(escapeSqlValue(false), "'0'");
    });

    it("escapes strings with special characters", () => {
      assert.equal(escapeSqlValue("hello world"), "'hello world'");
      assert.equal(escapeSqlValue("O'Reilly"), "'O\\'Reilly'");
      assert.equal(escapeSqlValue("line 1\nline 2"), "'line 1\\nline 2'");
      assert.equal(escapeSqlValue("path\\to\\file"), "'path\\\\to\\\\file'");
    });

    it("formats Date using local calendar to prevent timezone offset corruption", () => {
      const d = new Date(2026, 8, 5, 12, 30, 0, 0); // Sep 5 2026 12:30:00 local time
      const escaped = escapeSqlValue(d);
      assert.ok(escaped.startsWith("'2026-09-05 12:30:00"));
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
        "INSERT INTO `users` (`id`, `name`, `active`) VALUES (1, 'Alice', '1'), (2, 'Bob\\'s Diner', '0');\n"
      );
    });

    it("returns empty string if rows is empty", () => {
      assert.equal(formatInsertStatement("users", []), "");
    });
  });
});

type FakeRow = Record<string, unknown>;

interface FakeMysqlConnection {
  query(sql: string): Promise<[FakeRow[], unknown]>;
  end(): Promise<void>;
}

function makeFakeMysqlConnection(
  tables: Record<string, { createSql: string; rows: FakeRow[] }>
): FakeMysqlConnection & { calls: string[] } {
  const calls: string[] = [];
  const tableNames = Object.keys(tables);
  const conn = {
    calls,
    async query(sql: string): Promise<[FakeRow[], unknown]> {
      calls.push(sql);
      const trimmed = sql.trim();

      if (/^SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'/i.test(trimmed)) {
        return [tableNames.map((n) => ({ Tables_in_shop: n })) as FakeRow[], []];
      }
      if (/^SHOW FULL TABLES WHERE Table_type = 'VIEW'/i.test(trimmed)) {
        return [[], []];
      }
      if (/^SHOW TRIGGERS/i.test(trimmed)) {
        return [[], []];
      }

      const showCreateTable = trimmed.match(/^SHOW CREATE TABLE `([^`]+)`/i);
      if (showCreateTable) {
        const name = showCreateTable[1];
        const t = tables[name];
        if (!t) return [[], []];
        return [[{ "Create Table": t.createSql } as FakeRow], []];
      }

      const selectStar = trimmed.match(/^SELECT \* FROM `([^`]+)`/i);
      if (selectStar) {
        const name = selectStar[1];
        const t = tables[name];
        if (!t) return [[], []];
        return [t.rows, []];
      }

      return [[], []];
    },
    async end(): Promise<void> {
    },
  };
  return conn;
}

interface CapturedManifest {
  dumpKey: string;
  manifestKey: string | null;
  bytes: Buffer;
  manifest: BackupManifest | null;
}

function capturingManifestSink(): {
  sink: { uploadManifest(key: string, bytes: Buffer): Promise<void> };
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
          manifestKey: null,
          bytes: buf,
          manifest: parsed,
        });
      },
    },
    get: () => captures,
  };
}

describe("dump pipeline manifest capture", () => {
  const dbFixture = {
    users: {
      createSql: "CREATE TABLE `users` (`id` int NOT NULL, `name` varchar(64))",
      rows: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Carol" },
      ],
    },
    empty_table: {
      createSql: "CREATE TABLE `empty_table` (`id` int NOT NULL)",
      rows: [],
    },
  };

  it("emits a manifest sibling containing every base table with its row count", async () => {
    const conn = makeFakeMysqlConnection(dbFixture);
    const { sink, get } = capturingManifestSink();

    await backupDatabaseToS3({
      connectionOptions: {},
      databaseName: "shop",
      userId: "user_1",
      connection: conn as unknown as BackupDatabaseOptions["connection"],
      manifestSink: sink,
    } as unknown as BackupDatabaseOptions);

    const [captured] = get();
    assert.ok(captured, "expected a manifest upload");
    assert.equal(captured.manifest!.version, 1);
    assert.deepEqual(
      captured.manifest!.tables.map((t) => ({ name: t.name, rowCount: t.rowCount })).sort((a, b) => a.name.localeCompare(b.name)),
      [
        { name: "empty_table", rowCount: 0 },
        { name: "users", rowCount: 3 },
      ]
    );
  });

  it("records the uncompressed dump size in the manifest", async () => {
    const conn = makeFakeMysqlConnection(dbFixture);
    const { sink, get } = capturingManifestSink();

    await backupDatabaseToS3({
      connectionOptions: {},
      databaseName: "shop",
      userId: "user_1",
      connection: conn as unknown as BackupDatabaseOptions["connection"],
      manifestSink: sink,
    } as unknown as BackupDatabaseOptions);

    const [captured] = get();
    assert.ok(captured);
    assert.ok(
      Number.isInteger(captured.manifest!.uncompressedSizeBytes) &&
        captured.manifest!.uncompressedSizeBytes > 0,
      `expected uncompressed size > 0, got ${captured.manifest!.uncompressedSizeBytes}`
    );
  });

  it("derives the manifest S3 key from the dump S3 key", async () => {
    const conn = makeFakeMysqlConnection(dbFixture);
    const { sink, get } = capturingManifestSink();

    await backupDatabaseToS3({
      connectionOptions: {},
      databaseName: "shop",
      userId: "user_1",
      connection: conn as unknown as BackupDatabaseOptions["connection"],
      manifestSink: sink,
    } as unknown as BackupDatabaseOptions);

    const [captured] = get();
    assert.ok(captured);
    assert.match(captured.dumpKey, /\.sql\.gz$/);
    const stamp = captured.dumpKey.replace(/\.sql\.gz$/, "");
    assert.equal(
      captured.dumpKey.replace(".sql.gz", ".manifest.json"),
      `${stamp}.manifest.json`
    );
  });

  it("does not fail the backup when the manifest upload fails", async () => {
    const conn = makeFakeMysqlConnection(dbFixture);
    const failingSink = {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async uploadManifest(_key: string, _bytes: Buffer): Promise<void> {
        throw new Error("manifest upload boom");
      },
    };

    const result = await backupDatabaseToS3({
      connectionOptions: {},
      databaseName: "shop",
      userId: "user_1",
      connection: conn as unknown as BackupDatabaseOptions["connection"],
      manifestSink: failingSink,
    } as unknown as BackupDatabaseOptions);

    assert.ok(result.s3Key);
    assert.ok(result.sizeBytes > 0);
  });

  it("emits a manifest with empty tables array when the database has no base tables", async () => {
    const conn = makeFakeMysqlConnection({});
    const { sink, get } = capturingManifestSink();

    await backupDatabaseToS3({
      connectionOptions: {},
      databaseName: "empty",
      userId: "user_1",
      connection: conn as unknown as BackupDatabaseOptions["connection"],
      manifestSink: sink,
    } as unknown as BackupDatabaseOptions);

    const [captured] = get();
    assert.ok(captured);
    assert.equal(captured.manifest!.tables.length, 0);
  });

  it("does not consume the manifest sink unless the dump successfully completes", async () => {
    const failing = {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async query(_sql: string) {
        throw new Error("dump pipeline failure");
      },
      async end() {},
    };
    const { sink, get } = capturingManifestSink();

    await assert.rejects(
      backupDatabaseToS3({
        connectionOptions: {},
        databaseName: "shop",
        userId: "user_1",
        connection: failing as unknown as BackupDatabaseOptions["connection"],
        manifestSink: sink,
      } as unknown as BackupDatabaseOptions),
      /dump pipeline failure/
    );

    assert.equal(get().length, 0, "no manifest should be uploaded when the dump fails");
  });
});
