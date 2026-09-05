# 0003. S3 Database Backups

## Status
accepted

## Context and Decision
Users inspecting connected MySQL databases need the ability to take on-demand backups and access previous backups from their dashboard.

Backing up MySQL databases usually relies on external CLI binaries such as `mysqldump` or `mariadb-dump`. However, in containerized or serverless hosting environments, system binaries are frequently unavailable or introduce unneeded host dependencies. Furthermore, large raw SQL dumps can quickly exhaust server memory and local disk space if saved directly on the application host.

We decided to implement a pure Node.js MySQL dump pipeline using `mysql2` that streams database schemas (`SHOW CREATE TABLE`) and data rows (`SELECT *`), compresses the SQL statements on the fly with Gzip (`node:zlib`), and streams the resulting `.sql.gz` payload directly into S3-compatible object storage (such as SeaweedFS) via `@aws-sdk/lib-storage`. Metadata (database name, server host, port, S3 key, compressed file size, creation timestamp) is registered in the application database under `database_backup`. In the dashboard, existing backups are listed with search filtering, one-click downloads via pre-signed S3 URLs, and two-step confirmed deletion.

## Considered Options
1. **Host-level `mysqldump` subprocess**: Standard and feature-rich, but requires `mysqldump` to be installed on the host OS/container, which is not guaranteed and failed in this deployment environment.
2. **Local filesystem storage**: Simple to write locally, but application disk storage is ephemeral in containerized/serverless environments, cannot scale across instances, and risks filling up application storage.
3. **Pure Node.js streaming dump + Gzip + S3 object storage (Chosen)**: Requires zero host CLI dependencies, minimizes memory overhead via stream piping, reduces network and storage footprint by 70–90% via Gzip compression, and integrates cleanly with S3-compatible storage (SeaweedFS).

## Consequences
- A new `database_backup` table is added to store backup metadata associated with `user.id`.
- Backups are stored as `.sql.gz` objects in SeaweedFS/S3 under `backups/{userId}/{databaseName}_{timestamp}.sql.gz`.
- Pre-signed S3 URLs provide secure direct client downloads without burdening the application server.
- The S3 client defaults to path-style addressing (`forcePathStyle: true`) for compatibility with SeaweedFS and MinIO, configurable via `S3_FORCE_PATH_STYLE`.
