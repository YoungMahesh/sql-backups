import { describe, it, expect } from "vitest";
import { db } from "@/db";
import { user, savedConnection } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { encrypt, decrypt } from "@/lib/crypto";
import crypto from "node:crypto";

describe("SQLite Saved Connections Integration", () => {
  it("performs full CRUD lifecycle on SQLite saved connections", async () => {
    const testUserId = crypto.randomUUID();
    await db.insert(user).values({
      id: testUserId,
      name: "SQLite Test User",
      email: `${testUserId}@example.com`,
    });

    const connId = crypto.randomUUID();
    const rawUri = "libsql://my-test-app-team.turso.io?authToken=turso-jwt-token-12345";
    const encrypted = encrypt(rawUri);

    // 1. Create
    await db.insert(savedConnection).values({
      id: connId,
      userId: testUserId,
      host: "my-test-app-team.turso.io",
      port: 443,
      username: "token",
      database: "my-test-app",
      engine: "sqlite",
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
    expect(fetched.host).toBe("my-test-app-team.turso.io");
    expect(fetched.port).toBe(443);
    expect(fetched.username).toBe("token");
    expect(fetched.database).toBe("my-test-app");
    expect(fetched.engine).toBe("sqlite");
    expect(fetched.encryptedConnectionString).toBe(encrypted);
    expect(fetched.createdAt).toBeInstanceOf(Date);
    expect(fetched.updatedAt).toBeInstanceOf(Date);

    // Decryption test
    const decrypted = decrypt(fetched.encryptedConnectionString);
    expect(decrypted).toBe(rawUri);

    // 3. Update
    const updatedUri = "libsql://my-test-app-team.turso.io?authToken=new-token-999";
    const updatedEncrypted = encrypt(updatedUri);

    await db
      .update(savedConnection)
      .set({
        database: "my-test-app-v2",
        encryptedConnectionString: updatedEncrypted,
      })
      .where(eq(savedConnection.id, connId));

    const [updated] = await db
      .select()
      .from(savedConnection)
      .where(eq(savedConnection.id, connId));

    expect(updated.database).toBe("my-test-app-v2");
    expect(decrypt(updated.encryptedConnectionString)).toBe(updatedUri);

    // 4. Delete
    await db.delete(savedConnection).where(eq(savedConnection.id, connId));
    const [deleted] = await db
      .select()
      .from(savedConnection)
      .where(eq(savedConnection.id, connId));

    expect(deleted).toBeUndefined();
  });

  it("isolates saved connections across MySQL, PostgreSQL, and SQLite engines", async () => {
    const testUserId = crypto.randomUUID();
    await db.insert(user).values({
      id: testUserId,
      name: "Multi-Engine Isolation User",
      email: `${testUserId}@example.com`,
    });

    const mysqlId = crypto.randomUUID();
    const pgId = crypto.randomUUID();
    const sqliteId = crypto.randomUUID();

    await db.insert(savedConnection).values([
      {
        id: mysqlId,
        userId: testUserId,
        host: "mysql.local",
        port: 3306,
        username: "root",
        engine: "mysql",
        encryptedConnectionString: encrypt("mysql://root@mysql.local:3306"),
      },
      {
        id: pgId,
        userId: testUserId,
        host: "postgres.local",
        port: 5432,
        username: "postgres",
        engine: "postgres",
        encryptedConnectionString: encrypt("postgresql://postgres@postgres.local:5432/postgres"),
      },
      {
        id: sqliteId,
        userId: testUserId,
        host: "turso-db-org.turso.io",
        port: 443,
        username: "token",
        database: "turso-db",
        engine: "sqlite",
        encryptedConnectionString: encrypt("libsql://turso-db-org.turso.io?authToken=abc"),
      },
    ]);

    // Query SQLite only
    const sqliteConnections = await db
      .select()
      .from(savedConnection)
      .where(
        and(
          eq(savedConnection.userId, testUserId),
          eq(savedConnection.engine, "sqlite")
        )
      );

    expect(sqliteConnections.length).toBe(1);
    expect(sqliteConnections[0].id).toBe(sqliteId);
    expect(sqliteConnections[0].engine).toBe("sqlite");
    expect(sqliteConnections[0].host).toBe("turso-db-org.turso.io");

    // Query PostgreSQL only
    const pgConnections = await db
      .select()
      .from(savedConnection)
      .where(
        and(
          eq(savedConnection.userId, testUserId),
          eq(savedConnection.engine, "postgres")
        )
      );

    expect(pgConnections.length).toBe(1);
    expect(pgConnections[0].id).toBe(pgId);
    expect(pgConnections[0].engine).toBe("postgres");

    // Query MySQL only
    const mysqlConnections = await db
      .select()
      .from(savedConnection)
      .where(
        and(
          eq(savedConnection.userId, testUserId),
          eq(savedConnection.engine, "mysql")
        )
      );

    expect(mysqlConnections.length).toBe(1);
    expect(mysqlConnections[0].id).toBe(mysqlId);
    expect(mysqlConnections[0].engine).toBe("mysql");
  });
});
