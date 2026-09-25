# 03: Drawer shell + Inspect button + table list panel

**What to build:** A new "Inspect" button on every backup row opens a side drawer. The drawer's Tables tab displays the manifest's table list with row counts, an empty state for manifest-empty backups, and an error/retry control on fetch failure. Backups without a manifest show a disabled Inspect button with a tooltip explaining why. The drawer closes via Escape, backdrop click, or X button. On viewports below the small breakpoint, the drawer takes over the full screen with a back arrow. Existing Download and Delete flows are unchanged.

**Blocked by:** 01 (manifest must exist for new backups for the demo to be meaningful)

**Status:** done

- [x] An "Inspect" button appears on every backup row, positioned between Download and Delete, matching the existing button visual style.
- [x] Clicking Inspect on a backup that has a manifest opens a side drawer (right-anchored on `>=sm`, full-screen modal on `<sm`).
- [x] The drawer's Tables tab fetches the manifest and displays every table name alongside its row count.
- [x] An empty state is shown when the manifest's `tables` array is empty.
- [x] A loading state is shown while the manifest is in flight; an error state with retry is shown on fetch failure.
- [x] Clicking Inspect on a backup that lacks a manifest does not open a drawer; the button is rendered disabled with a tooltip explaining why.
- [x] The drawer closes via Escape key, backdrop click, and a visible X button in the drawer header.
- [x] On viewports below the small breakpoint, the drawer takes over the full screen with a back arrow instead of being a right-side panel.
- [x] The existing Download and Delete flows remain byte-for-byte unchanged.
- [x] The drawer is mounted as a sibling of the existing backup-manager header card; no global modal manager is introduced.