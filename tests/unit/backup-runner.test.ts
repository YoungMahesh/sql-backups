import { describe, it, expect, vi } from "vitest";
import { runBackup } from "@/lib/backup-runner";

vi.mock("@/lib/mysql-backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mysql-backup")>();
  return {
    ...actual,
    backupDatabaseToS3: vi.fn().mockResolvedValue({
      s3Key: "backups/user_1/mysql_db_2026.sql.gz",
      sizeBytes: 1024,
    }),
  };
});

vi.mock("@/lib/postgres-backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/postgres-backup")>();
  return {
    ...actual,
    backupPostgresDatabaseToS3: vi.fn().mockResolvedValue({
      s3Key: "backups/user_1/pg_db_2026.sql.gz",
      sizeBytes: 2048,
    }),
  };
});

vi.mock("@/lib/sqlite-backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sqlite-backup")>();
  return {
    ...actual,
    backupSqliteDatabaseToS3: vi.fn().mockResolvedValue({
      s3Key: "backups/user_1/sqlite_db_2026.sql.gz",
      sizeBytes: 4096,
    }),
  };
});

describe("Polymorphic Backup Runner Seam", () => {
  it("delegates to MySQL backup exporter when engine is 'mysql'", async () => {
    const { backupDatabaseToS3 } = await import("@/lib/mysql-backup");

    const result = await runBackup({
      engine: "mysql",
      databaseName: "storefront",
      userId: "user_123",
      connectionOptions: {
        uri: "mysql://user:pass@localhost:3306/storefront",
        connectTimeout: 15000,
      },
    });

    expect(result.s3Key).toBe("backups/user_1/mysql_db_2026.sql.gz");
    expect(result.sizeBytes).toBe(1024);
    expect(backupDatabaseToS3).toHaveBeenCalledTimes(1);
    expect(backupDatabaseToS3).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseName: "storefront",
        userId: "user_123",
      })
    );
  });

  it("delegates to PostgreSQL backup exporter when engine is 'postgres'", async () => {
    const { backupPostgresDatabaseToS3 } = await import("@/lib/postgres-backup");

    const result = await runBackup({
      engine: "postgres",
      databaseName: "analytics",
      userId: "user_456",
      connectionOptions: {
        uri: "postgresql://postgres:secret@localhost:5432/analytics",
      },
    });

    expect(result.s3Key).toBe("backups/user_1/pg_db_2026.sql.gz");
    expect(result.sizeBytes).toBe(2048);
    expect(backupPostgresDatabaseToS3).toHaveBeenCalledTimes(1);
    expect(backupPostgresDatabaseToS3).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseName: "analytics",
        userId: "user_456",
      })
    );
  });

  it("delegates to SQLite backup exporter when engine is 'sqlite'", async () => {
    const { backupSqliteDatabaseToS3 } = await import("@/lib/sqlite-backup");

    const mockLibsqlClient = {
      execute: vi.fn(),
      close: vi.fn(),
    } as unknown as import("@libsql/client").Client;
    const mockManifestSink = { uploadManifest: vi.fn() };

    const result = await runBackup({
      engine: "sqlite",
      databaseName: "app_data",
      userId: "user_789",
      connectionOptions: {
        uri: "libsql://app-data-org.turso.io",
      },
      libsqlClient: mockLibsqlClient,
      manifestSink: mockManifestSink,
    });

    expect(result.s3Key).toBe("backups/user_1/sqlite_db_2026.sql.gz");
    expect(result.sizeBytes).toBe(4096);
    expect(backupSqliteDatabaseToS3).toHaveBeenCalledTimes(1);
    expect(backupSqliteDatabaseToS3).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseName: "app_data",
        userId: "user_789",
        client: mockLibsqlClient,
        manifestSink: mockManifestSink,
      })
    );
  });

  it("rejects MySQL protected system databases", async () => {
    const systemDbs = ["information_schema", "mysql", "performance_schema", "sys"];
    for (const db of systemDbs) {
      await expect(
        runBackup({
          engine: "mysql",
          databaseName: db,
          userId: "user_123",
          connectionOptions: { uri: "mysql://localhost" },
        })
      ).rejects.toThrow(/system database/i);
    }
  });

  it("rejects PostgreSQL protected system databases", async () => {
    const systemDbs = ["postgres", "template0", "template1"];
    for (const db of systemDbs) {
      await expect(
        runBackup({
          engine: "postgres",
          databaseName: db,
          userId: "user_123",
          connectionOptions: { uri: "postgresql://localhost" },
        })
      ).rejects.toThrow(/system database/i);
    }
  });

  it("rejects unsupported database engine", async () => {
    await expect(
      runBackup({
        // @ts-expect-error test invalid engine runtime handling
        engine: "oracle",
        databaseName: "test",
        userId: "user_123",
        connectionOptions: {},
      })
    ).rejects.toThrow(/unsupported.*engine/i);
  });
});
