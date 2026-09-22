# SQL Backups

A web application to connect to, inspect, and manage SQL database instances and automated backups.

## Language

**Application Database**:
The internal PostgreSQL database powering SQL Backups, persisting user accounts, authentication sessions, encrypted saved connections, backup schedules, and run history.
_Avoid_: Metadata DB, Internal DB, Config DB

**Database Engine**:
The database management system type of a Target Database (`mysql`, `postgres`, or `sqlite` [libSQL / Turso]), determining the dialect, connection protocol, and backup extraction strategy.
_Avoid_: Database Type, DBMS, Flavor

**Target Database**:
An external database instance (MySQL, PostgreSQL, or remote libSQL/Turso SQLite) connected to, inspected, and backed up via SQL Backups.
_Avoid_: Remote DB, External DB, Monitored DB

**User Database**:
A database created for application data on a Target Database server, excluding internal server schemas and administrative templates.
_Avoid_: Custom DB, App DB, Schema

**System Database**:
Built-in administrative and metadata schemas (MySQL: `information_schema`, `mysql`, `performance_schema`, `sys`; PostgreSQL: `postgres`, `template0`, `template1`, `pg_catalog`, `information_schema`) that are excluded from user database listing.
_Avoid_: Admin DB, Internal DB, Root DB

**Saved Connection**:
A stored database connection profile and encrypted connection string associated with an authenticated user account, representing a previously verified server target. Stored encrypted at rest and presented with masked credentials in the dashboard.
_Avoid_: Connection History, Saved DB, Server Profile

**Database Backup**:
An exported snapshot of a User Database's schema and records, serialized as a compressed SQL dump, stored in S3-compatible object storage, and registered with metadata in the application database.
_Avoid_: Dump, Snapshot, DB Export, Archive

**Scheduled Backup**:
A user-managed cron recurrence that triggers a Database Backup of one User Database on one Saved Connection at specified times in a chosen IANA timezone.
_Avoid_: Recurring Backup, Backup Rule, Backup Policy

**Backup Run**:
One attempted execution of a Scheduled Backup, recorded with its outcome (`success`, `failed`, `skipped`, or `running`).
_Avoid_: Backup Attempt, Job Execution, Backup History Entry

**Backup Manifest**:
A small JSON document captured at backup time alongside a Database Backup, listing the dump's base tables with their row counts and the total uncompressed dump size. Stored as a sibling object in object storage under the same key prefix as the `.sql.gz`, and consumed by the inspector to list tables and gate the raw-view size guardrail without re-parsing the dump.
_Avoid_: Backup Index, Backup Summary, Dump Catalog, Sidecar JSON

**Public Surface**:
The public-facing landing page at `/` introducing supported Database Engines, streaming backups, companion Backup Manifests, and automated scheduling before authentication.
_Avoid_: Marketing Page, Home, Front Page, Splash Screen

**Application Workspace**:
The authenticated control plane at `/dashboard` where users manage Saved Connections, trigger manual and scheduled Database Backups, and inspect schemas.
_Avoid_: Dashboard Screen, User Portal, Console, Admin Panel

