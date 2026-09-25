# 0004. Scheduled Database Backups

## Status
accepted

## Context and Decision
Users with on-demand Database Backups (ADR-0003) need a way to run them on a schedule without remembering to click the Backup button. The application is self-hosted on a long-lived Node process, so an in-process scheduler is feasible and avoids the operational overhead of an external job runner.

We decided to add Scheduled Backups as explicit, user-managed rows scoped to a `{Saved Connection, User Database}` pair, evaluated in an IANA timezone stored on the schedule row itself. Schedules fire through an in-process scheduler started from Next.js's `instrumentation.ts` `register()` hook (guarded by `process.env.NEXT_RUNTIME === "nodejs"` and a `globalThis` singleton flag to survive HMR), running a 60-second tick that queries `backup_schedule` rows where `enabled = true AND next_run_at <= NOW()`. Each fired schedule inserts a `backup_run` row with `status = 'running'` and dispatches the same `backupDatabaseToS3` pipeline used by on-demand backups. Per-schedule skip-if-running concurrency is enforced by checking for any non-stale (`started_at > NOW() - 2h`) `running` row for the schedule; if found, a `skipped` row is recorded instead. Orphaned `running` rows from crashes are recovered at the start of each tick by flipping them to `failed` with `error_message = 'orphaned_after_restart'`. Retention is enforced per-run immediately after each successful backup: oldest `database_backup` rows for the `(user_id, database_name, host, port)` tuple beyond the schedule's `retention_count` are deleted along with their S3 objects. Cron expression evaluation uses `croner` (TypeScript-native, zero dependencies, first-class IANA timezone support), validated and used via thin wrappers in `lib/cron.ts`; input validation lives in `lib/schedule-validation.ts` and accumulates all errors before returning. Per-user timezone is set as a better-auth `user.additionalFields` value (`timezone`) and is written to the user on first schedule save; subsequent schedule saves update the user again only when the chosen timezone differs.

## Considered Options
1. **External scheduler (system cron, k8s CronJob, BullMQ on Redis)**: Operationally heavier, requires extra infrastructure (Redis, dedicated worker process) and changes deployment topology. Rejected for v1 to keep the single-process self-hosted model intact.
2. **Vercel Cron (`vercel.json` + a thin route handler)**: Requires Vercel-specific deployment topology and does not play well with the long-lived streaming + crypto + raw mysql2 work this app already does. Rejected because deployment target is self-hosted Node.
3. **In-process scheduler with single-worker assumption (Chosen)**: Matches the existing runtime; minimal new dependencies; simple to operate. The `globalThis` guard prevents HMR-induced duplicate schedulers within a single Node process. Acknowledged limitation: multi-worker deployments would run N schedulers — accepted as a v1 trade-off, with a future path of swapping the in-memory guard for a DB advisory lock if/when needed.

## Consequences
- A `croner` dependency is added (no `@types/*` package required; croner ships its own TypeScript declarations).
- A new `user.timezone` column is added via better-auth `user.additionalFields` plus a matching drizzle column.
- Two new tables: `backup_schedule` (with a UNIQUE `(saved_connection_id, database_name)` constraint to prevent duplicate schedules per pair) and `backup_run` (with a `status` index for skip-if-running lookups). Cascade delete from `user`, `saved_connection`, and `schedule` keeps these consistent.
- The 60-second tick is the practical minimum granularity (cron is minute-resolution); schedules can fire up to ~60s late.
- Standard cron semantics apply: missed windows are not caught up after server downtime.
- Multi-process deployments require revisiting scheduler coordination (advisory lock) before production rollout — currently out of scope.
