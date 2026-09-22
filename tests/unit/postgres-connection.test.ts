import { describe, it, expect } from "vitest";
import {
  parsePostgresErrorMessage,
  resolvePostgresUri,
  POSTGRES_SYSTEM_DATABASES,
} from "@/lib/postgres-connection";

describe("PostgreSQL Connection Helpers Unit Tests", () => {
  it("formats PostgreSQL specific error messages accurately", () => {
    expect(parsePostgresErrorMessage({ code: "ECONNREFUSED" })).toContain("Connection refused");
    expect(parsePostgresErrorMessage({ code: "ENOTFOUND" })).toContain("Hostname not found");
    expect(parsePostgresErrorMessage({ code: "ETIMEDOUT" })).toContain("Connection timed out");
    expect(parsePostgresErrorMessage({ code: "28P01" })).toContain("Password authentication failed");
    expect(
      parsePostgresErrorMessage({ message: "password authentication failed for user 'postgres'" })
    ).toContain("Password authentication failed");
    expect(parsePostgresErrorMessage({ code: "3D000" })).toContain("Target database does not exist");
    expect(parsePostgresErrorMessage({ code: "EHOSTUNREACH" })).toContain("Host unreachable");
    expect(parsePostgresErrorMessage(new Error("Custom error"))).toBe("Custom error");
  });

  it("resolves parameters into canonical PostgreSQL connection URI", () => {
    const resolved = resolvePostgresUri({
      host: "db.staging.internal",
      port: 5432,
      user: "devuser",
      password: "secretpassword",
      database: "crm_db",
    });

    expect(resolved.host).toBe("db.staging.internal");
    expect(resolved.port).toBe(5432);
    expect(resolved.user).toBe("devuser");
    expect(resolved.database).toBe("crm_db");
    expect(resolved.uri).toBe(
      "postgresql://devuser:secretpassword@db.staging.internal:5432/crm_db"
    );
  });

  it("resolves URI string and adds postgresql scheme if missing", () => {
    const resolved = resolvePostgresUri({
      connectionString: "admin:pass@postgres.prod:5432/analytics",
    });

    expect(resolved.host).toBe("postgres.prod");
    expect(resolved.port).toBe(5432);
    expect(resolved.user).toBe("admin");
    expect(resolved.database).toBe("analytics");
    expect(resolved.uri).toBe("postgresql://admin:pass@postgres.prod:5432/analytics");
  });

  it("identifies PostgreSQL system databases", () => {
    expect(POSTGRES_SYSTEM_DATABASES.has("postgres")).toBe(true);
    expect(POSTGRES_SYSTEM_DATABASES.has("template0")).toBe(true);
    expect(POSTGRES_SYSTEM_DATABASES.has("template1")).toBe(true);
    expect(POSTGRES_SYSTEM_DATABASES.has("custom_app")).toBe(false);
    expect(POSTGRES_SYSTEM_DATABASES.has("production")).toBe(false);
  });
});
