import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits for GCM

function getDerivedKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "test") {
      return crypto.createHash("sha256").update("test-only-secret-key-sql-backups-32b").digest();
    }
    throw new Error(
      "Missing encryption secret. Please set BETTER_AUTH_SECRET or ENCRYPTION_KEY in your environment variables."
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Encrypts plaintext string using AES-256-GCM.
 * Output format: iv:authTag:ciphertext (all in hex)
 */
export function encrypt(plainText: string): string {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts AES-256-GCM encrypted string.
 */
export function decrypt(cipherText: string): string {
  const parts = cipherText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getDerivedKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Masks the password or auth token in a MySQL, PostgreSQL, or libSQL/SQLite connection string URI for safe UI display.
 * E.g. mysql://root:secret@localhost:3306/db -> mysql://root:••••@localhost:3306/db
 *      postgresql://postgres:secret@localhost:5432/db -> postgresql://postgres:••••@localhost:5432/db
 *      libsql://my-db-org.turso.io?authToken=secret -> libsql://my-db-org.turso.io?authToken=••••
 */
export function maskConnectionString(uri: string): string {
  try {
    let parseableUri = uri.trim();
    if (
      !parseableUri.startsWith("mysql://") &&
      !parseableUri.startsWith("mysqls://") &&
      !parseableUri.startsWith("postgresql://") &&
      !parseableUri.startsWith("postgres://") &&
      !parseableUri.startsWith("libsql://") &&
      !parseableUri.startsWith("https://") &&
      !parseableUri.startsWith("http://")
    ) {
      parseableUri = `mysql://${parseableUri}`;
    }

    const url = new URL(parseableUri);
    if (url.password) {
      url.password = "••••";
    }
    if (url.searchParams.has("authToken")) {
      url.searchParams.set("authToken", "••••");
    }
    if (url.searchParams.has("jwt")) {
      url.searchParams.set("jwt", "••••");
    }
    // Return decoded-friendly display URI
    return decodeURIComponent(url.toString());
  } catch {
    // Regex fallback if URL parsing fails
    return uri
      .replace(/((?:mysql[s]?|postgres(?:ql)?):\/\/[^:]+:)[^@]+(@)/i, "$1••••$2")
      .replace(/([?&]authToken=)[^&#]+/i, "$1••••")
      .replace(/([?&]jwt=)[^&#]+/i, "$1••••");
  }
}

export interface ConnectionParts {
  engine?: "mysql" | "postgres" | "sqlite";
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
  search?: string;
  ssl?: string | boolean;
  authToken?: string;
}

/**
 * Serializes discrete connection parameters into a canonical MySQL, PostgreSQL, or libSQL connection string.
 */
export function serializeToConnectionString(params: {
  engine?: "mysql" | "postgres" | "sqlite";
  host: string;
  port?: number | string;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | string;
  search?: string;
  authToken?: string;
}): string {
  const engine = params.engine || "mysql";

  if (engine === "sqlite") {
    let host = params.host.trim();
    if (host.startsWith("libsql://")) {
      host = host.slice(9);
    } else if (host.startsWith("https://")) {
      host = host.slice(8);
    } else if (host.startsWith("http://")) {
      host = host.slice(7);
    }
    host = host.replace(/\/$/, "");

    let dbPath = "";
    if (host.includes("/")) {
      const slashIdx = host.indexOf("/");
      dbPath = host.slice(slashIdx);
      host = host.slice(0, slashIdx);
    }

    const port = params.port ? Number(params.port) : 443;
    const portPart = (port && port !== 443) ? `:${port}` : "";
    const db = params.database?.trim()
      ? `/${encodeURIComponent(params.database.trim())}`
      : dbPath;

    const token = params.authToken || params.password;
    let search = params.search || "";
    if (token) {
      const urlSearch = new URLSearchParams(search.replace(/^\?/, ""));
      urlSearch.set("authToken", token);
      search = `?${urlSearch.toString()}`;
    }

    return `libsql://${host}${portPart}${db}${search}`;
  }

  const defaultPort = engine === "postgres" ? 5432 : 3306;
  const scheme = engine === "postgres" ? "postgresql" : "mysql";

  const host = params.host.trim();
  const port = params.port ? Number(params.port) : defaultPort;
  const user = encodeURIComponent((params.user || (engine === "postgres" ? "postgres" : "root")).trim());
  const pass = params.password !== undefined && params.password !== ""
    ? `:${encodeURIComponent(params.password)}`
    : "";
  const db = params.database?.trim()
    ? `/${encodeURIComponent(params.database.trim())}`
    : "";

  let search = params.search || "";
  if (!search && params.ssl) {
    if (engine === "postgres") {
      const mode = typeof params.ssl === "string" ? params.ssl : "require";
      search = `?sslmode=${encodeURIComponent(mode)}`;
    } else {
      search = "?ssl=true";
    }
  }

  return `${scheme}://${user}${pass}@${host}:${port}${db}${search}`;
}

/**
 * Parses a MySQL, PostgreSQL, or libSQL/SQLite connection string into constituent parameters.
 */
export function parseConnectionString(uri: string): ConnectionParts {
  let parseableUri = uri.trim();
  const isPostgres =
    parseableUri.startsWith("postgresql://") || parseableUri.startsWith("postgres://");
  const isSqlite =
    parseableUri.startsWith("libsql://") ||
    parseableUri.startsWith("https://") ||
    parseableUri.startsWith("http://") ||
    parseableUri.startsWith("file:") ||
    parseableUri === ":memory:";

  if (!isPostgres && !isSqlite && !parseableUri.startsWith("mysql://") && !parseableUri.startsWith("mysqls://")) {
    parseableUri = `mysql://${parseableUri}`;
  }

  const engine: "mysql" | "postgres" | "sqlite" = isSqlite
    ? "sqlite"
    : isPostgres
    ? "postgres"
    : "mysql";

  if (engine === "sqlite") {
    if (parseableUri === ":memory:") {
      return {
        engine: "sqlite",
        host: "memory",
        port: 443,
        user: "token",
        database: "memory",
      };
    }

    if (parseableUri.startsWith("file:")) {
      const filePath = parseableUri.replace(/^file:\/\//, "").replace(/^file:/, "");
      return {
        engine: "sqlite",
        host: "localhost",
        port: 443,
        user: "token",
        database: filePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "sqlite",
      };
    }

    const url = new URL(parseableUri);
    const host = url.hostname || "localhost";
    const port = url.port ? parseInt(url.port, 10) : 443;
    const token =
      url.searchParams.get("authToken") ||
      url.searchParams.get("jwt") ||
      (url.password ? decodeURIComponent(url.password) : undefined) ||
      (url.username && url.username !== "token" && url.username !== "libsql"
        ? decodeURIComponent(url.username)
        : undefined);

    const rawPath = url.pathname.replace(/^\//, "").trim();
    let database: string | undefined = rawPath ? decodeURIComponent(rawPath) : undefined;

    if (!database) {
      if (host.endsWith(".turso.io")) {
        const subdomain = host.slice(0, -9); // remove .turso.io
        if (subdomain.includes("-")) {
          // Turso convention: <database-name>-<org-slug>
          database = subdomain.substring(0, subdomain.lastIndexOf("-"));
        } else {
          database = subdomain;
        }
      } else if (host.includes(".")) {
        database = host.split(".")[0];
      }
    }

    return {
      engine: "sqlite",
      host,
      port,
      user: "token",
      password: token,
      authToken: token,
      database,
      search: url.search || undefined,
    };
  }

  const defaultPort = isPostgres ? 5432 : 3306;

  const url = new URL(parseableUri);
  const host = url.hostname || "localhost";
  const port = url.port ? parseInt(url.port, 10) : defaultPort;
  const defaultUser = isPostgres ? "postgres" : "root";
  const user = decodeURIComponent(url.username || defaultUser);
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  const dbPath = url.pathname.replace(/^\//, "").trim();
  const database = dbPath ? decodeURIComponent(dbPath) : undefined;
  const search = url.search || undefined;

  let ssl: string | boolean | undefined;
  if (url.searchParams.has("sslmode")) {
    ssl = url.searchParams.get("sslmode")!;
  } else if (url.searchParams.has("ssl")) {
    const val = url.searchParams.get("ssl");
    ssl = val === "true" || val === "1" ? true : val || false;
  }

  return {
    engine,
    host,
    port,
    user,
    password,
    database,
    search,
    ssl,
  };
}
