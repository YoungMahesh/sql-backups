# Spec: Isolated PostgreSQL Template Testing Architecture

## Problem Statement

Developers and automated CI pipelines running tests in DB Manage currently lack an isolated database integration testing harness for the PostgreSQL Application Database. Specifically:
1. **Risk of Shared State Pollution**: Running integration tests directly against the local development database specified in `DATABASE_URL` risks wiping or altering developer accounts, saved MySQL connections, and backup schedule configurations.
2. **Slow and Redundant Migrations**: Applying Drizzle schema migrations sequentially inside every test suite would introduce severe latency and prolong feedback loops.
3. **Lack of Test Tier Separation**: Pure business logic (such as SQL dump parsing, cron expression evaluation, AES encryption, and size formatting) is currently co-located with tests in a flat structure, with no clear barrier preventing accidental database or network dependencies in offline workflows.
4. **Offline Development Friction**: Developers working offline or in air-gapped environments need to run fast unit tests without being blocked by network timeouts or missing remote database credentials.

## Solution

Implement an isolated, multi-tiered test database architecture leveraging PostgreSQL native template cloning and Vitest process-level fork isolation powered by a dedicated test server specified by `TEST_DATABASE_SERVER`:
1. **Strict Test Tier Separation**: Separate offline in-memory unit tests (`unit`) from remote PostgreSQL integration tests (`integration`) using Vitest workspace projects. Developers can execute unit tests offline with zero network or database dependencies.
2. **Dedicated Test Database Server**: Integration tests execute strictly against a dedicated remote PostgreSQL server specified by `TEST_DATABASE_SERVER`, ensuring developer workstations and staging environments remain completely untouched.
3. **One-Time Template Provisioning via Global Setup**: Before test workers begin, Vitest global setup validates server reachability, executes an orphan database sweeper, creates a timestamped template database, executes all Drizzle migrations once programmatically, and disables incoming connections to lock the template for fast cloning.
4. **Sub-Second Suite-Level Database Cloning**: Integration test suites run in isolated child processes. Each suite dynamically clones an isolated database from the pre-migrated template in ~500ms using PostgreSQL's native `CREATE DATABASE ... TEMPLATE` mechanism and injects the suite's dedicated connection URL before test module evaluation.
5. **Deterministic Pool Draining and Drop**: At the end of each test suite, the worker gracefully drains its client connection pool sockets before the administrative connection terminates backends and drops the cloned database.
6. **Pre-flight & Abort Orphan Sweeper**: Global setup sweeps and purges any test database older than 2 hours or with an unparseable test prefix, ensuring aborted or killed CI runs never accumulate disk space on the test server. Global teardown drops the session's template database.
7. **Strict Fail-Fast Enforcement**: If `TEST_DATABASE_SERVER` is missing or unreachable when running integration tests, execution halts immediately with clear diagnostic guidance.
8. **Architectural Decision Record**: Record ADR 0007 capturing the decision rationale, performance characteristics, and trade-offs.

## User Stories

1. As a developer working offline (`pnpm test:unit`), I want unit tests for dump parsing, cron calculations, formatting, and AES encryption to run in milliseconds without requiring database connections, network access, or decryption keys, so that I can develop freely anywhere.
2. As a developer running integration tests (`pnpm test:integration`), I want tests to execute against a dedicated PostgreSQL test server (`TEST_DATABASE_SERVER`) rather than my local development database, so that my local application data and saved MySQL connections are never corrupted or deleted.
3. As a developer running the full test suite (`pnpm test`), I want a single command that runs both unit and integration suites with unified reporting, so that I can verify full application correctness before pushing code.
4. As a developer running integration tests without `TEST_DATABASE_SERVER` configured, I want the runner to fail fast immediately with actionable diagnostics, so that I am not left waiting on silent connection timeouts.
5. As a developer running integration tests, I want schema migrations to execute once into a template database at startup, so that individual test suites do not waste time repeatedly applying migrations.
6. As a CI runner executing parallel jobs, I want each test suite to execute against an isolated database cloned from the template, so that concurrent suites cannot read, mutate, or conflict with each other's data.
7. As a test author writing tests for Saved Connections, I want a clean Application Database ready when my suite starts, so that I can test encrypted credentials, user filtering, and connection updates without colliding with other test files.
8. As a test author testing Scheduled Backups and Backup Runs, I want foreign key constraints and status transitions enforced by real PostgreSQL, so that integration tests mirror production behavior rather than emulated SQLite approximations.
9. As a test author testing Database Backups, I want to persist backup manifests and size metadata into real tables, so that schema constraints and nullability rules are rigorously validated.
10. As a developer running tests in watch mode (`pnpm test:watch`), I want the template database to remain active across file saves, so that re-running integration suites takes ~500ms without re-running migrations every time.
11. As a developer aborting a test run with Ctrl+C, I want workers to make a best-effort cleanup of their cloned databases, so that remote server resources are not unnecessarily consumed.
12. As a platform maintainer, I want global setup to automatically sweep and drop orphaned test databases older than 2 hours, so that aborted or killed CI runs never accumulate disk space indefinitely.
13. As a platform maintainer, I want global setup to purge any unparseable or non-conforming test database matching the test prefix, so that malformed test databases are never stranded on the server.
14. As a developer reviewing test logs, I want client database connection pools to be gracefully drained before databases are dropped, so that terminal logs remain clean and free of connection reset or socket hangup warnings.
15. As a developer writing new unit tests, I want a clear directory boundary (`tests/unit/` vs `tests/integration/`), so that I never accidentally import database clients or server configuration into offline test suites.
16. As a future maintainer or AI agent reading repository documentation, I want an Architectural Decision Record (ADR 0007) explaining why PostgreSQL template cloning was chosen over Docker or transactional rollbacks, so that I understand the architectural rationale and trade-offs.

## Implementation Decisions

- **Test Framework and Tiering**: Migrate the test runner to Vitest, configuring two distinct workspace projects: an in-memory `unit` tier and a database `integration` tier. Expose dedicated npm scripts for unified testing, offline unit testing, integration testing, and interactive watch mode.
- **Directory Boundary**: Relocate existing in-memory tests from the library folder into a dedicated unit test directory, and place all database-backed tests in a dedicated integration test directory.
- **Process Isolation**: Configure the integration project with process-level child forks and suite isolation, ensuring environment variables, database URLs, and module caches are cleanly separated across test suites.
- **Suite-Level Provisioning**: Execute database cloning during suite setup prior to test module evaluation, dynamically assigning the suite's database URL to the environment before application routes and database singletons evaluate.
- **Administrative Database Connection**: Establish an administrative client connected to the maintenance database (`postgres`) on the test server to manage database creation, access restriction, and force drops.
- **Template Migration**: Execute Drizzle migrations programmatically in the main process during global setup against the template database.
- **Template Connection Locking**: Once schema migrations complete on the template database, disallow incoming connections (`ALLOW_CONNECTIONS = false`) so that PostgreSQL allows fast template cloning without connection lock conflicts.
- **Database Client Lifecycle**: Refactor the database client module to export the shared connection pool alongside a clean connection draining function, allowing workers to drain active sockets prior to dropping databases.
- **Database Naming Scheme & TTL**: Use a standardized prefix (`db_test_`) with timestamped identifiers for template and cloned databases. Enforce a 2-hour TTL for orphan database cleanup during pre-flight global setup.
- **Template Persistence in Watch Mode**: Preserve the template database throughout a watch session, tearing it down only when the watch session terminates.
- **Documentation**: Document the architecture, constraints, performance benchmarks, and rejected alternatives in ADR 0007.

## Testing Decisions

- **Test Quality Invariants**: Tests must verify externally observable behavior — verifying successful schema migrations, data isolation across processes, proper failure exit codes, and zero orphaned databases — rather than asserting on internal mock calls.
- **Tested Modules**:
  - Offline unit suites: SQL dump parser, cron recurrence and timezone helpers, AES-256 encryption/decryption, byte and relative time formatters, backup manifest serialization/parsing, S3 key generation, and schedule validation.
  - Integration suites: Database lifecycle and isolation verification, Saved Connections persistence and encryption at rest, Scheduled Backups and Backup Runs logging and foreign key cascading, and Database Backup metadata records.
  - Database administrative helpers: template creation, cloning, pool draining, and orphan sweeping.
- **Prior Art**: Existing unit tests in `lib/*.test.ts` (94 tests) passing against in-memory data structures.

## Out of Scope

- Running local Docker containers or Testcontainers (the architecture explicitly relies on the remote PostgreSQL test server).
- In-memory SQLite or PGLite emulation (the Application Database requires native PostgreSQL features).
- Modifying S3 gateway proxy logic or storage quota business rules.
- HTTP route handler mocking across every Next.js API route (the integration tests focus on the database layer and core application services).

## Further Notes

- The test server environment variable provides the host, port, and credentials; when no database name is included in the URL path, the administrative client connects to the standard maintenance database (`postgres`).
- Native PostgreSQL template cloning executes in ~500ms, making suite-level isolation extremely fast without transactional limitations.
