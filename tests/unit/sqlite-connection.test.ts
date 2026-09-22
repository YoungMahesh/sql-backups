import { describe, it, expect } from "vitest";
import {
  parseSqliteErrorMessage,
  resolveSqliteUri,
  testSqliteConnection,
  listSqliteTablesAndRows,
} from "@/lib/sqlite-connection";
import { createClient } from "@libsql/client";

describe("SQLite Connection Helpers Unit Tests", () => {
  it("formats SQLite and libSQL specific error messages accurately", () => {
    expect(parseSqliteErrorMessage({ code: "UNAUTHORIZED" })).toContain("Invalid authentication token");
    expect(parseSqliteErrorMessage({ status: 401 })).toContain("Invalid authentication token");
    expect(parseSqliteErrorMessage({ message: "JWT verification failed: expired" })).toContain(
      "Invalid authentication token"
    );
    expect(parseSqliteErrorMessage({ code: "ECONNREFUSED" })).toContain("Connection refused");
    expect(parseSqliteErrorMessage({ code: "ENOTFOUND" })).toContain("Hostname not found");
    expect(parseSqliteErrorMessage({ code: "ETIMEDOUT" })).toContain("Connection timed out");
    expect(parseSqliteErrorMessage({ message: "URL parse error: invalid url" })).toContain(
      "Invalid database URL format"
    );
    expect(parseSqliteErrorMessage(new Error("Custom SQLite driver error"))).toBe(
      "Custom SQLite driver error"
    );
  });

  it("resolves parameters and extracts hostname, port, database, and auth token", () => {
    const resolved = resolveSqliteUri({
      url: "libsql://my-company-org.turso.io",
      authToken: "secret-token-xyz",
      database: "production_db",
    });

    expect(resolved.host).toBe("my-company-org.turso.io");
    expect(resolved.port).toBe(443);
    expect(resolved.database).toBe("production_db");
    expect(resolved.authToken).toBe("secret-token-xyz");
    expect(resolved.uri).toBe(
      "libsql://my-company-org.turso.io/production_db?authToken=secret-token-xyz"
    );
  });

  it("resolves connection string and preserves existing query parameters", () => {
    const resolved = resolveSqliteUri({
      connectionString: "https://my-app-test.turso.io/analytics?authToken=token-123",
    });

    expect(resolved.host).toBe("my-app-test.turso.io");
    expect(resolved.port).toBe(443);
    expect(resolved.database).toBe("analytics");
    expect(resolved.authToken).toBe("token-123");
    expect(resolved.uri).toContain("libsql://my-app-test.turso.io/analytics?authToken=token-123");
  });

  it("tests connection and retrieves SQLite version", async () => {
    const result = await testSqliteConnection(":memory:");
    expect(result.success).toBe(true);
    expect(result.version).toBeTruthy();
  });

  it("lists user tables and counts rows while ignoring system metadata tables", async () => {
    // Populate an in-memory client
    const client = createClient({ url: "file:test-table-catalog.db" });
    try {
      await client.execute("DROP TABLE IF EXISTS users;");
      await client.execute("DROP TABLE IF EXISTS orders;");
      await client.execute("CREATE TABLE users (id INT PRIMARY KEY, name TEXT);");
      await client.execute("CREATE TABLE orders (id INT PRIMARY KEY, amount REAL);");
      await client.execute("INSERT INTO users VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Charlie');");
      await client.execute("INSERT INTO orders VALUES (101, 49.99);");

      // Verify listSqliteTablesAndRows
      const result = await listSqliteTablesAndRows("file:test-table-catalog.db");
      expect(result.tables.length).toBe(2);

      const usersTable = result.tables.find((t) => t.name === "users");
      const ordersTable = result.tables.find((t) => t.name === "orders");

      expect(usersTable).toBeDefined();
      expect(usersTable?.rowCount).toBe(3);

      expect(ordersTable).toBeDefined();
      expect(ordersTable?.rowCount).toBe(1);
    } finally {
      client.close();
      const fs = await import("node:fs");
      try {
        fs.unlinkSync("test-table-catalog.db");
      } catch {}
    }
  });
});
