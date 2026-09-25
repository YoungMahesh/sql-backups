# Scheduled Database Backups

## Goals
Add explicit, user-managed cron schedules for backing up `User Database`s on a `Saved Connection`, with per-user timezone evaluation, run history, skip-if-running semantics, and per-run retention.

## Non-goals (v1)
- Email/notification on failure (v2)
- Per-schedule onFailure webhook (v2)
- Multi-process scheduler coordination (single-process assumption for v1)
- Catch-up runs after server downtime (standard cron semantics)
- Pause/resume — single `enabled` boolean suffices

## Locked design decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Deployment target | Self-hosted Node / Docker (in-process scheduler) |
| 2 | Schedule granularity | Per `{Saved Connection, User Database}` pair |
| 3 | Enablement model | Explicit user-created schedule (no auto-default) |
| 4 | Retention | N per pair, user-configurable per schedule |
| 5 | Cron UI | Picker with "Advanced" disclosure for raw expression |
| 6 | Timezone source | Per-user, stored via better-auth `user.additionalFields` |
| 7 | Run history | New `backup_run` row for every scheduled attempt |
| 8 | Overlap behavior | Skip-if-running → new row with `status='skipped'` |
| 9 | UI placement | Global `Schedules` tab + inline per-connection editor |
| 10 | Scheduler library | `croner` (TS-native, timezone-aware) |
| 11 | ADR | Yes — `docs/adr/0004-scheduled-database-backups.md` |

## Domain glossary additions (for `CONTEXT.md`)

- **Scheduled Backup** — a user-managed cron recurrence that triggers a `Database Backup` of one `User Database` on one `Saved Connection` at specified times in the user's timezone.
- **Backup Run** — one attempted execution of a Scheduled Backup, recorded with its outcome (`success`/`failed`/`skipped`/`running`).

## Database schema changes

### Extend `user` table
Add nullable `timezone` column (varchar 64). Also configure better-auth `user.additionalFields`.

### New `backup_schedule` table
Columns: `id`, `user_id` (FK user, cascade), `saved_connection_id` (FK saved_connection, cascade), `database_name`, `cron_expression`, `retention_count`, `enabled`, `last_run_at` (nullable), `next_run_at` (nullable), `created_at`, `updated_at`.
Indexes: `user_id`, `(enabled, next_run_at)`, UNIQUE `(saved_connection_id, database_name)`.

### New `backup_run` table
Columns: `id`, `schedule_id` (FK, cascade), `started_at`, `finished_at` (nullable), `status` (`running`/`success`/`failed`/`skipped`), `error_message` (text, nullable), `skip_reason` (varchar 64, nullable), `backup_id` (FK database_backup, set null).
Indexes: `(schedule_id, started_at)`, `status`.

## Files to create
- `instrumentation.ts`
- `lib/cron.ts` + `lib/cron.test.ts`
- `lib/scheduler.ts`
- `lib/schedule-validation.ts` + `lib/schedule-validation.test.ts`
- `db/schema/backup-schedule.ts`
- `db/schema/backup-run.ts`
- `app/api/mysql/schedules/route.ts`
- `app/api/mysql/schedules/[id]/route.ts`
- `app/api/mysql/schedules/[id]/runs/route.ts`
- `components/schedule-manager.tsx`
- `components/schedule-form.tsx`
- `components/schedule-row.tsx`
- `components/run-history.tsx`
- `components/connection-schedules.tsx`
- `docs/adr/0004-scheduled-database-backups.md`

## Files to modify
- `lib/auth.ts` — add `user.additionalFields`
- `db/schema/auth.ts` — add `timezone` column to `user`
- `db/schema/index.ts` — re-export new tables
- `app/page.tsx` — add `schedules` tab + panel
- `components/database-explorer.tsx` — add Schedule button per DB
- `CONTEXT.md` — glossary additions
- `package.json` — add `croner` dependency

## Implementation phases

**Phase 1 — Foundation**: install `croner`, write schema files, modify auth schema + config, generate migration (`pnpm run db-generate`, never `db-migrate`).

**Phase 2 — Domain layer (TDD)**:
- `lib/cron.ts` — `isValidCronExpression`, `nextRunAt(expr, tz, after?)`, `isValidTimeZone`. Tests cover valid/invalid expressions, next-run across IANA zones, DST handling, timezone validation.
- `lib/schedule-validation.ts` — pure validator that returns discriminated `{ ok: true } | { ok: false, errors: string[] }`. Tests cover all rejection paths.

**Phase 3 — API endpoints**:
- `GET /api/mysql/schedules` — list with joined connection info
- `POST /api/mysql/schedules` — validate, check DB exists on target via SHOW DATABASES LIKE '?', insert, compute next_run_at
- `GET /api/mysql/schedules/[id]` — single schedule + recent runs
- `PATCH /api/mysql/schedules/[id]` — partial update, recompute next_run_at
- `DELETE /api/mysql/schedules/[id]` — cascade
- `GET /api/mysql/schedules/[id]/runs` — paginated runs
- All use `runtime = "nodejs"`, session-gated, scoped by userId.

**Phase 4 — In-process scheduler**:
- `lib/scheduler.ts` — `startScheduler()` with `globalThis.__scheduler_started` guard, 60s `setInterval`, fire-and-forget dispatch.
- `instrumentation.ts` — calls `startScheduler()` only when `NEXT_RUNTIME === 'nodejs'`.
- Tick logic: find enabled schedules where `nextRunAt <= now()`. For each:
  - **Skip-if-running**: any existing `backup_run` for this schedule with `status='running'` and `startedAt > now() - 2h`? Insert skipped row, continue.
  - Otherwise: insert running row, fire-and-forget the backup via existing `backupDatabaseToS3`, on completion update run to success (set `backup_id`) or failed (set `error_message`).
  - Update `last_run_at`, recompute `next_run_at`.
  - On success: per-run retention cleanup — count `database_backup` rows for `(userId, databaseName, host, port)`, if over `retention_count`, delete oldest (DB row + S3 object).
- Orphan recovery: at the **start** of each tick, flip `backup_run` rows stuck in `running` for >2h to `failed` with `error_message='orphaned_after_restart'`. Doing this at the start prevents subsequent skip-if-running checks from seeing stale `running` rows.

**Phase 5 — Global Schedules UI**:
- Add `schedules` tab to `app/page.tsx` mirroring `backups` pattern.
- `ScheduleManager` card with refresh, search, list, count badge.
- `ScheduleForm` modal with: connection selector, database selector, cron picker (preset + Advanced disclosure), timezone (default = browser-detected, saved to user.timezone), retention count, enabled.
- `ScheduleRow` item: target (host:port, db name), cron in plain English + raw, next/last run, retention, enabled toggle, edit/delete buttons.
- `RunHistory` inline expandable showing last N runs per schedule.

**Phase 6 — Inline UI**:
- Add Schedule button per DB row in `DatabaseExplorer` connected view.
- Below each saved connection (in the disconnected view list), render `ConnectionSchedules` showing that connection's existing schedules.

**Phase 7 — Verification**: run `pnpm run lint && pnpm run typecheck` after each phase. Run full test suite (`pnpm test`) once at end.

**Phase 8 — Docs**: write ADR-0004, update `CONTEXT.md` glossary.

## Validation rules (enforced in API POST/PATCH)

1. `cronExpression` must parse via croner.
2. `timezone` must be a valid IANA name (validated via `Intl.DateTimeFormat`).
3. `savedConnectionId` must belong to the user.
4. The named `User Database` must exist on the target server (SHOW DATABASES LIKE '?' check at create time).
5. `retentionCount` must be a positive integer.
6. `databaseName` length ≤ 255, non-empty.
7. No duplicate `(savedConnectionId, databaseName)` (UNIQUE index → 409).

## Skip-if-running logic

```
SELECT 1 FROM backup_run WHERE schedule_id = ? AND status = 'running' AND started_at > NOW() - 2h
→ if exists: INSERT backup_run status='skipped' skip_reason='previous_still_running'
→ else: INSERT backup_run status='running', fire backup, update on completion
```

## Orphaned-run recovery

At end of each tick:
```
UPDATE backup_run
SET status = 'failed', finished_at = NOW(), error_message = 'orphaned_after_restart'
WHERE status = 'running' AND started_at < NOW() - 2h
```

## Timezone UI

Browser-side default via `Intl.DateTimeFormat().resolvedOptions().timeZone`. On schedule create, if `user.timezone` is null, persist the detected value to it. Future schedule creates reuse it.

## Manual QA checklist (post-implementation)
1. Create schedule, observe `backup_run` rows on schedule.
2. Force long backup, confirm next tick → `skipped`.
3. Restart server mid-run, confirm orphan recovery.
4. Set retention=3, accumulate 5 backups, confirm 3 remain.
5. Delete saved_connection with active schedules → cascade.
6. Disable schedule → no runs after change.
7. Cross-timezone: set `Asia/Kolkata`, cron `0 2 * * *` → 02:00 IST.
8. Duplicate (conn, db) → 409.
9. Invalid cron → 400 with message.
10. Invalid timezone → 400 with message.

## Open risks / deferred
1. **Multi-process deployment**: v1 assumes single worker. If deployment forks workers, swap in DB advisory lock — out of scope unless told otherwise.
2. **Schedule edit during in-flight run**: changing cron doesn't cancel the running backup, just changes next-run computation.
3. **Retention across deletion**: deleting a schedule doesn't auto-cleanup its `database_backup` rows; user must delete manually.
