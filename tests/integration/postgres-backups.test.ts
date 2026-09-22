import { describe, it, expect } from "vitest";
import { db } from "@/db";
import {
  user,
  databaseBackup,
} from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { formatManifest, parseManifest, type BackupManifest } from "@/lib/manifest";
import crypto from "node:crypto";

describe("PostgreSQL Database Backups & Manifest Inspection Integration", () => {
  async function createTestUser() {
    const userId = crypto.randomUUID();
    await db.insert(user).values({
      id: userId,
      name: "PG Backup Test User",
      email: `${userId}@example.com`,
    });
    return userId;
  }

  it("persists and queries PostgreSQL database backup records with engine discriminator", async () => {
    const userId = await createTestUser();
    const backupId = crypto.randomUUID();
    const s3Key = `backups/${userId}/pg_prod_2026-09-22T10-00-00-000Z.sql.gz`;
    const sizeBytes = 15 * 1024 * 1024;

    // Insert PostgreSQL backup record
    await db.insert(databaseBackup).values({
      id: backupId,
      userId,
      databaseName: "pg_prod",
      host: "postgres.prod.internal",
      port: 5432,
      engine: "postgres",
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
    expect(fetched.databaseName).toBe("pg_prod");
    expect(fetched.host).toBe("postgres.prod.internal");
    expect(fetched.port).toBe(5432);
    expect(fetched.engine).toBe("postgres");
    expect(fetched.s3Key).toBe(s3Key);
    expect(fetched.sizeBytes).toBe(sizeBytes);
    expect(fetched.createdAt).toBeInstanceOf(Date);

    // Query backups filtered by engine = "postgres"
    const pgBackups = await db
      .select()
      .from(databaseBackup)
      .where(
        and(
          eq(databaseBackup.userId, userId),
          eq(databaseBackup.engine, "postgres")
        )
      )
      .orderBy(desc(databaseBackup.createdAt));

    expect(pgBackups.length).toBe(1);
    expect(pgBackups[0].id).toBe(backupId);
    expect(pgBackups[0].engine).toBe("postgres");
  });

  it("correctly isolates MySQL and PostgreSQL backups in engine queries", async () => {
    const userId = await createTestUser();
    const mysqlBackupId = crypto.randomUUID();
    const pgBackupId = crypto.randomUUID();

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

    // 3. Query PostgreSQL backups only
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

    // 4. Query MySQL backups only
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

  it("verifies backup manifest inspection serialization for schema-qualified PostgreSQL tables", () => {
    const manifest: BackupManifest = {
      version: 1,
      uncompressedSizeBytes: 52428800, // 50 MB
      tables: [
        { name: "public.users", rowCount: 1540 },
        { name: "public.orders", rowCount: 9820 },
        { name: "audit.activity_log", rowCount: 42000 },
        { name: "tenant_acme.settings", rowCount: 12 },
      ],
    };

    const serialized = formatManifest(manifest);
    expect(serialized).toBeInstanceOf(Buffer);

    const parsed = parseManifest(serialized);
    expect(parsed).not.toBeNull();
    expect(parsed!.version).toBe(1);
    expect(parsed!.uncompressedSizeBytes).toBe(52428800);
    expect(parsed!.tables.length).toBe(4);
    expect(parsed!.tables).toEqual([
      { name: "public.users", rowCount: 1540 },
      { name: "public.orders", rowCount: 9820 },
      { name: "audit.activity_log", rowCount: 42000 },
      { name: "tenant_acme.settings", rowCount: 12 },
    ]);
  });
});
