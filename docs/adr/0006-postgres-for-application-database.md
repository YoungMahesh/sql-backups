# 0006. PostgreSQL for Application Database

## Status
accepted

## Context and Decision
DB Manage requires an internal relational database to persist user authentication (via Better-Auth), encrypted saved connections, scheduled backup configurations, and backup run logs. Previously, MySQL was utilized as both the target database engine being inspected and the application's internal metadata store.

To improve operational flexibility, support cloud-native serverless PostgreSQL (e.g. Neon), and provide robust UTC timezone handling (`timestamptz`), we decided to switch the application database from MySQL to PostgreSQL.

We use Drizzle ORM (`drizzle-orm/pg-core` with `postgres.js`) as the schema definition and query layer, and configure Better-Auth's Drizzle adapter with `provider: "pg"`.

The product's core target management capabilities—inspecting, querying, and dumping remote MySQL target servers to S3 storage via [lib/mysql-backup.ts](file:///root/db-manage/lib/mysql-backup.ts)—remain intact and continue to utilize `mysql2`.

## Considered Options
1. **Continue using MySQL for the application database**: Kept single database technology across internal and external components, but missed out on managed PostgreSQL features (branching, SSL-native pooling) and required separate MySQL server hosting.
2. **PostgreSQL with `pg` (node-postgres)**: Reliable standard, but heavier footprint and requires separate `@types/pg` packages.
3. **PostgreSQL with `postgres` (Postgres.js) (Chosen)**: Lightweight, high-performance pure-TypeScript/JavaScript PostgreSQL client with native SSL support for Neon, clean connection lifecycle, and first-class Drizzle ORM support.

## Consequences
- Schema definitions in [db/schema/](file:///root/db-manage/db/schema) are updated to `pgTable` with PostgreSQL-native types and `timestamptz` timestamp handling.
- Better-Auth adapter is set to `provider: "pg"`.
- Migration files in [drizzle/](file:///root/db-manage/drizzle) now generate PostgreSQL DDL; historic MySQL migrations are preserved in `drizzle_mysql_archive/`.
- `mysql2` is retained in dependencies exclusively for remote target database connections and backups.
