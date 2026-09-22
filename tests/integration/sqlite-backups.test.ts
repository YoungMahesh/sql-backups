import { describe, it, expect } from "vitest";
import { db } from "@/db";
import {
  user,
  databaseBackup,
} from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { formatManifest, parseManifest, type BackupManifest } from "@/lib/manifest";
import crypto from "node:crypto";

describe("SQLite Database Backups & Manifest Inspection Integration", () => {
  async function createTestUser() {
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "SQLite Backup Test User",
      email: `${userId}@example.com`,
    });
    return userId;
  }

  it("persists and queries SQLite database backup records with engine discriminator", async () => {
    const userId = await createTestUser();
    const backupId = crypto.randomUUID();
    const s3Key = `backups/${userId}/sqlite_prod_2026-09-22T10-00-00-000Z.sql.gz`;
    const sizeBytes = 8 * 1024 * 1024;

    // Insert SQLite backup record
    await db.insert(databaseBackup).values({
      id: backupId,
      userId,
      databaseName: "sqlite_prod",
      host: "my-app-turso.turso.io",
      port: 443,
      engine: "sqlite",
      s3Key,
      sizeBytes,
    });

    // Query backup record by id
    const [fetched] = await db
      .select()
      .from(databaseBackup)
      .where(eq(databaseBackup.id, backupId));

    expect(fetched).toBeDefined();
    expect(fetched.id).toBe(backupId);
    expect(fetched.userId).toBe(userId);
    expect(fetched.databaseName).toBe("sqlite_prod");
    expect(fetched.host).toBe("my-app-turso.turso.io");
    expect(fetched.port).toBe(443);
    expect(fetched.engine).toBe("sqlite");
    expect(fetched.s3Key).toBe(s3Key);
    expect(fetched.sizeBytes).toBe(sizeBytes);
    expect(fetched.createdAt).toBeInstanceOf(Date);

    // Query backups filtered by engine = "sqlite"
    const sqliteBackups = await db
      .select()
      .from(databaseBackup)
      .where(
        and(
          eq(databaseBackup.userId, userId),
          eq(databaseBackup.engine, "sqlite")
        )
      )
      .orderBy(desc(databaseBackup.createdAt));

    expect(sqliteBackups.length).toBe(1);
    expect(sqliteBackups[0].id).toBe(backupId);
    expect(sqliteBackups[0].engine).toBe("sqlite");
  });

  it("correctly isolates MySQL, PostgreSQL, and SQLite backups in engine queries", async () => {
    const userId = await createTestUser();
    const mysqlBackupId = crypto.randomUUID();
    const pgBackupId = crypto.randomUUID();
    const sqliteBackupId = crypto.randomUUID();

    // 1. Insert MySQL backup
    await db.insert(databaseBackup).values({
      id: mysqlBackupId,
      userId,
      databaseName: "mysql_db",
      host: "mysql.local",
      port: 3306,
      engine: "mysql",
      s3Key: `backups/${userId}/mysql_dump.sql.gz`,
      sizeBytes: 1024,
    });

    // 2. Insert PostgreSQL backup
    await db.insert(databaseBackup).values({
      id: pgBackupId,
      userId,
      databaseName: "postgres_db",
      host: "postgres.local",
      port: 5432,
      engine: "postgres",
      s3Key: `backups/${userId}/postgres_dump.sql.gz`,
      sizeBytes: 2048,
    });

    // 3. Insert SQLite backup
    await db.insert(databaseBackup).values({
      id: sqliteBackupId,
      userId,
      databaseName: "sqlite_db",
      host: "app-db.turso.io",
      port: 443,
      engine: "sqlite",
      s3Key: `backups/${userId}/sqlite_dump.sql.gz`,
      sizeBytes: 3072,
    });

    // Query SQLite backups only
    const sqliteList = await db
      .select()
      .from(databaseBackup)
      .where(
        and(
          eq(databaseBackup.userId, userId),
          eq(databaseBackup.engine, "sqlite")
        )
      );

    expect(sqliteList.length).toBe(1);
    expect(sqliteList[0].id).toBe(sqliteBackupId);
    expect(sqliteList[0].engine).toBe("sqlite");

    // Query PostgreSQL backups only
    const pgList = await db
      .select()
      .from(databaseBackup)
      .where(
        and(
          eq(databaseBackup.userId, userId),
          eq(databaseBackup.engine, "postgres")
        )
      );

    expect(pgList.length).toBe(1);
    expect(pgList[0].id).toBe(pgBackupId);
    expect(pgList[0].engine).toBe("postgres");

    // Query MySQL backups only
    const mysqlList = await db
      .select()
      .from(databaseBackup)
      .where(
        and(
          eq(databaseBackup.userId, userId),
          eq(databaseBackup.engine, "mysql")
        )
      );

    expect(mysqlList.length).toBe(1);
    expect(mysqlList[0].id).toBe(mysqlBackupId);
    expect(mysqlList[0].engine).toBe("mysql");
  });

  it("verifies backup manifest inspection serialization for SQLite tables", () => {
    const manifest: BackupManifest = {
      version: 1,
      uncompressedSizeBytes: 10485760, // 10 MB
      tables: [
        { name: "users", rowCount: 1250 },
        { name: "posts", rowCount: 8400 },
        { name: "tags", rowCount: 300 },
      ],
    };

    const serialized = formatManifest(manifest);
    expect(serialized).toBeInstanceOf(Buffer);

    const parsed = parseManifest(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(1);
    expect(parsed!.uncompressedSizeBytes).toBe(10485760);
    expect(parsed!.tables.length).toBe(3);
    expect(parsed!.tables).toEqual([
      { name: "users", rowCount: 1250 },
      { name: "posts", rowCount: 8400 },
      { name: "tags", rowCount: 300 },
    ]);
  });
});
