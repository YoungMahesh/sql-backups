# 01: Backup manifest capture + domain docs

**What to build:** When the system creates a Database Backup, it now also writes a small JSON manifest object alongside the `.sql.gz` in S3. The manifest lists every base table with its row count and records the total uncompressed dump size. A manifest upload failure logs a warning but does not fail the backup. The project glossary gains a Backup Manifest term, and a new ADR records the design.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] After a successful dump completes, a manifest JSON object is present in S3 next to the `.sql.gz`, at a key derived from the dump key.
- [ ] The manifest JSON contains `version: 1`, the uncompressed byte count of the dump (measured before gzip), and an entry per base table with `name` and `rowCount`.
- [ ] For dumps with no base tables, the manifest's `tables` array is empty (not missing, not null).
- [ ] If the manifest upload fails, the backup still completes successfully and a warning is logged; no exception propagates to the caller.
- [ ] Existing scheduled backups continue to work and inherit the manifest capture with no behavioural change beyond the manifest side-effect.
- [ ] The existing writer test file gains assertions covering: manifest emission alongside the dump, correct table names and row counts, correct uncompressed byte count, derived manifest key, and best-effort semantics on manifest upload failure.
- [ ] `CONTEXT.md` includes a "Backup Manifest" entry with a precise definition and at least two avoided terms.
- [ ] `docs/adr/0005-backup-manifest-for-content-inspection.md` exists, is marked Status: accepted, documents the chosen hybrid (manifest in S3 + on-demand parse), and lists the rejected alternatives with reasons.