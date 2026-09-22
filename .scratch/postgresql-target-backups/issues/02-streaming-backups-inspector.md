# 02: In-Process PostgreSQL Streaming Backups to S3 & Content Inspector

**What to build:**
Enable on-demand database backups and content inspection for PostgreSQL Target Databases. Users can click "Backup Now" on any discovered PostgreSQL database to stream a compressed SQL dump directly to S3 storage alongside a companion Backup Manifest JSON. The streaming dump captures accurate table DDL and table rows serialized as batched SQL statements with backpressure handling and no dependency on the host `pg_dump` CLI. From the dashboard backup list, users can download the backup or open the side drawer inspector to examine the manifest table list, review table `CREATE TABLE` definitions, preview up to 100 sample rows, and inspect client-side decompressed raw SQL.

**Blocked by:** 01: Schema Foundation, PostgreSQL Connection Management & Database Explorer

**Status:** ready-for-agent

- [ ] Users can trigger an on-demand Database Backup of any PostgreSQL User Database from the dashboard.
- [ ] An in-process streaming backup exporter connects via the project's PostgreSQL driver, reconstructs table DDL using catalog functions, and serializes table data into batched `INSERT` statements with proper literal escaping.
- [ ] The backup stream pipes through gzip directly into S3-compatible storage with backpressure handling, tracking uncompressed bytes and table row counts during streaming.
- [ ] A sibling Backup Manifest (`.manifest.json`) is uploaded alongside the dump object in S3, capturing table names and row counts.
- [ ] All user schemas in the PostgreSQL database are captured, with tables identified using schema qualification (`schema.table`).
- [ ] The completed backup is registered in the Application Database and displayed in the dashboard backup list with a download action.
- [ ] The backup parser is updated to support PostgreSQL double-quoted identifiers and DDL syntax.
- [ ] Users can open the side drawer inspector on a PostgreSQL backup to view the table manifest, view individual table DDL, preview the first 100 rows of a table, and view raw SQL up to 50 MB.
- [ ] Unit tests verify PostgreSQL DDL generation, row serialization, stream compression, manifest calculation, and parser extraction.
