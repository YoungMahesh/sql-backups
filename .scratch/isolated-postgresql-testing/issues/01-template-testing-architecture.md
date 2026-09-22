# 01: Isolated PostgreSQL Template Testing Architecture

**What to build:** Implement an isolated, multi-tiered test database architecture leveraging PostgreSQL native template cloning and Vitest process-level fork isolation powered by `TEST_DATABASE_SERVER`. Partition tests into `tests/unit/` and `tests/integration/` via Vitest workspace projects. Implement global setup for template provisioning with programmatic Drizzle migrations, connection locking (`ALLOW_CONNECTIONS = false`), pre-flight orphan sweeper with 2-hour TTL, and automated suite cloning in `tests/integration/setup.ts`. Export connection draining helper from `db/index.ts` and write four integration suites covering database lifecycle, saved connections, backup schedules/runs, and database backups. Document the decision in ADR 0007.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Vitest is installed and configured via `vitest.config.ts` with dedicated `unit` and `integration` projects.
- [x] Existing in-memory unit tests in `lib/*.test.ts` are relocated to `tests/unit/` with updated imports and continue to pass.
- [x] Running `pnpm test:unit` executes offline without network or database dependencies and without requiring `dotenvx`.
- [x] `db/index.ts` exports the active client connection and a `closeDb()` helper to gracefully drain pool connections before databases are dropped.
- [x] Administrative helper `tests/integration/db-admin.ts` provides connectivity to the test server maintenance database, template creation with programmatic Drizzle migration, connection lock (`ALLOW_CONNECTIONS = false`), suite cloning, backend termination with drop, and an orphan sweeper for databases matching `db_test_%` older than 2 hours or malformed.
- [x] Vitest `globalSetup` in `tests/integration/global-setup.ts` fails fast if `TEST_DATABASE_SERVER` is missing/unreachable, sweeps orphaned test databases, creates the session template database once, applies migrations, locks connections, and tears down the template on global teardown.
- [x] Vitest suite setup in `tests/integration/setup.ts` dynamically clones an isolated database per suite using top-level await before test modules evaluate, sets `process.env.DATABASE_URL`, drains the pool on `afterAll`, and drops the cloned database.
- [x] Integration test suite `tests/integration/db-lifecycle.test.ts` passes, verifying template cloning, process isolation, pool draining, and orphan sweeper behavior.
- [x] Integration test suite `tests/integration/saved-connections.test.ts` passes, verifying Saved Connections CRUD, user scoping, and AES-256 encryption at rest in PostgreSQL.
- [x] Integration test suite `tests/integration/backup-schedules.test.ts` passes, verifying Scheduled Backups and Backup Runs creation, querying, status transitions, and cascading deletes.
- [x] Integration test suite `tests/integration/database-backups.test.ts` passes, verifying Database Backup metadata persistence and manifest inspection records.
- [x] `package.json` test scripts (`test`, `test:unit`, `test:integration`, `test:watch`) are updated and functional.
- [x] `docs/adr/0007-isolated-postgresql-template-testing.md` exists, is marked `Status: accepted`, records the template cloning decision, sub-second performance metrics, considered alternatives, and consequences.
- [x] `pnpm run lint` and `pnpm run typecheck` pass with zero errors.
