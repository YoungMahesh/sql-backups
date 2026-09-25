# Database Backup Content Inspection

Status: ready-for-agent

## Problem Statement

Users of the dashboard can take and download Database Backups, but they have no way to verify a backup captured what they expected without downloading the entire `.sql.gz`, decompressing it locally, and opening it in a MySQL client. After a scheduled run completes, the only feedback the user gets is the run's `status` and the backup's compressed size — neither of which tells them whether the right tables and rows were captured. For users who take backups primarily for safety, the inability to peek inside a backup makes the feature feel untrustworthy: they can't tell a 4 KB empty backup from a 400 MB real one until they download and open it.

## Solution

Add content inspection: a side-drawer inspector that opens from any Database Backup row in the dashboard and lets the user browse the dump's tables, row counts, schemas, and a row preview, plus the raw SQL text for power users. The dump is summarised at backup time into a tiny sibling JSON (the Backup Manifest) stored next to the `.sql.gz` in S3, so listing tables and enforcing the raw-view size guardrail does not require re-parsing the full dump. Row previews and `CREATE TABLE` extraction come from an on-demand server-side parse of the gzipped dump. The raw SQL view streams the `.sql.gz` straight to the browser via a pre-signed S3 URL and decompresses it client-side using `DecompressionStream`, so the application server never buffers multi-megabyte dumps in memory.

Backups created before this feature shipped have no manifest; the Inspect button is disabled for those, with a tooltip explaining why. No backfill is performed.

## User Stories

1. As a database administrator, I want to open a backup's contents from the backup list, so that I can verify the backup is real without downloading it.
2. As a database administrator, I want to see the list of User Database tables that exist in the backup, so that I can confirm the schema matches my expectations.
3. As a database administrator, I want to see a row count next to each table, so that I can spot truncated or empty backups at a glance.
4. As a database administrator, I want to view the `CREATE TABLE` statement for any table in the backup, so that I can review the exact schema (column types, indexes, defaults) without leaving the dashboard.
5. As a database administrator, I want to preview the first 100 data rows of any table in the backup, so that I can sanity-check that the captured data looks right.
6. As a database administrator, I want to see an empty-state message when a backup contains no tables, so that I understand why the list is empty.
7. As a database administrator, I want to see an "empty" indicator for tables that have zero rows, so that I don't waste time clicking into them.
8. As a database administrator, I want to view the raw SQL text of the backup, so that I can debug dump-format issues or share snippets with someone else.
9. As a database administrator, I want line numbers in the raw SQL viewer, so that I can report "the error is at line N" precisely.
10. As a database administrator, I want to copy the raw SQL to my clipboard with one click, so that I can paste it elsewhere without manual selection.
11. As a database administrator, I want the inspector to refuse to view backups larger than 50 MB uncompressed in the browser, so that the browser tab doesn't lock up my machine.
12. As a database administrator, I want the inspector to show the file size when it refuses the raw view, so that I can decide whether to download instead.
13. As a database administrator, I want the Inspect button to live alongside Download and Delete as a distinct affordance, so that I don't accidentally open the inspector when I meant to download.
14. As a database administrator, I want the inspector to open in a side drawer on desktop, so that I can keep my backup list visible for context.
15. As a database administrator, I want the inspector to take over the full screen on mobile, so that the contents are readable on a narrow viewport.
16. As a database administrator, I want to close the inspector by pressing Escape, so that I can dismiss it without reaching for the close button.
17. As a database administrator, I want to close the inspector by clicking outside it, so that dismissal feels natural.
18. As a database administrator, I want the dashboard to clearly indicate which backups cannot be inspected (those created before the feature shipped), so that I understand why the button is disabled.
19. As a user with Scheduled Backups, I want the inspector to work on backups produced by my schedules, so that I can verify scheduled runs succeeded.
20. As a database administrator, I want the inspector to load quickly, so that the manifest is fetched in the background without freezing the UI.
21. As a database administrator, I want the row preview to be limited to 100 rows per table, so that the server isn't held up by a multi-million-row preview request.
22. As a database administrator, I want the inspector to show a retry button on failure (manifest missing, S3 error, parse error), so that transient failures don't lock me out.
23. As a database administrator, I want the inspector's tables tab to expand a table to show its schema and rows in one place, so that I don't have to context-switch between separate Schema and Data tabs.
24. As a database administrator, I want the inspector to handle non-ASCII table names and column names correctly, so that I can inspect databases with internationalised identifiers.
25. As a database administrator, I want the inspector to handle special characters in row values (quotes, backslashes, newlines, null bytes) correctly, so that previews are faithful to the underlying data.

## Implementation Decisions

### Manifest capture during the dump pipeline

The streaming dump pipeline is extended (not duplicated). The pipeline already iterates every base table and knows the row count when each batch resolves, so the manifest is a natural by-product of a single pass. An additional byte counter sits between the PassThrough and the Gzip transform so the uncompressed size is tracked accurately without buffering.

The manifest is uploaded to S3 after the main dump upload completes, as a sibling `.manifest.json` object. The upload is best-effort: a manifest upload failure logs a warning and does not fail the backup. A backup that successfully captures data but fails to capture a manifest appears in the dashboard as if it had been created before the feature shipped — the Inspect button is disabled for it.

The manifest schema is a single-versioned JSON document:

```
{
  "version": 1,
  "uncompressedSizeBytes": number,
  "tables": [{ "name": string, "rowCount": number }]
}
```

This is consumed by the inspector's API endpoint and validated with a hand-rolled schema check on read; no validation library is added.

### Why a sibling JSON in S3, not a column on `database_backup`

Rejected options:

- A JSON column on `database_backup` would force a Drizzle migration for every existing row and tie the manifest's lifecycle to the database record rather than the S3 object.
- A precomputed sample-row manifest would commit us to a sample size at backup time and would be misleading for "did the right data get captured?" — the user's stated motivation is sanity checking, which demands parsing the dump itself.
- Lazy backfill for existing backups was rejected because it imposes a heavy parse on the first inspect of any old backup and adds a backfill-state-machine in the code path; the cleaner UX is a clear "this backup predates inspection" indicator and a working Inspect button for everything created going forward.

The chosen approach keeps the manifest alongside its dump in S3 (same lifecycle, no migration), keeps row previews authoritative by parsing on demand, and degrades gracefully to a disabled button for unmanifested backups.

### Hand-rolled SQL parser

A new parser module walks the dump format produced by the writer. The format is bounded (we control the writer): header comments, per-table sections (`DROP TABLE IF EXISTS`, `CREATE TABLE`, batched `INSERT INTO ... VALUES (...);`), view sections, trigger sections using `DELIMITER ;;;`. A state machine yields discriminated statements; thin wrappers expose `extractTableSchema` and `extractTableRows` that filter and materialise.

A generic SQL parser library was rejected because it adds dependency weight, parse latency, and would still need tailored handling for our non-standard INSERT batching and our specific value-escape semantics.

Value parsing inverts the writer's value-escape function: handles `NULL`, `'0'`/`'1'` for booleans, `X'...'` for buffers, datetime strings, JSON-encoded objects, and the MySQL escape sequences (`\\`, `\'`, `\0`, `\n`, `\r`, `\Z`).

### API surface

Four new endpoints, all following the established pattern (`runtime = "nodejs"`, session check, scoped to the calling user via `user_id`):

- `GET /api/mysql/backups/[id]/manifest` — returns 200 with the manifest JSON, or 404 `manifest_unavailable`. Used to populate the Tables tab and to gate the raw view.
- `GET /api/mysql/backups/[id]/tables/[table]/schema` — streams the `.sql.gz` from S3, runs the parser, returns the matching `CREATE TABLE` statement (200) or 404.
- `GET /api/mysql/backups/[id]/tables/[table]/rows` — same streaming + parse, returns the first 100 rows (200) or 404.
- `GET /api/mysql/backups/[id]/raw-url` — reads the manifest's `uncompressedSizeBytes`; if it exceeds 50 × 1024 × 1024 bytes, returns 200 `{ allowed: false, sizeBytes }`. Otherwise returns 200 `{ allowed: true, url }` where the URL is a pre-signed S3 URL signed without `ResponseContentDisposition`.

All four endpoints share a single ownership / authorisation helper so the auth pattern is not duplicated.

### Pre-signed URL conventions

The raw view reuses the existing pre-signed URL pattern (900 s expiry, established in the download endpoint) but with a distinct signer that omits the `attachment` disposition, so the browser can fetch the bytes programmatically rather than triggering a file download.

### Drawer component

A single new component owns the drawer shell and both tabs. It is mounted by the existing backup manager and controlled via a single `inspectingBackup` state. There is no global modal manager.

Tabs are **Tables** and **Raw**. The Tables tab lists tables from the manifest, each expandable to reveal the `CREATE TABLE` statement with a sub-button to load and display the first 100 rows. The Raw tab fetches the raw URL, then either renders the gunzipped text (line-numbered `<pre>`) or shows the size-guardrail message with a Download fallback.

On `<sm` viewports the drawer becomes a full-screen modal with a back arrow. On `>=sm` it slides in from the right with a backdrop. Escape key and backdrop click both close the drawer.

### Browser-side gunzip

The Raw tab uses the built-in `DecompressionStream("gzip")` and `TextDecoderStream` to decompress the pre-signed S3 response directly in the browser. No JavaScript dependency is added. The 50 MB size guardrail is enforced server-side at the `raw-url` endpoint, not in the browser — the server simply does not return a URL when the guardrail fails.

### Domain glossary

`CONTEXT.md` gains one new term: **Backup Manifest** — a small JSON document captured at backup time alongside a Database Backup, listing the dump's tables with their row counts and the total uncompressed dump size. Stored as a sibling object in S3 under the same key prefix as the `.sql.gz`.

### ADR

`docs/adr/0005-backup-manifest-for-content-inspection.md` records the chosen hybrid (manifest in S3 + on-demand parse) and the rejected alternatives.

### Backup manager integration

The existing backup manager gains an Inspect button between Download and Delete. The button is rendered disabled with a tooltip explaining pre-feature backups when the manifest cannot be fetched. The drawer is mounted as a sibling of the existing header card. No existing Download or Delete logic is altered.

### What is intentionally unchanged

- `database_backup` table — no Drizzle migration; manifest lives in S3.
- Existing download endpoint — pre-signed URL with `attachment` disposition remains.
- Scheduled Backups pipeline — runs through the same streaming dump function and inherits the manifest capture for free.
- Backup listing endpoint — not enriched with `hasManifest`; the disabled-button UX is delivered by attempting the manifest fetch on click.

## Testing Decisions

### What makes a good test

- Tests assert the **public output** of a module (return values, written-to-stream content, error states), not its internals (private fields, state machine transitions).
- Tests use the actual writer to build fixtures, so the parser and the writer can never drift apart.
- Tests are deterministic and run with no network, no S3, no MySQL connection.

### New test seam: the parser

The parser is the highest-value new seam because it encodes the entire dump-format contract. Tests cover:

- Schema extraction: round-trip from writer fixtures; multiple tables; tables with backticked identifiers; tables with foreign keys / indexes / constraints.
- Row extraction: simple tables; tables with all supported value types (NULL, boolean, number, datetime, Buffer-as-hex, JSON-encoded object, string with all escape characters); empty tables; multiple tables with the parser correctly partitioning rows; cap-at-100 behaviour.
- Trigger / view sections: parser does not yield these as row data and does not error.
- Malformed input: unexpected exit mid-section does not crash; missing `CREATE TABLE` for a referenced row section returns null rather than throwing.

### Extended test seam: the dump writer

Existing writer tests gain assertions that the manifest is emitted alongside the dump, with:

- Correct table names and row counts for a known-fixture database.
- Correct uncompressed byte count (asserted against the size of the input fixture).
- A manifest S3 key derived from the dump S3 key.
- A failing manifest upload does not fail the backup (best-effort semantics).

### Seams that get no new tests (following repo convention)

- S3 helpers — partially covered by existing tests; new helpers (`uploadBackupManifest`, `fetchBackupManifest`, `getBackupRawUrl`) follow the same tested-helper pattern.
- API routes — no precedent in this repo.
- UI components — no precedent in this repo.

### Prior art

- Writer tests — pattern for streaming + fixture-driven tests against the writer.
- Cron / schedule-validation tests — pattern for exhaustive unit tests of pure helpers.
- Crypto / S3 tests — pattern for testing wrappers around external SDKs (mock where unavoidable, trust the SDK otherwise).

## Out of Scope

- **Backfill of manifests for existing backups**. Pre-feature backups show a disabled Inspect button with an explanatory tooltip.
- **Server-side row pagination** beyond the 100-row cap. v1 is "first 100 rows" with no offset / cursor.
- **Search inside the raw SQL viewer**. Users use browser Ctrl+F.
- **Syntax highlighting** in the raw viewer. Plain monospace text only.
- **Diff / compare between two backups**.
- **Re-running or restoring a backup from the inspector**.
- **Notifications** when a scheduled backup produces an unmanifestable dump.
- **Server-side decompression of the raw SQL**. The browser does the gunzip; the server only signs the URL and checks the guardrail.

## Further Notes

- The 50 MB raw-view guardrail is sized for "typical" sanity-check usage. It is not a security boundary — it is a server-enforced denial of service on the user's own browser. A user who genuinely needs to read 100 MB of raw SQL can download the dump and open it locally.
- The 100-row preview cap is enforced server-side in the parser; the client cannot request more. Adding offset-based pagination in a future iteration would extend `extractTableRows(stream, table, { limit, offset })` without changing the public API shape.
- The `version: 1` field on the manifest is the migration hook. If the dump format evolves (new statement types, new value escapes), the parser can branch on `version` while old manifests stay parseable.
- The first-call-from-button pattern (no `hasManifest` enrichment in the list endpoint) means an old backup costs one wasted round-trip on click before the user sees the disabled-state message. This is acceptable because the disabled state is also surfaced at render time for the case where the manifest fetch has been attempted before; a list-level pre-check can be added later without changing the public API.