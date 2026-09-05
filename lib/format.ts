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
