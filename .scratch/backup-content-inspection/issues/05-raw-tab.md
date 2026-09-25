# 05: Raw SQL tab + size guardrail + client-side gunzip

**What to build:** The drawer's Raw tab displays the full dump SQL as text with line numbers and a copy-to-clipboard button. Backups over 50 MB uncompressed show a "Download to view — file is X MB" fallback instead of attempting the raw view, with a working Download action. The 50 MB guardrail is enforced server-side. No JavaScript dependency is added; the browser does the gunzip using built-in `DecompressionStream`.

**Blocked by:** 01 (manifest must exist for the size check), 03 (drawer shell to host the tab)

**Status:** ready-for-agent

- [ ] The drawer has a "Raw" tab alongside the Tables tab.
- [ ] For backups at or under 50 MB uncompressed, the Raw tab fetches the dump via a pre-signed URL and renders the SQL as line-numbered text in a scrollable `<pre>`.
- [ ] For backups over 50 MB uncompressed, the Raw tab shows "Download to view — file is X MB" with a Download action that triggers the existing download flow.
- [ ] The Raw tab has a copy-to-clipboard button that copies the rendered text using `navigator.clipboard.writeText`.
- [ ] The 50 MB guardrail is enforced server-side at the raw URL endpoint: it does not return a signed URL when `uncompressedSizeBytes` exceeds the limit, regardless of any client-side manipulation.
- [ ] The pre-signed URL for the raw view is signed without `ResponseContentDisposition: attachment` so the browser can fetch the bytes programmatically rather than triggering a file download.
- [ ] The raw URL endpoint reuses the established 900-second pre-signed URL expiry convention.
- [ ] No new JavaScript dependency is added for the gunzip step (uses `DecompressionStream("gzip")` and `TextDecoderStream`).
- [ ] A loading state is shown while the dump is in flight; an error state with retry is shown on fetch or decompression failure.