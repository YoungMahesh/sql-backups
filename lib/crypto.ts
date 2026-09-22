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
 * Masks the password in a MySQL or PostgreSQL connection string URI for safe UI display.
 * E.g. mysql://root:secret@localhost:3306/db -> mysql://root:••••@localhost:3306/db
 *      postgresql://postgres:secret@localhost:5432/db -> postgresql://postgres:••••@localhost:5432/db
 */
export function maskConnectionString(uri: string): string {
  try {
    let parseableUri = uri.trim();
    if (
      !parseableUri.startsWith("mysql://") &&
      !parseableUri.startsWith("mysqls://") &&
      !parseableUri.startsWith("postgresql://") &&
      !parseableUri.startsWith("postgres://")
    ) {
      parseableUri = `mysql://${parseableUri}`;
    }

    const url = new URL(parseableUri);
    if (url.password) {
      url.password = "••••";
    }
    // Return decoded-friendly display URI
    return decodeURIComponent(url.toString());
  } catch {
    // Regex fallback if URL parsing fails
    return uri.replace(/((?:mysql[s]?|postgres(?:ql)?):\/\/[^:]+:)[^@]+(@)/i, "$1••••$2");
  }
}

export interface ConnectionParts {
  engine?: "mysql" | "postgres";
  host: string;
  port: number;
  user: string;
  password?: string;
  database?: string;
}

/**
 * Serializes discrete connection parameters into a canonical MySQL or PostgreSQL connection string.
 */
export function serializeToConnectionString(params: {
  engine?: "mysql" | "postgres";
  host: string;
  port?: number | string;
  user: string;
  password?: string;
  database?: string;
}): string {
  const engine = params.engine || "mysql";
  const defaultPort = engine === "postgres" ? 5432 : 3306;
  const scheme = engine === "postgres" ? "postgresql" : "mysql";

  const host = params.host.trim();
  const port = params.port ? Number(params.port) : defaultPort;
  const user = encodeURIComponent(params.user.trim());
  const pass = params.password !== undefined && params.password !== ""
    ? `:${encodeURIComponent(params.password)}`
    : "";
  const db = params.database?.trim()
    ? `/${encodeURIComponent(params.database.trim())}`
    : "";

  return `${scheme}://${user}${pass}@${host}:${port}${db}`;
}

/**
 * Parses a MySQL or PostgreSQL connection string into constituent parameters.
 */
export function parseConnectionString(uri: string): ConnectionParts {
  let parseableUri = uri.trim();
  const isPostgres =
    parseableUri.startsWith("postgresql://") || parseableUri.startsWith("postgres://");

  if (!isPostgres && !parseableUri.startsWith("mysql://") && !parseableUri.startsWith("mysqls://")) {
    parseableUri = `mysql://${parseableUri}`;
  }

  const engine: "mysql" | "postgres" = isPostgres ? "postgres" : "mysql";
  const defaultPort = isPostgres ? 5432 : 3306;

  const url = new URL(parseableUri);
  const host = url.hostname || "localhost";
  const port = url.port ? parseInt(url.port, 10) : defaultPort;
  const defaultUser = isPostgres ? "postgres" : "root";
  const user = decodeURIComponent(url.username || defaultUser);
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  const dbPath = url.pathname.replace(/^\//, "").trim();
  const database = dbPath ? decodeURIComponent(dbPath) : undefined;

  return {
    engine,
    host,
    port,
    user,
    password,
    database,
  };
}
