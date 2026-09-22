# 03: Polymorphic Backup Runner, Scheduling & Automated Retention

**What to build:**
Provide automated recurring backup schedules, execution tracking, and retention lifecycle management for PostgreSQL Target Databases. A unified backup runner seam allows callers to trigger backups polymorphically across MySQL and PostgreSQL targets. In the dashboard, users can configure cron schedules and timezones for PostgreSQL databases. The background scheduler detects and executes due PostgreSQL schedules, logs execution outcomes in Backup Run history (`success`, `failed`, `skipped`), and prunes older backups from S3 and the Application Database according to the configured retention count.

**Blocked by:** 02: In-Process PostgreSQL Streaming Backups to S3 & Content Inspector

**Status:** ready-for-agent

- [ ] A polymorphic backup runner seam provides a unified entry point that delegates to the appropriate exporter based on the target engine (`'mysql' | 'postgres'`).
- [ ] Users can create, list, edit, enable/disable, and delete Scheduled Backups for PostgreSQL databases with custom cron expressions and IANA timezones.
- [ ] The background scheduler process detects due PostgreSQL schedules and executes backups through the polymorphic runner.
- [ ] Each scheduled execution generates a Backup Run record capturing execution timing, status (`running`, `success`, `failed`), and error details if the run fails.
- [ ] The scheduler enforces the schedule's retention count for PostgreSQL backups, safely deleting older S3 dump objects, manifest sidecars, and Application Database records.
- [ ] Integration tests verify schedule creation, runner dispatching, run logging, and retention pruning.
