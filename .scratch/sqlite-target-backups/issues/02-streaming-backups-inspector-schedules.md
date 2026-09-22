# 02: In-Process Streaming Backups, Content Inspector & Automated Scheduling

**What to build:** 
Allow users to run manual and automated backups for remote libSQL / Turso SQLite databases to S3-compatible storage, inspect backup contents, and configure automated cron schedules with retention pruning. An in-process streaming backup exporter (`lib/sqlite-backup.ts`) queries `sqlite_schema` to reconstruct table, view, and index DDL, captures `sqlite_sequence` state to maintain autoincrement sequence counters, serializes typed column values (including blobs and JSON), and streams batched `INSERT INTO` statements through Gzip directly into S3 alongside companion JSON Backup Manifests. The polymorphic backup runner integrates `'sqlite'` dispatching, powering parallel `/api/sqlite/backups/*` and `/api/sqlite/schedules/*` endpoints. Users can trigger immediate backups, inspect schemas and sample rows in the Content Inspector drawer, view raw decompressed SQL dumps, download `.sql.gz` files, and manage recurring scheduled backups with automated background execution and retention pruning.

**Blocked by:** 01: Schema Foundation, Remote libSQL Connection Management & Database Explorer

**Status:** ready-for-agent

- [ ] In-process streaming SQLite backup exporter (`lib/sqlite-backup.ts`) connects via `@libsql/client`, reconstructs table DDL, views, and indexes from `sqlite_schema`, preserves autoincrement sequence counters from `sqlite_sequence`, and streams batched `INSERT INTO` statements through Gzip into S3.
- [ ] Companion JSON Backup Manifest (`.manifest.json`) is uploaded alongside each SQLite backup, capturing table row counts and uncompressed byte size.
- [ ] SQLite literal serialization properly formats NULLs, numbers, escaped strings, hex blob literals (`X'...'`), booleans (`1`/`0`), and JSON objects.
- [ ] The polymorphic backup runner in `lib/backup-runner.ts` dispatches `engine === "sqlite"` to `backupSqliteDatabaseToS3`, providing mock test seams (`libsqlClient`, `manifestSink`).
- [ ] Parallel endpoints under `/api/sqlite/backups/*` handle backup listing, triggering, deletion, pre-signed download, manifest retrieval, raw URL streaming, and table schema/rows extraction.
- [ ] Parallel endpoints under `/api/sqlite/schedules/*` handle schedule creation, listing, updating, deletion, and run history retrieval.
- [ ] The Content Inspector drawer seamlessly renders SQLite tables, `CREATE TABLE` DDL, and sample row previews parsed from `.sql.gz` dumps.
- [ ] Background scheduler automatically triggers due SQLite schedules, records `backup_run` execution history, and enforces backup retention limits.
- [ ] Comprehensive unit and integration tests verify SQLite backup generation, runner dispatching, manifest generation, dump parsing, and scheduling workflows.
