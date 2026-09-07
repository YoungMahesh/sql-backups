# 04: Per-table schema + rows endpoints + drawer panels

**What to build:** Expanding a table row in the inspector's Tables tab reveals its `CREATE TABLE` statement. Clicking a "Show data" action inside the expanded panel reveals the first 100 rows of that table. Tables with zero rows display an empty indicator and an empty message in the data view. Both endpoints are scoped to the calling user; another user's backup id returns 404.

**Blocked by:** 02 (parser), 03 (drawer shell + endpoint patterns)

**Status:** done

- [x] Clicking a table row in the drawer's Tables tab expands inline to show its `CREATE TABLE` statement (monospace, scrollable, preserving the exact SQL).
- [x] Within the expanded panel, a "Show data" action loads and displays the first 100 rows in a simple key/value table.
- [x] Tables with zero rows display an "empty" badge in the table list and an "empty" message in the expanded data view.
- [x] The schema endpoint streams the `.sql.gz` from S3, runs the parser, and returns the matching `CREATE TABLE` statement (200) or 404 if the table is not in the dump.
- [x] The rows endpoint streams the `.sql.gz` from S3, runs the parser, and returns up to 100 rows (200) or 404 if the table is not in the dump.
- [x] The rows endpoint enforces the 100-row cap server-side; the client cannot request more rows.
- [x] Both endpoints are scoped to the calling user via the established ownership pattern; another user's backup id returns 404, never a cross-user leak.
- [x] Value rendering correctly displays backticked identifiers, NULLs, Booleans, datetimes, hex-encoded Buffers, JSON-encoded objects, and strings containing every escape sequence.
- [x] Loading and error states on both the schema and data panels match the manifest panel's loading/error UX.