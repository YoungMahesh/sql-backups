export const MANIFEST_VERSION = 1 as const;

export interface BackupManifestTableEntry {
  name: string;
  rowCount: number;
}

export interface BackupManifest {
  version: typeof MANIFEST_VERSION;
  uncompressedSizeBytes: number;
  tables: BackupManifestTableEntry[];
}

const MANIFEST_SUFFIX = ".manifest.json";

/**
 * Derives the S3 key for a Backup Manifest from its dump's S3 key.
 *
 * Convention: `backups/{userId}/{databaseName}_{timestamp}.sql.gz`
 *         ->  `backups/{userId}/{databaseName}_{timestamp}.manifest.json`
 *
 * Returns null if the input key does not end with the dump suffix.
 */
export function deriveManifestKey(dumpKey: string): string | null {
  if (!dumpKey.endsWith(".sql.gz")) {
    return null;
  }
  return `${dumpKey.slice(0, -".sql.gz".length)}${MANIFEST_SUFFIX}`;
}

/**
 * Serializes a Backup Manifest to JSON bytes for upload to S3.
 */
export function formatManifest(manifest: BackupManifest): Buffer {
  return Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
}

function isFiniteNonNegativeInteger(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

/**
 * Parses and validates a Backup Manifest from raw bytes.
 * Returns null on any structural or type error (no exceptions thrown).
 *
 * The validator is hand-rolled per the spec — no validation library added.
 */
export function parseManifest(buf: Buffer | Uint8Array): BackupManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(buf).toString("utf8"));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  if (obj.version !== MANIFEST_VERSION) return null;
  if (!isFiniteNonNegativeInteger(obj.uncompressedSizeBytes)) return null;
  if (!Array.isArray(obj.tables)) return null;

  const tables: BackupManifestTableEntry[] = [];
  for (const entry of obj.tables) {
    if (!entry || typeof entry !== "object") return null;
    const e = entry as Record<string, unknown>;
    if (!isString(e.name)) return null;
    if (!isFiniteNonNegativeInteger(e.rowCount)) return null;
    tables.push({ name: e.name, rowCount: e.rowCount });
  }

  return {
    version: MANIFEST_VERSION,
    uncompressedSizeBytes: obj.uncompressedSizeBytes,
    tables,
  };
}
