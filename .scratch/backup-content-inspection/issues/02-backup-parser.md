# 02: Backup parser module

**What to build:** A pure-library module that can read a `.sql.gz` stream produced by our dump pipeline and extract either a table's `CREATE TABLE` statement or its first N rows. Handles every value type and escape sequence the writer emits. View and trigger sections are skipped. Multiple tables in the dump are partitioned correctly.

**Blocked by:** None (tests reuse writer-produced fixtures already present in the existing writer test file)

**Status:** ready-for-agent

- [ ] `extractTableSchema(stream, tableName)` returns the matching `CREATE TABLE` SQL as a string, or null if no matching table is found.
- [ ] `extractTableRows(stream, tableName, limit)` returns up to `limit` row objects as plain JS values, or null if the table is not found.
- [ ] Row parsing correctly handles: `NULL`, boolean (`'0'`/`'1'`), finite numbers, datetimes, Buffers encoded as `X'...'`, JSON-encoded objects, and strings containing every escape sequence the writer emits (`\\`, `\'`, `\0`, `\n`, `\r`, `\Z`).
- [ ] Backticked identifiers with embedded backticks are handled correctly when matching table names.
- [ ] When the dump contains multiple tables, asking for rows from table A never returns rows from table B.
- [ ] View sections (`DROP VIEW`, `CREATE VIEW`) and trigger sections (`DELIMITER ;;;`, `SHOW CREATE TRIGGER`) are skipped without raising errors.
- [ ] Empty tables return an empty array (not null, not an exception).
- [ ] Parser operates on a Node.js Readable stream of the gzipped dump and handles backpressure without buffering the full dump in memory.
- [ ] Unit tests cover every behaviour above, using fixtures produced by the actual writer so the parser cannot drift from the writer's output format.