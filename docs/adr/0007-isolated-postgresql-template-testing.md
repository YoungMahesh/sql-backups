# 0007. Isolated PostgreSQL Template Testing Architecture

## Status
accepted

## Context and Decision
DB Manage requires an isolated integration testing harness for its internal PostgreSQL application database. Previously:
1. Running integration tests directly against the development database specified in `DATABASE_URL` risked mutating or wiping developer accounts, saved connections, and backup configurations.
2. Applying Drizzle schema migrations sequentially in every test suite introduced severe latency into developer feedback loops.
3. In-memory business logic (SQL dump parsing, cron calculations, AES encryption, size formatting) was co-located with tests without clear separation preventing accidental network or database dependencies in offline workflows.

To resolve these challenges, we implemented an isolated, multi-tiered test database architecture leveraging PostgreSQL native template cloning and Vitest process-level fork isolation powered by a dedicated test server specified by `TEST_DATABASE_SERVER`.

### Architectural Highlights
- **Test Tier Partitioning**: Tests are strictly separated into an offline in-memory unit tier (`tests/unit/`) and a database integration tier (`tests/integration/`) configured as distinct Vitest projects. Unit tests execute offline with zero network or database dependencies and without requiring `dotenvx`.
- **Global Setup & One-Time Migration**: During Vitest `globalSetup`, the runner validates `TEST_DATABASE_SERVER` reachability, executes an orphan database sweeper, creates a timestamped template database (`db_test_template_<timestamp>_<rand>`), applies Drizzle schema migrations once programmatically, and disables incoming connections (`ALLOW_CONNECTIONS = false`) to lock the template for fast cloning.
- **Sub-Second Suite Cloning**: Integration suites run in isolated child process forks (`pool: "forks"`). Each suite dynamically clones an isolated database from the pre-migrated template in ~150ms using PostgreSQL's native `CREATE DATABASE ... TEMPLATE` mechanism and injects the suite's dedicated connection URL into `process.env.DATABASE_URL` before test modules evaluate.
- **Deterministic Pool Draining**: At the end of each test suite, the worker gracefully drains active connection pool sockets via `closeDb()` before the administrative connection terminates backends and drops the cloned database.
- **Automated Orphan Sweeper**: A pre-flight sweeper automatically purges any test database matching `db_test_%` that is older than 2 hours or malformed, preventing disk space accumulation on aborted test runs.
- **Fail-Fast Enforcement**: If `TEST_DATABASE_SERVER` is missing or unreachable, execution halts immediately with actionable diagnostics.

## Considered Options
1. **Local Docker Containers / Testcontainers**:
   - *Pros*: Completely self-contained per machine.
   - *Cons*: High CPU and RAM overhead, slow container boot latency (5–15 seconds per run), and requires Docker daemon installation and privileges on developer machines and CI agents.
2. **In-Memory SQLite or PGLite Emulation**:
   - *Pros*: Extremely fast and portable.
   - *Cons*: Divergent dialect features, different constraint enforcement, lacks PostgreSQL-specific timezone handling (`timestamptz`), and risks masking production database incompatibilities.
3. **Transactional Rollback (`BEGIN ... ROLLBACK` per test)**:
   - *Pros*: Fast setup within a single database.
   - *Cons*: Cannot test application logic that manages its own transactions, hides multi-connection concurrency issues, cannot test DDL migrations, and leaves state polluted if rollback fails.
4. **Remote Dedicated Test Server with Native PostgreSQL Template Cloning (Chosen)**:
   - *Pros*: Exact production parity with PostgreSQL, sub-second suite provisioning (~150ms), complete database-level process isolation, zero Docker overhead, and robust cleanup.
   - *Cons*: Requires network reachability to `TEST_DATABASE_SERVER` when running integration tests.

## Benchmarks & Performance
- **Template Provisioning & Schema Migration**: ~2–3 seconds executed once per test run in `globalSetup`.
- **Suite Database Cloning**: ~150ms per integration test suite using native `CREATE DATABASE ... TEMPLATE`.
- **Unit Test Suite**: 94 unit tests execute offline in < 1 second with zero network or database dependencies.

## Consequences
- `vitest.config.ts` manages workspace projects `unit` and `integration`.
- `package.json` exposes dedicated npm scripts: `test` (unified), `test:unit` (offline), `test:integration` (remote database), and `test:watch` (watch mode preserving template database).
- `db/index.ts` exports `conn`, `client`, and the `closeDb()` connection draining helper.
- `tests/integration/db-admin.ts`, `tests/integration/global-setup.ts`, and `tests/integration/setup.ts` manage administrative lifecycle and per-suite isolation.
- Integration test suites cover database lifecycle, saved connections, backup schedules/runs, and database backups.
