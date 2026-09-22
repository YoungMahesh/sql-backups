import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  escapePostgresIdentifier,
  escapePostgresQualifiedTable,
  escapePostgresValue,
  formatPostgresInsertStatement,
  reconstructPostgresTableDdl,
  backupPostgresDatabaseToS3,
} from "@/lib/postgres-backup";
import type { BackupManifest } from "@/lib/manifest";
import type { Sql } from "postgres";

vi.mock("@/lib/s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/s3")>();
  return {
    ...actual,
    uploadBackupStream: vi.fn().mockImplementation(async (_key: string, stream: AsyncIterable<Buffer>) => {
      for await (const chunk of stream) {
        void chunk;
      }
    }),
  };
});

describe("PostgreSQL Backup Helpers", () => {
  describe("escapePostgresIdentifier", () => {
    it("wraps identifiers in double quotes", () => {
      assert.equal(escapePostgresIdentifier("users"), '"users"');
      assert.equal(escapePostgresIdentifier("orders_2026"), '"orders_2026"');
    });

    it("escapes existing double quotes", () => {
      assert.equal(escapePostgresIdentifier('test"table'), '"test""table"');
    });
  });

  describe("escapePostgresQualifiedTable", () => {
    it("formats schema-qualified table identifier", () => {
      assert.equal(escapePostgresQualifiedTable("public", "users"), '"public"."users"');
      assert.equal(escapePostgresQualifiedTable("custom_schema", "app_table"), '"custom_schema"."app_table"');
    });
  });

  describe("escapePostgresValue", () => {
    it("handles null and undefined as NULL", () => {
      assert.equal(escapePostgresValue(null), "NULL");
      assert.equal(escapePostgresValue(undefined), "NULL");
    });

    it("handles numbers and booleans", () => {
      assert.equal(escapePostgresValue(42), "42");
      assert.equal(escapePostgresValue(3.1415), "3.1415");
      assert.equal(escapePostgresValue(true), "TRUE");
      assert.equal(escapePostgresValue(false), "FALSE");
    });

    it("escapes strings with single quotes", () => {
      assert.equal(escapePostgresValue("hello world"), "'hello world'");
      assert.equal(escapePostgresValue("O'Reilly"), "'O''Reilly'");
      assert.equal(escapePostgresValue("line 1\nline 2"), "'line 1\nline 2'");
    });

    it("formats Date using ISO string", () => {
      const d = new Date("2026-09-22T13:45:00.000Z");
      assert.equal(escapePostgresValue(d), "'2026-09-22T13:45:00.000Z'");
    });

    it("handles Buffer and Uint8Array as bytea hex literal", () => {
      const buf = Buffer.from("abc");
      assert.equal(escapePostgresValue(buf), "'\\x616263'");
    });

    it("handles objects and arrays as JSON string literals with quote escaping", () => {
      const obj = { name: "Bob's Diner", score: 98 };
      assert.equal(escapePostgresValue(obj), "'{\"name\":\"Bob''s Diner\",\"score\":98}'");
    });
  });

  describe("formatPostgresInsertStatement", () => {
    it("formats a multi-row INSERT INTO statement with schema qualification", () => {
      const rows = [
        { id: 1, name: "Alice", active: true },
        { id: 2, name: "Bob's Diner", active: false },
      ];
      const sql = formatPostgresInsertStatement("public", "users", rows);
      assert.equal(
        sql,
        'INSERT INTO "public"."users" ("id", "name", "active") VALUES (1, \'Alice\', TRUE), (2, \'Bob\'\'s Diner\', FALSE);\n'
      );
    });

    it("returns empty string if rows is empty", () => {
      assert.equal(formatPostgresInsertStatement("public", "users", []), "");
    });
  });
});

interface FakeTableDef {
  oid: number;
  schema: string;
  table: string;
  columns: {
    column_name: string;
    data_type: string;
    not_null: boolean;
    default_value: string | null;
    identity_type: string | null;
  }[];
  constraints: {
    constraint_name: string;
    constraint_type: string;
    definition: string;
  }[];
  indexes: {
    index_name: string;
    index_definition: string;
  }[];
  rows: Record<string, unknown>[];
}

function makeFakePostgresClient(
  schemas: string[],
  tables: FakeTableDef[],
  views: { schema_name: string; view_name: string; view_definition: string }[] = []
): Sql & { calls: string[] } {
  const calls: string[] = [];

  const fakeSql = {
    calls,
    unsafe: vi.fn().mockImplementation(async (query: string) => {
      calls.push(query);
      const trimmed = query.trim();

      // 1. Schemas query
      if (trimmed.includes("FROM pg_namespace") && trimmed.includes("nspname")) {
        return schemas.map((s) => ({ nspname: s }));
      }

      // 2. Base tables query
      if (trimmed.includes("FROM pg_class c") && trimmed.includes("relkind = 'r'")) {
        return tables.map((t) => ({
          oid: t.oid,
          schema_name: t.schema,
          table_name: t.table,
        }));
      }

      // 3. Columns query
      if (trimmed.includes("FROM pg_attribute a") && trimmed.includes("WHERE a.attrelid =")) {
        const match = trimmed.match(/WHERE a\.attrelid = (\d+)/);
        const oid = match ? parseInt(match[1], 10) : null;
        const tableDef = tables.find((t) => t.oid === oid);
        return tableDef?.columns || [];
      }

      // 4. Constraints query
      if (trimmed.includes("FROM pg_constraint") && trimmed.includes("WHERE conrelid =")) {
        const match = trimmed.match(/WHERE conrelid = (\d+)/);
        const oid = match ? parseInt(match[1], 10) : null;
        const tableDef = tables.find((t) => t.oid === oid);
        return tableDef?.constraints || [];
      }

      // 5. Secondary indexes query
      if (trimmed.includes("FROM pg_index idx") && trimmed.includes("WHERE idx.indrelid =")) {
        const match = trimmed.match(/WHERE idx\.indrelid = (\d+)/);
        const oid = match ? parseInt(match[1], 10) : null;
        const tableDef = tables.find((t) => t.oid === oid);
        return tableDef?.indexes || [];
      }

      // 6. Views query
      if (trimmed.includes("FROM pg_class c") && trimmed.includes("relkind = 'v'")) {
        return views;
      }

      // 7. Table rows query: SELECT * FROM "schema"."table";
      const selectMatch = trimmed.match(/SELECT \* FROM "([^"]+)"\."([^"]+)";/);
      if (selectMatch) {
        const schema = selectMatch[1];
        const table = selectMatch[2];
        const tableDef = tables.find((t) => t.schema === schema && t.table === table);
        return tableDef?.rows || [];
      }

      return [];
    }),
    end: vi.fn().mockResolvedValue(undefined),
  };

  return fakeSql as unknown as Sql & { calls: string[] };
}

interface CapturedManifest {
  dumpKey: string;
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
          bytes: buf,
          manifest: parsed,
        });
      },
    },
    get: () => captures,
  };
}

describe("reconstructPostgresTableDdl", () => {
  it("reconstructs table DDL with columns, defaults, identity, constraints, and indexes", async () => {
    const fakeClient = makeFakePostgresClient(
      ["public"],
      [
        {
          oid: 12345,
          schema: "public",
          table: "users",
          columns: [
            {
              column_name: "id",
              data_type: "bigint",
              not_null: true,
              default_value: null,
              identity_type: "a",
            },
            {
              column_name: "username",
              data_type: "character varying(64)",
              not_null: true,
              default_value: null,
              identity_type: null,
            },
            {
              column_name: "score",
              data_type: "integer",
              not_null: false,
              default_value: "0",
              identity_type: null,
            },
          ],
          constraints: [
            {
              constraint_name: "users_pkey",
              constraint_type: "p",
              definition: "PRIMARY KEY (id)",
            },
            {
              constraint_name: "users_username_key",
              constraint_type: "u",
              definition: "UNIQUE (username)",
            },
          ],
          indexes: [
            {
              index_name: "users_score_idx",
              index_definition: 'CREATE INDEX users_score_idx ON public.users USING btree (score)',
            },
          ],
          rows: [],
        },
      ]
    );

    const ddl = await reconstructPostgresTableDdl(fakeClient, 12345, "public", "users");
    assert.ok(ddl.includes('CREATE TABLE "public"."users" ('));
    assert.ok(ddl.includes('"id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL'));
    assert.ok(ddl.includes('"username" character varying(64) NOT NULL'));
    assert.ok(ddl.includes('"score" integer DEFAULT 0'));
    assert.ok(ddl.includes('CONSTRAINT "users_pkey" PRIMARY KEY (id)'));
    assert.ok(ddl.includes('CONSTRAINT "users_username_key" UNIQUE (username)'));
    assert.ok(ddl.includes('CREATE INDEX users_score_idx ON public.users USING btree (score);'));
  });
});

describe("PostgreSQL Streaming Backup Pipeline & Manifest", () => {
  const fixtureTables: FakeTableDef[] = [
    {
      oid: 1001,
      schema: "public",
      table: "users",
      columns: [
        { column_name: "id", data_type: "integer", not_null: true, default_value: null, identity_type: null },
        { column_name: "name", data_type: "text", not_null: true, default_value: null, identity_type: null },
      ],
      constraints: [
        { constraint_name: "users_pkey", constraint_type: "p", definition: "PRIMARY KEY (id)" },
      ],
      indexes: [],
      rows: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
        { id: 3, name: "Carol" },
      ],
    },
    {
      oid: 1002,
      schema: "audit",
      table: "logs",
      columns: [
        { column_name: "log_id", data_type: "integer", not_null: true, default_value: null, identity_type: null },
        { column_name: "message", data_type: "text", not_null: false, default_value: null, identity_type: null },
      ],
      constraints: [],
      indexes: [],
      rows: [
        { log_id: 10, message: "User login" },
      ],
    },
  ];

  it("rejects protected system databases", async () => {
    await assert.rejects(
      backupPostgresDatabaseToS3({
        connectionOptions: {},
        databaseName: "postgres",
        userId: "u1",
      }),
      /Cannot backup protected system database: postgres/
    );

    await assert.rejects(
      backupPostgresDatabaseToS3({
        connectionOptions: {},
        databaseName: "template1",
        userId: "u1",
      }),
      /Cannot backup protected system database: template1/
    );
  });

  it("exports multi-schema tables with schema qualification and uploads manifest sibling", async () => {
    const fakeClient = makeFakePostgresClient(["public", "audit"], fixtureTables);
    const { sink, get } = capturingManifestSink();

    const result = await backupPostgresDatabaseToS3({
      connectionOptions: {},
      databaseName: "my_app_db",
      userId: "user_pg_1",
      sql: fakeClient,
      manifestSink: sink,
    });

    assert.ok(result.s3Key);
    assert.match(result.s3Key, /^backups\/user_pg_1\/my_app_db_.*\.sql\.gz$/);
    assert.ok(result.sizeBytes > 0);

    const [captured] = get();
    assert.ok(captured, "expected a manifest upload");
    assert.equal(captured.manifest!.version, 1);
    assert.ok(captured.manifest!.uncompressedSizeBytes > 0);
    assert.deepEqual(
      captured.manifest!.tables.sort((a, b) => a.name.localeCompare(b.name)),
      [
        { name: "audit.logs", rowCount: 1 },
        { name: "public.users", rowCount: 3 },
      ]
    );
  });

  it("does not fail the backup if manifest upload fails", async () => {
    const fakeClient = makeFakePostgresClient(["public", "audit"], fixtureTables);
    const failingSink = {
      async uploadManifest(): Promise<void> {
        throw new Error("manifest upload error");
      },
    };

    const result = await backupPostgresDatabaseToS3({
      connectionOptions: {},
      databaseName: "my_app_db",
      userId: "user_pg_1",
      sql: fakeClient,
      manifestSink: failingSink,
    });

    assert.ok(result.s3Key);
    assert.ok(result.sizeBytes > 0);
  });

  it("does not consume manifest sink if dump query throws an error", async () => {
    const failingClient = {
      unsafe: vi.fn().mockImplementation(async () => {
        throw new Error("database connection dropped");
      }),
      end: vi.fn().mockResolvedValue(undefined),
    } as unknown as Sql;

    const { sink, get } = capturingManifestSink();

    await assert.rejects(
      backupPostgresDatabaseToS3({
        connectionOptions: {},
        databaseName: "my_app_db",
        userId: "user_pg_1",
        sql: failingClient,
        manifestSink: sink,
      }),
      /database connection dropped/
    );

    assert.equal(get().length, 0, "no manifest should be uploaded if backup fails");
  });
});
