import { describe, it, expect } from "vitest";
import { db } from "@/db";
import { user, savedConnection } from "@/db/schema";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto";
import crypto from "node:crypto";

describe("Saved Connections Integration", () => {
  it("performs full CRUD lifecycle on saved connections", async () => {
    const testUserId = crypto.randomUUID();
    await db.insert(user).values({
      id: testUserId,
      name: "Connection Test User",
      email: `${testUserId}@example.com`,
    });

    const connId = crypto.randomUUID();
    const rawUri = "mysql://dbuser:supersecretpass@db.prod.internal:3306/production";
    const encrypted = encrypt(rawUri);

    // 1. Create
    await db.insert(savedConnection).values({
      id: connId,
      userId: testUserId,
      host: "db.prod.internal",
      port: 3306,
      username: "dbuser",
      database: "production",
      encryptedConnectionString: encrypted,
    });

    // 2. Read
    const [fetched] = await db
      .select()
      .from(savedConnection)
      .where(eq(savedConnection.id, connId));

    expect(fetched).toBeDefined();
    expect(fetched.id).toBe(connId);
    expect(fetched.userId).toBe(testUserId);
    expect(fetched.host).toBe("db.prod.internal");
    expect(fetched.port).toBe(3306);
    expect(fetched.username).toBe("dbuser");
    expect(fetched.database).toBe("production");
    expect(fetched.encryptedConnectionString).toBe(encrypted);
    expect(fetched.createdAt).toBeInstanceOf(Date);
    expect(fetched.updatedAt).toBeInstanceOf(Date);

    // 3. Update
    const updatedRawUri = "mysql://dbuser:newsecretpass@db.prod.internal:3306/production_v2";
    const updatedEncrypted = encrypt(updatedRawUri);
    await db
      .update(savedConnection)
      .set({
        database: "production_v2",
        encryptedConnectionString: updatedEncrypted,
      })
      .where(eq(savedConnection.id, connId));

    const [updated] = await db
      .select()
      .from(savedConnection)
      .where(eq(savedConnection.id, connId));

    expect(updated.database).toBe("production_v2");
    expect(updated.encryptedConnectionString).toBe(updatedEncrypted);

    // 4. Delete
    await db.delete(savedConnection).where(eq(savedConnection.id, connId));
    const [deleted] = await db
      .select()
      .from(savedConnection)
      .where(eq(savedConnection.id, connId));

    expect(deleted).toBeUndefined();
  });

  it("enforces strict user scoping across connections", async () => {
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();

    await db.insert(user).values([
      { id: userA, name: "User A", email: `${userA}@example.com` },
      { id: userB, name: "User B", email: `${userB}@example.com` },
    ]);

    const connA = crypto.randomUUID();
    const connB = crypto.randomUUID();

    await db.insert(savedConnection).values([
      {
        id: connA,
        userId: userA,
        host: "host-a.db",
        port: 3306,
        username: "userA",
        encryptedConnectionString: encrypt("mysql://userA:pass@host-a.db:3306"),
      },
      {
        id: connB,
        userId: userB,
        host: "host-b.db",
        port: 3306,
        username: "userB",
        encryptedConnectionString: encrypt("mysql://userB:pass@host-b.db:3306"),
      },
    ]);

    const userAConnections = await db
      .select()
      .from(savedConnection)
      .where(eq(savedConnection.userId, userA));

    expect(userAConnections.length).toBe(1);
    expect(userAConnections[0].id).toBe(connA);

    const userBConnections = await db
      .select()
      .from(savedConnection)
      .where(eq(savedConnection.userId, userB));

    expect(userBConnections.length).toBe(1);
    expect(userBConnections[0].id).toBe(connB);
  });

  it("persists AES-256 encrypted connection strings at rest in PostgreSQL", async () => {
    const testUserId = crypto.randomUUID();
    await db.insert(user).values({
      id: testUserId,
      name: "Encryption Verification User",
      email: `${testUserId}@example.com`,
    });

    const connId = crypto.randomUUID();
    const rawSecretUri = "mysql://admin:P@ssw0rd123!Sensitive@secrets.company.com:3306/finance";
    const encrypted = encrypt(rawSecretUri);

    await db.insert(savedConnection).values({
      id: connId,
      userId: testUserId,
      host: "secrets.company.com",
      port: 3306,
      username: "admin",
      encryptedConnectionString: encrypted,
    });

    // Query raw column value from PostgreSQL
    const [row] = await db
      .select({
        rawStoredValue: savedConnection.encryptedConnectionString,
      })
      .from(savedConnection)
      .where(eq(savedConnection.id, connId));

    // Must be ciphertext in iv:authTag:encrypted format
    expect(row.rawStoredValue).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(row.rawStoredValue).not.toContain("P@ssw0rd123!Sensitive");
    expect(row.rawStoredValue).not.toContain("mysql://");

    // Decryption yields exact original URI
    const decrypted = decrypt(row.rawStoredValue);
    expect(decrypted).toBe(rawSecretUri);
  });

  it("defaults engine to 'mysql' and supports explicit 'postgres' engine connections", async () => {
    const testUserId = crypto.randomUUID();
    await db.insert(user).values({
      id: testUserId,
      name: "Engine Test User",
      email: `${testUserId}@example.com`,
    });

    const mysqlConnId = crypto.randomUUID();
    const pgConnId = crypto.randomUUID();

    // 1. Insert connection without specifying engine (should default to 'mysql')
    await db.insert(savedConnection).values({
      id: mysqlConnId,
      userId: testUserId,
      host: "mysql.local",
      port: 3306,
      username: "root",
      encryptedConnectionString: encrypt("mysql://root@mysql.local:3306"),
    });

    // 2. Insert connection with explicit 'postgres' engine
    const pgUri = "postgresql://pguser:pgpass123@postgres.local:5432/my_app";
    await db.insert(savedConnection).values({
      id: pgConnId,
      userId: testUserId,
      host: "postgres.local",
      port: 5432,
      username: "pguser",
      database: "my_app",
      engine: "postgres",
      encryptedConnectionString: encrypt(pgUri),
    });

    // 3. Query both and verify engines
    const [fetchedMysql] = await db
      .select()
      .from(savedConnection)
      .where(eq(savedConnection.id, mysqlConnId));
    expect(fetchedMysql).toBeDefined();
    expect(fetchedMysql.engine).toBe("mysql");
    expect(fetchedMysql.port).toBe(3306);

    const [fetchedPg] = await db
      .select()
      .from(savedConnection)
      .where(eq(savedConnection.id, pgConnId));
    expect(fetchedPg).toBeDefined();
    expect(fetchedPg.engine).toBe("postgres");
    expect(fetchedPg.port).toBe(5432);
    expect(fetchedPg.username).toBe("pguser");
    expect(fetchedPg.database).toBe("my_app");
    expect(decrypt(fetchedPg.encryptedConnectionString)).toBe(pgUri);

    // 4. Update postgres connection
    const updatedPgUri = "postgresql://pguser:newpass@postgres.local:5432/my_app_v2";
    await db
      .update(savedConnection)
      .set({
        database: "my_app_v2",
        encryptedConnectionString: encrypt(updatedPgUri),
      })
      .where(eq(savedConnection.id, pgConnId));

    const [updatedPg] = await db
      .select()
      .from(savedConnection)
      .where(eq(savedConnection.id, pgConnId));
    expect(updatedPg.database).toBe("my_app_v2");
    expect(decrypt(updatedPg.encryptedConnectionString)).toBe(updatedPgUri);
  });
});

