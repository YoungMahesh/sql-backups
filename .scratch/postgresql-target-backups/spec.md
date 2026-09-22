# PostgreSQL Target Database Backups

Status: ready-for-agent

## Problem Statement

Users of SQL Backups rely on the platform to connect to, inspect, and automate backups for MySQL databases. However, many production environments and cloud applications store critical business data in PostgreSQL instances. Currently, attempting to connect to or back up an external PostgreSQL Target Database is unsupported: the platform assumes port 3306 and MySQL protocols throughout the application database schema, connection forms, backup pipeline, API routes, and dump inspection utilities. Users who operate PostgreSQL databases have to use disjoint manual scripts or separate tooling to safeguard their databases, resulting in fragmented disaster recovery workflows and a lack of centralized scheduled backup visibility.

## Solution

Extend SQL Backups to support PostgreSQL as a first-class Target Database engine alongside MySQL. 

Users can now select between MySQL and PostgreSQL when saving connections, entering target server credentials (host, port, credentials, database), and running manual or scheduled backups. For PostgreSQL targets, the application uses an in-process streaming backup exporter to inspect database catalogs, reconstruct table definitions, and stream table data as batched SQL `INSERT` statements directly into gzip-compressed S3 storage alongside sidecar Backup Manifests. The backup inspector supports both database engines, allowing users to view PostgreSQL table schemas and inspect sample row data directly in the dashboard. The background scheduler dispatches scheduled backups polymorphically across both database engines.

## User Stories

1. As a database administrator, I want to select PostgreSQL when adding a new Target Database connection, so that I can store credentials for my PostgreSQL instances.
2. As a database administrator, I want the connection form to automatically default the port to 5432 when I choose PostgreSQL, so that I don't have to manually replace the MySQL 3306 port each time.
3. As a database administrator, I want to test a PostgreSQL connection before saving it, so that I know my credentials and host network connectivity are valid.
4. As a database administrator, I want to see an engine indicator (MySQL vs PostgreSQL) on every Saved Connection card, so that I can immediately distinguish between different database engines at a glance.
5. As a database administrator, I want to list available User Databases on a connected PostgreSQL server, so that I can pick which database to inspect or back up.
6. As a database administrator, I want system databases (`postgres`, `template0`, `template1`) filtered out of the PostgreSQL database dropdown, so that I don't accidentally attempt to back up internal system templates.
7. As a database administrator, I want to trigger an immediate Database Backup of a PostgreSQL database to S3-compatible storage, so that I can capture a snapshot before a schema migration or deployment.
8. As a database administrator, I want PostgreSQL backups to stream directly through compression into object storage, so that large database dumps do not consume server memory or local disk space.
9. As a database administrator, I want PostgreSQL table definitions to be accurately reconstructed (including column data types, default expressions, NOT NULL constraints, primary keys, and foreign keys), so that my backup dumps contain complete DDL for restoration.
10. As a database administrator, I want all user schemas (including `public` and custom application schemas) to be included in the PostgreSQL backup, so that multi-schema PostgreSQL applications are backed up completely.
11. As a database administrator, I want table names in PostgreSQL manifests to be schema-qualified (`schema.table`), so that tables with identical names in different schemas do not collide.
12. As a database administrator, I want a Backup Manifest sibling JSON file uploaded to S3 alongside each PostgreSQL backup, so that table row counts and uncompressed byte size are immediately inspectable without parsing the whole archive.
13. As a database administrator, I want to open the backup inspector for a PostgreSQL backup from the dashboard, so that I can verify the tables and row counts captured in the dump.
14. As a database administrator, I want to inspect the `CREATE TABLE` DDL of any table in a PostgreSQL backup, so that I can verify column types and constraints captured during the backup.
15. As a database administrator, I want to preview up to 100 sample rows from any table in a PostgreSQL backup, so that I can confirm data was serialized accurately.
16. As a database administrator, I want to view the raw decompressed SQL text of a PostgreSQL backup up to 50 MB in the code viewer, so that I can examine statements and syntax.
17. As a database administrator, I want to download the compressed `.sql.gz` PostgreSQL backup file directly from S3, so that I can restore it locally or in staging with standard tools.
18. As a database administrator, I want to create a Scheduled Backup for a PostgreSQL User Database with a cron recurrence and timezone, so that regular snapshots happen automatically.
19. As a database administrator, I want the background scheduler to automatically execute due PostgreSQL Scheduled Backups, so that I do not need separate cron jobs or infrastructure.
20. As a database administrator, I want to view Backup Run records for PostgreSQL schedules showing execution status (`success`, `failed`, `skipped`, `running`), so that I have an audit trail of backup activity.
21. As a database administrator, I want PostgreSQL scheduled runs to adhere to configured retention policies, so that old PostgreSQL backups are pruned from S3 and the Application Database according to retention count.
22. As a database administrator, I want special data types in PostgreSQL (e.g. JSONB, UUID, timestamps with timezone, byte arrays, booleans, and nulls) properly escaped in SQL dump INSERT statements, so that restored data preserves fidelity.
23. As a database administrator, I want informative error messages if a PostgreSQL backup fails (e.g. invalid permissions, network timeout, authentication failure), so that I can diagnose and fix target connection issues.
24. As a database administrator, I want existing MySQL Saved Connections, Scheduled Backups, and Database Backups to continue functioning seamlessly without data loss or breaking changes.

## Implementation Decisions

### Application Database Schema & Engine Discriminator

- The `saved_connection` and `database_backup` tables in the Application Database are extended with an `engine` column (`varchar` with length 32, values `'mysql' | 'postgres'`).
- The `engine` column defaults to `'mysql'` to provide backward compatibility for all existing rows and connections.
- The `port` column in `saved_connection` remains an integer, with validation allowing 3306 for MySQL and 5432 for PostgreSQL by default.
- Lookup indexes on `saved_connection` incorporate `userId`, `host`, `port`, `username`, and `database`.
- Drizzle migrations are generated and applied via the standard repository workflow.

### In-Process PostgreSQL Streaming Backup Exporter

- PostgreSQL backups are exported using an in-process TypeScript streaming engine rather than relying on the host OS `pg_dump` binary. This ensures zero external binary dependencies and identical behavior across local development, containerized deployments, and serverless environments.
- The connection to the target PostgreSQL server is managed via the project's existing PostgreSQL client driver.
- The exporter queries PostgreSQL system catalogs (`information_schema` and `pg_catalog`) to discover user tables across all non-system schemas (excluding `pg_catalog`, `information_schema`, and internal `pg_toast*` namespaces).
- System databases (`postgres`, `template0`, `template1`) are excluded from target database selection and backup.
- Table DDL statements (`CREATE TABLE`) are reconstructed using PostgreSQL catalog definitions and built-in helper functions (such as `pg_get_constraintdef`, `pg_get_expr`, and `pg_get_indexdef`) to ensure faithful syntax for columns, default values, constraints, and keys.
- Table data is serialized as batched SQL `INSERT INTO "schema"."table" ("col1", "col2") VALUES (...)` statements with proper literal escaping for strings, numbers, booleans, dates, timestamps, JSON/JSONB, and binary hex literals.
- Uncompressed byte tracking and row counting are computed during streaming. The serialized stream pipes through Node's `zlib.createGzip()` directly into S3 object storage with full backpressure handling.
- A sibling Backup Manifest JSON file (`.manifest.json`) is uploaded to S3 upon dump completion, containing the version, uncompressed byte size, and table row count array.

### Polymorphic Backup Dispatcher

- A backup runner seam is introduced to decouple backup execution from specific database engines.
- Callers (including API route handlers and the background scheduler) invoke the backup runner with a target configuration and engine discriminator (`'mysql' | 'postgres'`).
- The dispatcher delegates to either the MySQL backup exporter or the PostgreSQL backup exporter based on the engine.

### Parallel Engine API Endpoints

- API routes under `/api/postgres/*` are introduced, mirroring the existing `/api/mysql/*` contracts:
  - `/api/postgres/connections`: Test, create, list, and delete PostgreSQL Saved Connections.
  - `/api/postgres/connections/[id]/databases`: List non-system databases for a connection.
  - `/api/postgres/schedules`: List and create Scheduled Backups for PostgreSQL databases.
  - `/api/postgres/schedules/[id]`: Retrieve, update, and delete schedules.
  - `/api/postgres/schedules/[id]/runs`: Retrieve execution history for a schedule.
  - `/api/postgres/backups`: List and trigger manual PostgreSQL Database Backups.
  - `/api/postgres/backups/[id]`: Delete a backup.
  - `/api/postgres/backups/[id]/download`: Generate a download URL for the compressed dump.
  - `/api/postgres/backups/[id]/manifest`: Fetch the Backup Manifest.
  - `/api/postgres/backups/[id]/raw-url`: Generate a pre-signed URL for client-side raw dump streaming.
  - `/api/postgres/backups/[id]/tables/[table]/schema`: Extract table DDL from the backup.
  - `/api/postgres/backups/[id]/tables/[table]/rows`: Extract sample rows from the backup.

### Dialect-Aware Backup Parser for Content Inspection

- The dump parser module is updated to support both MySQL and PostgreSQL SQL dialects:
  - Supports double-quoted identifiers (`"schema"."table"`, `"column"`) in addition to MySQL backtick identifiers (`` `table` ``).
  - Recognizes PostgreSQL `CREATE TABLE` blocks and extracts table DDL verbatim.
  - Parses batched `INSERT INTO "schema"."table"` statements to extract sample rows up to the configured limit (100 rows).
  - Handles schema-qualified table names (`schema.table`) in parser queries.

### Dashboard UI and Engine Selection

- The target connection form includes a segmented toggle (`[ MySQL ]` | `[ PostgreSQL ]`) styled according to the design system (warm coral active states, single-light canvas tokens).
- Switching the engine toggle updates default ports (3306 ↔ 5432), placeholder connection details, and validation rules.
- Saved Connection cards and database explorer lists display distinct visual badges indicating whether a target is MySQL or PostgreSQL.
- Schedule creation and backup list views correctly identify the engine and route inspection requests to the appropriate endpoints.

## Testing Decisions

### Good Test Principles

- Tests must verify external observable behavior (API responses, generated SQL dump contents, manifest accuracy, DDL structure) rather than internal private variables.
- Stream handling and backpressure must be tested using real streaming pipelines and sinks.
- Schema parsing must be verified across edge cases (special characters, escaped quotes, various column types, multi-schema tables).

### Modules to Test

1. **PostgreSQL Backup Exporter**:
   - Unit tests verifying catalog querying, DDL generation, row batch serialization, gzip streaming, manifest calculation, and error propagation.
   - Verified using mock connection and manifest sink test seams, avoiding mandatory external network requirements in unit test suites.
2. **Dialect-Aware Backup Parser**:
   - Unit tests feeding gzipped PostgreSQL dump streams to verify table schema extraction (`extractTableSchema`) and row preview extraction (`extractTableRows`).
   - Edge case testing for double-quoted identifiers, multi-line values, timestamps, and escaped characters.
3. **Application Database & Saved Connections**:
   - Integration tests verifying saving, updating, and querying connections and backups with the new `engine` column.
   - Verifying default `'mysql'` backfill on existing rows.
4. **API Route Handlers**:
   - Unit/integration tests for `/api/postgres/*` routes validating session authentication, payload validation, and responses.

### Prior Art

- `tests/unit/mysql-backup.test.ts`: Template for testing stream-based dump generation and manifest sinks using mock client connections.
- `tests/unit/backup-parser.test.ts`: Template for testing SQL statement parsing and row extraction against gzipped streams.
- `tests/integration/saved-connections.test.ts`: Pattern for validating CRUD operations on saved connections in the Application Database.

## Out of Scope

- CLI binary execution (`pg_dump` or `pg_restore`).
- Direct automated restore execution into a remote PostgreSQL server (restore remains manual via downloaded `.sql.gz` dump).
- Per-table backup selection (backups capture all user tables in the selected database).
- Continuous replication or write-ahead log (WAL) archiving.
- Database engines other than MySQL and PostgreSQL (e.g. SQLite, Microsoft SQL Server, Oracle).

## Further Notes

- All changes adhere strictly to the repository's single-light theme and design guidelines in `DESIGN.md`.
- Historical ADRs 0006 (PostgreSQL for Application Database) and 0009 (Multi-Engine Target Backups) provide foundational architecture context.
