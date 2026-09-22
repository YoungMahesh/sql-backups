# 0010. Remote libSQL / Turso SQLite Target Backups

## Status
accepted

## Context and Decision
SQL Backups previously supported MySQL and PostgreSQL target databases for connection, automated scheduling, in-process streaming backups to S3, and content inspection (ADR 0009). Users require the ability to connect to and back up SQLite databases running remotely via the libSQL / Turso protocol.

We decided to support remote libSQL / Turso databases as a first-class Target Database with the `'sqlite'` engine discriminator by:
1. Expanding the `engine` column type (`'mysql' | 'postgres' | 'sqlite'`) across `saved_connection`, `database_backup`, and scheduling tables.
2. Using `@libsql/client` for in-process network communication over `libsql://` and `https://` protocols using database URLs and bearer auth tokens.
3. Implementing an in-process streaming backup exporter (`lib/sqlite-backup.ts`) that extracts table, index, and view DDL from `sqlite_schema`, preserves autoincrement sequence counters via `sqlite_sequence`, and streams batched `INSERT INTO` statements through gzip directly to S3 alongside a companion JSON Backup Manifest.
4. Exposing parallel `/api/sqlite/*` endpoints mirroring `/api/mysql/*` and `/api/postgres/*` for connections, database testing, backups, and schedules.
5. Adapting the UI Connection Explorer with a 3-way toggle (`[ MySQL ] | [ PostgreSQL ] | [ SQLite (Turso) ]`) that presents dedicated Database URL and Auth Token fields.

## Considered Options
1. **Local Host Filesystem SQLite**: Requires mounting file volumes and introduces server-side path traversal and file disclosure security risks.
2. **Binary Database Snapshot (`.sqlite.gz`)**: Breaks compatibility with the existing Content Inspector (`lib/backup-parser.ts`), which parses SQL text to render table schemas and sample rows.
3. **Remote libSQL Streaming SQL Dump (Chosen)**: Secure over network protocols (`libsql://`, `https://`), leverages official `@libsql/client`, produces standard `.sql.gz` + `.manifest.json` artifacts, and integrates seamlessly with the existing Content Inspector drawer and raw SQL viewer.

## Consequences
- `saved_connection` stores the Turso hostname in `host`, defaults port to `443`, and encrypts the full URL and bearer token in `encryptedConnectionString`.
- A remote libSQL connection targets a single database instance whose name is derived from the URL subdomain (e.g. `my-app` from `my-app-org.turso.io`) with optional manual override.
- Backups are stored in S3 under `backups/{userId}/sqlite/{databaseName}/{timestamp}_{uuid}.sql.gz` with sibling `.manifest.json`.
- The polymorphic backup runner seam (`lib/backup-runner.ts`) dispatches `'sqlite'` jobs to `backupSqliteDatabaseToS3`.
- `CONTEXT.md` reflects remote libSQL / Turso SQLite as supported Target Databases.
