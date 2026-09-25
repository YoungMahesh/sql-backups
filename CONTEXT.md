# DB Manage

A web application to connect to, inspect, and manage MySQL database instances.

## Language

**User Database**:
A custom database created for application data on a MySQL server, excluding internal server schemas.
_Avoid_: Custom DB, App DB, Schema

**System Database**:
Built-in MySQL administrative and metadata schemas (`information_schema`, `mysql`, `performance_schema`, `sys`) that are excluded from user database listing.
_Avoid_: Admin DB, Internal DB, Root DB

**Saved Connection**:
A stored MySQL connection string associated with an authenticated user account, representing a previously verified server target. Stored encrypted at rest and presented with masked credentials in the dashboard.
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

