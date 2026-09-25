# 04: Per-table schema + rows endpoints + drawer panels

**What to build:** Expanding a table row in the inspector's Tables tab reveals its `CREATE TABLE` statement. Clicking a "Show data" action inside the expanded panel reveals the first 100 rows of that table. Tables with zero rows display an empty indicator and an empty message in the data view. Both endpoints are scoped to the calling user; another user's backup id returns 404.

**Blocked by:** 02 (parser), 03 (drawer shell + endpoint patterns)

**Status:** ready-for-agent

- [ ] Clicking a table row in the drawer's Tables tab expands inline to show its `CREATE TABLE` statement (monospace, scrollable, preserving the exact SQL).
- [ ] Within the expanded panel, a "Show data" action loads and displays the first 100 rows in a simple key/value table.
- [ ] Tables with zero rows display an "empty" badge in the table list and an "empty" message in the expanded data view.
- [ ] The schema endpoint streams the `.sql.gz` from S3, runs the parser, and returns the matching `CREATE TABLE` statement (200) or 404 if the table is not in the dump.
- [ ] The rows endpoint streams the `.sql.gz` from S3, runs the parser, and returns up to 100 rows (200) or 404 if the table is not in the dump.
- [ ] The rows endpoint enforces the 100-row cap server-side; the client cannot request more rows.
- [ ] Both endpoints are scoped to the calling user via the established ownership pattern; another user's backup id returns 404, never a cross-user leak.
- [ ] Value rendering correctly displays backticked identifiers, NULLs, Booleans, datetimes, hex-encoded Buffers, JSON-encoded objects, and strings containing every escape sequence.
- [ ] Loading and error states on both the schema and data panels match the manifest panel's loading/error UX.