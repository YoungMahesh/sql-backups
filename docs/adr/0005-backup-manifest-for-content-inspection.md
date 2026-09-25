# 0005. Backup Manifest for Content Inspection

## Status
accepted

## Context and Decision
Users of the dashboard can take and download Database Backups, but they have no way to verify a backup captured what they expected without downloading the entire `.sql.gz`, decompressing it locally, and opening it in a MySQL client. The only signal after a scheduled run is `status` plus a compressed byte count — neither tells the user whether the right tables and rows were captured.

To enable in-browser content inspection, the dump pipeline needs two things: a fast lookup of "what tables and row counts are in this dump" (used by the inspector's Tables tab and by the raw-view size guardrail), and the ability to materialise a table's schema and first N rows on demand. The chosen design captures a tiny **Backup Manifest** JSON sibling at dump time — listed base tables, per-table row counts, and the uncompressed byte count — and pairs it with an on-demand server-side parse of the gzipped dump for schema and row extraction.

The manifest is uploaded to S3 after the dump upload completes, as a sibling `.manifest.json` object at `backups/{userId}/{databaseName}_{timestamp}.manifest.json` (derived from the dump's key). The upload is best-effort: a manifest upload failure logs a warning and does not fail the backup. A backup that successfully captures data but fails to capture a manifest appears in the dashboard as if it had been created before the feature shipped — the Inspect button is disabled for it, with a tooltip explaining why. No backfill is performed for pre-existing backups.

The manifest schema is a single-versioned JSON document:

```
{
  "version": 1,
  "uncompressedSizeBytes": number,
  "tables": [{ "name": string, "rowCount": number }]
}
```

`version: 1` is the migration hook for future schema evolution. Consumers validate on read with a hand-rolled schema check; no validation library is added.

A hand-rolled SQL parser in `lib/backup-parser.ts` walks the dump format produced by the writer. The format is bounded (we control the writer): header comments, per-table sections (`DROP TABLE IF EXISTS`, `CREATE TABLE`, batched `INSERT INTO ... VALUES (...);`), view sections, trigger sections using `DELIMITER ;;`. A state machine yields discriminated statements; thin wrappers expose `extractTableSchema` and `extractTableRows` that filter and materialise. Value parsing inverts the writer's value-escape function: handles `NULL`, `'0'`/`'1'` for booleans, finite numbers, datetime strings, Buffers encoded as `X'...'`, JSON-encoded objects, and the MySQL escape sequences (`\\`, `\'`, `\0`, `\n`, `\r`, `\Z`).

The writer pipeline gains one new piece — an `uncompressedByteCounter` Transform sitting between `PassThrough` and `gzip` — and tracks per-table row counts as the table loop iterates. The manifest is built from that state after the dump upload completes.

## Considered Options
1. **A JSON column on `database_backup`** (rejected): forces a Drizzle migration for every existing row, ties the manifest's lifecycle to the database record rather than the S3 object, and adds a hot column read to every backup-list query even for backups whose manifest isn't being inspected.
2. **A precomputed sample-row manifest** (rejected): commits us to a sample size at backup time and would be misleading for "did the right data get captured?" — the user's stated motivation is sanity checking, which demands parsing the dump itself.
3. **Lazy backfill of manifests for existing backups on first inspect** (rejected): imposes a heavy parse on the first inspect of any old backup and adds a backfill-state-machine in the inspect code path. The cleaner UX is a clear "this backup predates inspection" indicator and a working Inspect button for everything created going forward.
4. **Sibling Backup Manifest JSON in object storage + on-demand parse of the dump** (chosen): keeps the manifest alongside its dump (same lifecycle, no migration, no schema change), keeps row previews authoritative by parsing the dump on demand, and degrades gracefully to a disabled Inspect button for unmanifested backups.

## Consequences
- A new `.manifest.json` object is uploaded alongside each Database Backup dump, at a key derived from the dump key (`{dumpKey}.sql.gz` → `{dumpKey}.manifest.json`).
- `lib/mysql-backup.ts` extends the writer pipeline with an uncompressed-byte counter and per-table row-count tracking. The existing scheduled backup pipeline inherits the manifest capture for free.
- `lib/s3.ts` gains `uploadBackupManifest` and (later) `fetchBackupManifest`. The fetcher returns `null` on any error (missing object, malformed JSON, schema mismatch) so the inspector can treat all three uniformly as "manifest unavailable".
- A new `lib/backup-parser.ts` module provides `extractTableSchema` and `extractTableRows` that operate on a gzipped `Readable` stream of the dump. The parser uses Node's built-in `zlib.createGunzip` and `readline.createInterface` — no third-party SQL parser is added.
- `database_backup` table is unchanged. No Drizzle migration is required for this feature.
- Pre-feature backups remain inspectable only as "download or delete"; the Inspect button is rendered disabled with a tooltip for them.
- A failed manifest upload logs a warning and does not fail the backup; the backup is still listed, downloadable, and deletable. Its Inspect button will be disabled on first attempt.
- `escapeSqlValue` now serialises JavaScript booleans as quoted `'1'` / `'0'` rather than unquoted `1` / `0`. This aligns the on-disk representation with the parser's value-inversion contract (`'0'`/`'1'` for booleans) and is required for the inspector to reconstruct boolean row values. The resulting SQL is still valid MySQL and round-trips through any standard client.
