# 0009. Multi-Engine Target Backups (PostgreSQL Support)

## Status
accepted

## Context and Decision
SQL Backups was originally designed with MySQL as its sole target database engine for connection, inspection, and automated backups to S3, while PostgreSQL served as the internal application database (ADR 0006). Users require the ability to connect to, inspect, and back up external PostgreSQL databases using the same automated scheduling and inspection workflows.

We decided to support PostgreSQL as a first-class Target Database alongside MySQL by:
1. Adding an `engine` column (`'mysql' | 'postgres'`) to the unified `saved_connection` and `database_backup` application database tables.
2. Implementing an in-process streaming backup exporter (`lib/postgres-backup.ts`) using `postgres.js` that reconstructs table DDL via PostgreSQL catalog functions (`pg_get_constraintdef`, `pg_get_expr`, `pg_get_indexdef`) and streams schema-qualified table rows as batched `INSERT` statements directly through gzip into S3 without requiring the OS `pg_dump` CLI binary.
3. Exposing parallel `/api/postgres/*` routes mirroring `/api/mysql/*` for connections, database listing, backups, and schedules.
4. Enhancing the backup parser (`lib/backup-parser.ts`) to support double-quoted PostgreSQL identifier syntax and DDL statements for content inspection.
5. Introducing a polymorphic backup runner seam (`lib/backup-runner.ts`) to dispatch scheduled and manual backup executions based on the connection engine.

## Considered Options
1. **Host CLI Execution via `pg_dump`**: Requires host OS binaries and child process management, complicating containerized deployments, lacking cross-platform consistency, and preventing fine-grained per-table progress and manifest calculation.
2. **Separate Engine Tables (`saved_postgres_connection`, etc.)**: Duplicates relational schema tables, migrations, and UI handling for schedules and run histories.
3. **Unified Engine Discrimination & In-Process `postgres.js` Streaming (Chosen)**: Self-contained, leverages existing `postgres.js` dependency, ensures zero host binary requirements, enables granular manifest accounting, and unifies schedule/history management.

## Consequences
- `saved_connection` and `database_backup` schemas include an `engine` discriminator column defaulting to `'mysql'`.
- Schema qualification (`schema.table`) is standard for PostgreSQL table manifests and inspector views.
- System databases (`postgres`, `template0`, `template1`) are excluded from target database listings.
- UI connection form features a segmented toggle (`[ MySQL ] | [ PostgreSQL ]`) that switches default ports (3306 ↔ 5432) and target endpoints.
- `docs/CONTEXT.md` terms for Target Database, User Database, System Database, and Saved Connection are updated to reflect multi-engine support.
