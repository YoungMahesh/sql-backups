/**
 * Formats a byte size into a human-readable string (e.g. 512 B, 1.5 KB, 12.0 MB, 1.2 GB).
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0 || isNaN(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unitIndex = Math.min(i, units.length - 1);

  if (unitIndex === 0) {
    return `${bytes} B`;
  }

  const value = bytes / Math.pow(1024, unitIndex);
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Formats a timestamp as a relative human-readable time (e.g. "Just now", "5m ago", "Yesterday").
 */
export function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

/**
 * Formats a row count for display in a backup inspector table list.
 *
 * Zero renders as "empty" because the inspector treats an empty table as a
 * distinct state worth surfacing differently from "many rows".
 */
export function formatRowCount(rowCount: number): string {
  if (!Number.isFinite(rowCount) || rowCount <= 0) return "empty";
  if (rowCount === 1) return "1 row";
  return `${rowCount.toLocaleString("en-US")} rows`;
}
