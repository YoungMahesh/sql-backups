# Remote libSQL / Turso SQLite Target Database Backups

Status: ready-for-agent

## Problem Statement

Users of SQL Backups rely on the platform to connect to, inspect, and automate backups for MySQL and PostgreSQL databases. However, many modern applications and microservices store production data in SQLite databases deployed remotely using the libSQL / Turso distributed database protocol (`libsql://`). Currently, connecting to or backing up an external SQLite Target Database is unsupported: the platform restricts database engines to `'mysql' | 'postgres'`, connection forms expect host/port/username credentials rather than database URLs and bearer auth tokens, and the backup pipeline lacks an in-process libSQL streaming extraction engine. Users operating remote SQLite instances on Turso must use disjoint manual export scripts, resulting in fragmented disaster recovery workflows and a lack of centralized scheduled backup visibility.

## Solution

Extend SQL Backups to support remote libSQL / Turso SQLite as a first-class Target Database engine alongside MySQL and PostgreSQL, using the `'sqlite'` engine discriminator.

Users can select `SQLite (Turso / libSQL)` in the connection explorer, enter a database URL (e.g. `libsql://<db-name>-<org>.turso.io`) and a bearer auth token, test connectivity, and store encrypted connection profiles. For SQLite targets, the application uses an in-process streaming backup exporter powered by `@libsql/client` to reconstruct table, index, and view definitions from `sqlite_schema`, preserve autoincrement sequence counters from `sqlite_sequence`, and stream table data as batched SQL `INSERT` statements directly into gzip-compressed S3 storage alongside companion JSON Backup Manifests. The Content Inspector drawer, raw SQL code viewer, and pre-signed download endpoints inspect and preview SQLite backups with zero specialized binary requirements. The background scheduler dispatches scheduled backups polymorphically across all three database engines.

## User Stories

1. As a database administrator, I want to select `SQLite (Turso)` when adding a new Target Database connection, so that I can store connection profiles for my remote Turso / libSQL databases.
2. As a database administrator, I want the connection form to adapt to show Database URL and Auth Token inputs when SQLite is selected, so that I can easily enter my Turso database credentials.
3. As a database administrator, I want to paste a full connection string (`libsql://<db-name>-<org>.turso.io?authToken=<token>`), so that I can quickly import credentials copied from the Turso dashboard.
4. As a database administrator, I want to test a remote libSQL connection before saving it, so that I know my database URL and auth token are valid.
5. As a database administrator, I want the system to auto-derive the database name from the URL prefix (with an optional manual override field), so that I don't have to retype my database name unnecessarily.
6. As a database administrator, I want my Turso database URL and auth token to be stored encrypted at rest in the Application Database, so that sensitive credentials remain protected.
7. As a database administrator, I want to see an engine indicator badge (`SQLite`) on every Saved Connection card, so that I can immediately distinguish between different database engines at a glance.
8. As a database administrator, I want to list the User Database on a connected libSQL target, so that I can inspect table counts and trigger backups.
9. As a database administrator, I want to trigger an immediate Database Backup of a remote SQLite database to S3-compatible storage, so that I can capture a snapshot before a schema migration or release.
10. As a database administrator, I want SQLite backups to stream directly through Gzip compression into object storage in-process, so that backups do not require host OS binaries or consume server disk space.
11. As a database administrator, I want table definitions from `sqlite_schema` (including column types, NOT NULL constraints, primary keys, and foreign keys) to be accurately reconstructed, so that my backup dumps contain complete DDL for restoration.
12. As a database administrator, I want views, triggers, and secondary indexes to be preserved in the SQLite backup dump, so that the restored database is fully functional.
13. As a database administrator, I want autoincrement counter states in `sqlite_sequence` to be captured, so that primary key generation continues seamlessly upon database restoration.
14. As a database administrator, I want internal query planner tables (`sqlite_stat*`) excluded from backup manifests and dumps, so that backups remain clean and deterministic.
15. As a database administrator, I want SQLite data types (NULL, integers, reals, text, binary blobs via `X'...'` literals, and JSON) properly escaped in SQL dump `INSERT` statements, so that restored data preserves fidelity.
16. As a database administrator, I want a sibling Backup Manifest JSON file uploaded to S3 alongside each SQLite backup, so that table row counts and uncompressed byte size are immediately inspectable without parsing the archive.
17. As a database administrator, I want to open the backup inspector for an SQLite backup from the dashboard, so that I can verify the tables and row counts captured in the dump.
18. As a database administrator, I want to inspect the `CREATE TABLE` DDL of any table in an SQLite backup, so that I can verify column definitions and constraints captured during the backup.
19. As a database administrator, I want to preview up to 100 sample rows from any table in an SQLite backup, so that I can confirm data was serialized accurately.
20. As a database administrator, I want to view the raw decompressed SQL text of an SQLite backup up to 50 MB in the code viewer, so that I can examine statements and syntax.
21. As a database administrator, I want to download the compressed `.sql.gz` SQLite backup file directly from S3, so that I can restore it locally or in staging with standard SQLite tools.
22. As a database administrator, I want to create a Scheduled Backup for an SQLite User Database with a cron recurrence and timezone, so that regular snapshots happen automatically.
23. As a database administrator, I want the background scheduler to automatically execute due SQLite Scheduled Backups, so that I do not need separate cron jobs or infrastructure.
24. As a database administrator, I want to view Backup Run records for SQLite schedules showing execution status (`success`, `failed`, `skipped`, `running`), so that I have an audit trail of backup activity.
25. As a database administrator, I want SQLite scheduled runs to adhere to configured retention policies, so that old SQLite backups are pruned from S3 and the Application Database according to retention count.
26. As a database administrator, I want informative error messages if an SQLite backup fails (e.g. invalid auth token, network timeout, unavailable database), so that I can diagnose and fix target connection issues.
27. As a database administrator, I want existing MySQL and PostgreSQL Saved Connections, Scheduled Backups, and Database Backups to continue functioning seamlessly without data loss or breaking changes.

## Implementation Decisions

### Application Database Schema & Engine Discriminator

- The `engine` column in `saved_connection`, `database_backup`, and `backup_schedule` is extended to support `'mysql' | 'postgres' | 'sqlite'`.
- The default value remains `'mysql'` to provide backward compatibility for all existing rows and connections.
- For SQLite connections: `host` stores the Turso hostname (e.g. `my-app-org.turso.io`), `port` defaults to `443`, and `database` stores the database name.
- The full database URL along with its auth token is encrypted at rest in `encryptedConnectionString`.
- Drizzle migrations are generated with `pnpm run db-generate` and applied with `pnpm run db-migrate`.

### Connection Parsing & Encryption (`lib/crypto.ts`)

- `parseConnectionString` is extended to recognize `libsql://` and `https://` URLs.
- When parsing a `libsql://` or `https://` URL:
  - Sets `engine: 'sqlite'`.
  - Extracts the database name from the URL subdomain or pathname.
  - Extracts the bearer auth token from `authToken` search param or username.
  - Defaults port to `443`.
- `serializeToConnectionString` produces a canonical `libsql://` URL preserving the auth token in query parameters.

### In-Process SQLite Streaming Backup Exporter (`lib/sqlite-backup.ts`)

- Implements an in-process streaming backup exporter using the official `@libsql/client` driver.
- Reconstructs schema definitions by querying `sqlite_schema`:
  - Discovers user tables (`type='table' AND name NOT LIKE 'sqlite_%'`).
  - Serializes `DROP TABLE IF EXISTS "table";` and verbatim `CREATE TABLE ...;`.
  - Discovers and serializes indexes and views.
  - Queries `sqlite_sequence` if present and generates sequence restoration statements for user tables.
  - Excludes internal planner statistics (`sqlite_stat*`) and system metadata tables.
- Streams table rows in batched chunks as SQL `INSERT INTO "table" ("col1", "col2") VALUES (...)`:
  - Uses standard double-quoted table and column identifiers.
  - Serializes literals: nulls as `NULL`, numbers as raw numeric literals, strings with SQL single-quote escaping (`''`), binary buffers as SQLite hex blob literals (`X'...'`), booleans as `1`/`0`, and objects as JSON string literals.
- Tracks uncompressed byte size and row counts per table during streaming.
- Pipes the serialized stream through Node's `zlib.createGzip()` directly into S3 object storage with full backpressure handling.
- Uploads a sibling Backup Manifest JSON file (`.manifest.json`) to S3 under the same key prefix.

### Polymorphic Backup Dispatcher (`lib/backup-runner.ts`)

- Extends `DatabaseEngine` type to `"mysql" | "postgres" | "sqlite"`.
- Adds test seam `libsqlClient?: Client` to `RunBackupOptions` for mock testing.
- Dispatches `engine === "sqlite"` to `backupSqliteDatabaseToS3`.

### Parallel Engine API Endpoints (`/api/sqlite/*`)

- Exposes parallel API routes under `/api/sqlite/*` mirroring existing `/api/mysql/*` and `/api/postgres/*` routes:
  - `/api/sqlite/connections`: Test, create, list, and delete SQLite Saved Connections.
  - `/api/sqlite/databases`: Test connection and return single database instance.
  - `/api/sqlite/schedules`: List and create Scheduled Backups for SQLite databases.
  - `/api/sqlite/schedules/[id]`: Retrieve, update, and delete schedules.
  - `/api/sqlite/schedules/[id]/runs`: Retrieve execution history for an SQLite schedule.
  - `/api/sqlite/backups`: List and trigger manual SQLite Database Backups.
  - `/api/sqlite/backups/[id]`: Delete a backup.
  - `/api/sqlite/backups/[id]/download`: Generate a download URL for the compressed dump.
  - `/api/sqlite/backups/[id]/manifest`: Fetch the Backup Manifest.
  - `/api/sqlite/backups/[id]/raw-url`: Generate a pre-signed URL for client-side raw dump streaming.
  - `/api/sqlite/backups/[id]/tables/[table]/schema`: Extract table DDL from the backup.
  - `/api/sqlite/backups/[id]/tables/[table]/rows`: Extract sample rows from the backup.

### Content Inspection Parity (`lib/backup-parser.ts`)

- The SQLite exporter outputs standard double-quoted table names and batched `INSERT INTO "table"` statements, matching the format already parsed by `extractTableSchema` and `extractTableRows`.
- Inspection, row preview, and raw SQL viewer work out of the box with zero specialized binary inspection logic.

### Dashboard UI and Engine Selection

- The target connection form in `components/database-explorer.tsx` features a 3-way segmented toggle: `[ MySQL ] | [ PostgreSQL ] | [ SQLite (Turso) ]`.
- Selecting `SQLite (Turso)` switches the form fields to **Database URL** (`libsql://...`) and **Auth Token** (masked password input).
- Displays `SQLite` badges in saved connection cards, schedule rows, and backup tables.

## Testing Decisions

### Good Test Principles

- Tests must verify external observable behavior (API responses, generated SQL dump contents, manifest accuracy, DDL structure) rather than internal private variables.
- Stream handling and backpressure must be tested using real streaming pipelines and sinks.
- Schema parsing must be verified across edge cases (escaped quotes, blob literals, sequence preservation).

### Testing Seams

The primary seam across the backup pipeline is:
- **`runBackup({ engine: 'sqlite', libsqlClient: mockClient, manifestSink })` in `lib/backup-runner.ts`**:
  Allows comprehensive unit testing of query execution, schema catalog parsing, batched insert streaming, compression, manifest generation, and error handling without external network dependencies.
- **`extractTableSchema` and `extractTableRows` in `lib/backup-parser.ts`**:
  Tested by streaming gzipped SQLite `.sql.gz` dump fixtures directly into the parser.
- **`parseConnectionString` and `serializeToConnectionString` in `lib/crypto.ts`**:
  Tested across diverse `libsql://` and `https://` URLs and auth tokens.

### Modules to Test

1. **SQLite Backup Exporter (`lib/sqlite-backup.ts`)**:
   - Unit tests verifying catalog querying from `sqlite_schema`, DDL generation, sequence preservation via `sqlite_sequence`, blob/type escaping, gzip streaming, manifest calculation, and error propagation using a mock client and manifest sink.
2. **Polymorphic Backup Runner (`lib/backup-runner.ts`)**:
   - Unit tests verifying dispatching to SQLite exporter when `engine === 'sqlite'`, and ensuring unsupported engines are rejected.
3. **Connection Parsing & Serialization (`lib/crypto.ts`)**:
   - Unit tests for `libsql://` URL parsing, token extraction, and round-trip serialization.
4. **Dialect-Aware Backup Parser (`lib/backup-parser.ts`)**:
   - Unit tests feeding gzipped SQLite dump streams to verify table schema extraction (`extractTableSchema`) and row preview extraction (`extractTableRows`).
5. **Application Database Integration (`tests/integration/`)**:
   - Integration tests verifying saving, querying, and filtering connections and backups with `engine: 'sqlite'`.

### Prior Art

- `tests/unit/postgres-backup.test.ts`: Template for testing stream-based dump generation, manifest sinks, and literal escaping using mock client connections.
- `tests/unit/backup-runner.test.ts`: Template for testing polymorphic engine dispatching.
- `tests/unit/backup-parser.test.ts`: Template for testing SQL statement parsing and row extraction against gzipped streams.
- `tests/integration/saved-connections.test.ts`: Pattern for validating CRUD operations on saved connections in the Application Database.

## Out of Scope

- Local host filesystem file paths (`/var/data/app.db`) or volume mounts.
- Binary SQLite snapshot (`.sqlite.gz`) or raw file copying.
- Turso Platform Management REST API integration (listing all databases across an organization).
- SQLite CLI binary execution (`sqlite3 .dump`).
- Database engines other than MySQL, PostgreSQL, and SQLite.

## Further Notes

- All changes adhere strictly to the repository's single-light theme and design guidelines in `DESIGN.md`.
- Historical ADR 0009 (Multi-Engine Target Backups) and newly recorded ADR 0010 (Remote libSQL / Turso SQLite Target Backups) provide foundational architectural context.
