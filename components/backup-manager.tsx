"use client";

import { useState, useEffect, useCallback } from "react";
import { formatBytes } from "@/lib/format";
import {
  InspectDrawer,
  type ManifestViewState,
  type PanelState,
  type RawViewState,
} from "@/components/inspect-drawer";

export interface BackupItem {
  id: string;
  userId: string;
  databaseName: string;
  host: string;
  port: number;
  engine?: "mysql" | "postgres" | "sqlite";
  s3Key: string;
  sizeBytes: number;
  createdAt: string;
}

export function getBackupApiPrefix(engine?: string): string {
  if (engine === "sqlite") return "/api/sqlite/backups";
  return engine === "postgres" ? "/api/postgres/backups" : "/api/mysql/backups";
}

function formatRelativeTime(dateString: string): string {
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
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

interface BackupManagerProps {
  onBackupDeleted?: () => void;
  onBackupsLoaded?: (count: number) => void;
  refreshTrigger?: number;
}

export function BackupManager({
  onBackupDeleted,
  onBackupsLoaded,
  refreshTrigger,
}: BackupManagerProps) {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [inspectAvailability, setInspectAvailability] = useState<
    Record<string, "available" | "unavailable">
  >({});
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [inspectSession, setInspectSession] = useState<{
    backup: BackupItem;
    manifestState: ManifestViewState;
  } | null>(null);

  const fetchBackups = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mysql/backups");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load database backups.");
      }
      const list: BackupItem[] = data.backups || [];
      setBackups(list);
      onBackupsLoaded?.(list.length);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load database backups.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [onBackupsLoaded]);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const res = await fetch("/api/mysql/backups");
        const data = await res.json();
        if (!ignore) {
          if (!res.ok) {
            setError(data.error || "Failed to load database backups.");
          } else {
            const list: BackupItem[] = data.backups || [];
            setBackups(list);
            setError(null);
            onBackupsLoaded?.(list.length);
          }
        }
      } catch (err: unknown) {
        if (!ignore) {
          const message =
            err instanceof Error ? err.message : "Failed to load database backups.";
          setError(message);
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      ignore = true;
    };
  }, [refreshTrigger, onBackupsLoaded]);

  const handleDownload = async (backup: BackupItem) => {
    setDownloadingId(backup.id);
    setError(null);
    try {
      const prefix = getBackupApiPrefix(backup.engine);
      const res = await fetch(`${prefix}/${backup.id}/download`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate download link.");
      }

      if (data.downloadUrl) {
        // Trigger direct browser download
        const link = document.createElement("a");
        link.href = data.downloadUrl;
        link.download = data.filename || `${backup.databaseName}.sql.gz`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to download backup.";
      setError(message);
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (backup: BackupItem) => {
    setDeletingId(backup.id);
    setError(null);
    try {
      const prefix = getBackupApiPrefix(backup.engine);
      const res = await fetch(`${prefix}/${backup.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete backup.");
      }

      setBackups((prev) => prev.filter((b) => b.id !== backup.id));
      onBackupDeleted?.();
      setConfirmDeleteId(null);
      setActionSuccess("Database backup deleted successfully.");
      setTimeout(() => setActionSuccess(null), 3000);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to delete backup.";
      setError(message);
    } finally {
      setDeletingId(null);
    }
  };

  const fetchManifestFor = useCallback(
    async (backup: BackupItem): Promise<ManifestViewState> => {
      try {
        const prefix = getBackupApiPrefix(backup.engine);
        const res = await fetch(`${prefix}/${backup.id}/manifest`);
        if (res.status === 404) {
          setInspectAvailability((prev) => ({
            ...prev,
            [backup.id]: "unavailable",
          }));
          setActionSuccess("This backup predates the inspection feature.");
          setTimeout(() => setActionSuccess(null), 4000);
          return { kind: "error", message: "manifest_unavailable" };
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Could not load backup manifest.");
        }
        const data = await res.json();
        const manifest = data.manifest as
          | import("@/lib/manifest").BackupManifest
          | undefined;
        if (!manifest) {
          throw new Error("Could not load backup manifest.");
        }
        setInspectAvailability((prev) => ({
          ...prev,
          [backup.id]: "available",
        }));
        return { kind: "loaded", manifest };
      } catch (err: unknown) {
        const message =
          err instanceof Error
            ? err.message
            : "Could not load backup manifest.";
        return { kind: "error", message };
      }
    },
    []
  );

  const handleInspect = async (backup: BackupItem) => {
    const cached = inspectAvailability[backup.id];
    if (cached === "unavailable") {
      setActionSuccess("This backup predates the inspection feature.");
      setTimeout(() => setActionSuccess(null), 4000);
      return;
    }
    if (cached === "available") {
      setInspectSession({ backup, manifestState: { kind: "loading" } });
    } else {
      setInspectingId(backup.id);
    }

    const manifestState = await fetchManifestFor(backup);
    setInspectingId(null);

    if (manifestState.kind === "loaded") {
      setInspectSession({ backup, manifestState });
    }
    // For error/unavailable states, leave the drawer closed (or unchanged) so
    // a backup predating the feature never opens the inspector.
  };

  const fetchSchemaFor = useCallback(
    async (
      backupId: string,
      table: string
    ): Promise<PanelState<string>> => {
      try {
        const prefix = getBackupApiPrefix(inspectSession?.backup?.engine);
        const res = await fetch(
          `${prefix}/${backupId}/tables/${encodeURIComponent(table)}/schema`
        );
        if (res.status === 404) {
          return { kind: "error", message: "Schema not found for this table." };
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Could not load table schema.");
        }
        const data = await res.json();
        if (typeof data.schema !== "string") {
          throw new Error("Could not load table schema.");
        }
        return { kind: "loaded", data: data.schema };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Could not load table schema.";
        return { kind: "error", message };
      }
    },
    [inspectSession]
  );

  const fetchRowsFor = useCallback(
    async (
      backupId: string,
      table: string
    ): Promise<PanelState<Record<string, unknown>[]>> => {
      try {
        const prefix = getBackupApiPrefix(inspectSession?.backup?.engine);
        const res = await fetch(
          `${prefix}/${backupId}/tables/${encodeURIComponent(table)}/rows`
        );
        if (res.status === 404) {
          return { kind: "error", message: "Table not found in backup." };
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Could not load table rows.");
        }
        const data = await res.json();
        if (!Array.isArray(data.rows)) {
          throw new Error("Could not load table rows.");
        }
        return { kind: "loaded", data: data.rows as Record<string, unknown>[] };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Could not load table rows.";
        return { kind: "error", message };
      }
    },
    [inspectSession]
  );

  const fetchRawFor = useCallback(
    async (backupId: string): Promise<RawViewState> => {
      try {
        const prefix = getBackupApiPrefix(inspectSession?.backup?.engine);
        const res = await fetch(`${prefix}/${backupId}/raw-url`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to fetch raw backup URL.");
        }
        const data = await res.json();
        if (!data.allowed) {
          return { kind: "guardrail", sizeBytes: data.sizeBytes ?? 0 };
        }

        const dumpRes = await fetch(data.url);
        if (!dumpRes.ok) {
          throw new Error(`Failed to fetch backup file: ${dumpRes.statusText}`);
        }
        if (!dumpRes.body) {
          throw new Error("Backup response body is empty.");
        }

        const decompressedStream = dumpRes.body
          .pipeThrough(new DecompressionStream("gzip"))
          .pipeThrough(new TextDecoderStream());

        const reader = decompressedStream.getReader();
        let sql = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          sql += value;
        }

        return { kind: "loaded", sql };
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to load raw SQL.";
        return { kind: "error", message };
      }
    },
    [inspectSession]
  );

  const handleInspectRetry = useCallback(() => {
    setInspectSession((current) => {
      if (!current) return current;
      setInspectSession({ backup: current.backup, manifestState: { kind: "loading" } });
      void fetchManifestFor(current.backup).then((manifestState) => {
        setInspectSession((latest) =>
          latest && latest.backup.id === current.backup.id
            ? { backup: current.backup, manifestState }
            : latest
        );
      });
      return current;
    });
  }, [fetchManifestFor]);

  const filteredBackups = backups.filter((b) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      b.databaseName.toLowerCase().includes(q) ||
      b.host.toLowerCase().includes(q) ||
      String(b.port).includes(q)
    );
  });

  // The drawer closes itself when its subject is no longer in the backup
  // list (e.g. after a delete). We derive this at render time rather than in
  // an effect so we don't fight the lint rule that bans setState in effects.
  const knownBackupIds = new Set(backups.map((b) => b.id));
  const openInspectSession =
    inspectSession && knownBackupIds.has(inspectSession.backup.id)
      ? inspectSession
      : null;

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <div className="rounded-xl border border-hairline bg-surface-card p-6 shadow-2xs sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-hairline pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-cream-strong border border-hairline text-primary">
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-xl sm:text-2xl font-normal tracking-tight text-ink">
                  Database Backups
                </h2>
                <span className="inline-flex items-center rounded-full bg-surface-cream-strong border border-hairline px-2.5 py-0.5 text-xs font-semibold text-body-strong">
                  {backups.length}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Compressed database backups (.sql.gz) stored in S3-compatible object storage.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={fetchBackups}
            disabled={isLoading}
            className="flex items-center gap-1.5 self-start sm:self-auto rounded-md border border-hairline bg-canvas px-3.5 py-1.5 text-xs font-medium text-body shadow-xs transition hover:bg-surface-soft hover:text-ink disabled:opacity-50"
          >
            <svg
              className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span>Refresh</span>
          </button>
        </div>

        {/* Action Success Alert */}
        {actionSuccess && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">
            <svg
              className="h-4 w-4 shrink-0 text-success"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth="2"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>{actionSuccess}</span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-error/30 bg-error/10 p-3.5 text-xs text-error">
            <span>{error}</span>
            <button
              type="button"
              onClick={fetchBackups}
              className="font-semibold underline hover:text-error ml-2"
            >
              Retry
            </button>
          </div>
        )}

        {/* Search Filter */}
        <div className="mt-5">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-soft">
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search backups by database name or server host..."
              className="block w-full rounded-md border border-hairline bg-canvas py-2 pl-9 pr-8 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-muted hover:text-ink"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Backups List */}
        <div className="mt-6">
          {isLoading && backups.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted">
              <svg
                className="h-5 w-5 animate-spin mr-2 text-primary"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span className="text-xs">Loading database backups...</span>
            </div>
          ) : backups.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hairline py-12 text-center bg-canvas/40">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-surface-cream-strong text-primary border border-hairline">
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                  />
                </svg>
              </div>
              <p className="mt-3 text-sm font-semibold text-ink">
                No database backups yet
              </p>
              <p className="mt-1 text-xs text-muted max-w-sm mx-auto">
                Connect to any MySQL or PostgreSQL server in the Database Explorer tab and click the{" "}
                <span className="font-semibold text-body">Backup</span> button next to any database to create an instant S3 backup.
              </p>
            </div>
          ) : filteredBackups.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hairline py-8 text-center text-xs text-muted bg-canvas/40">
              No backups match &quot;{searchQuery}&quot;.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredBackups.map((backup) => {
                const isDownloading = downloadingId === backup.id;
                const isDeleting = deletingId === backup.id;
                const isConfirmingDelete = confirmDeleteId === backup.id;

                return (
                  <div
                    key={backup.id}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3.5 rounded-lg border border-hairline bg-canvas p-4 transition hover:border-primary/40 hover:shadow-2xs"
                  >
                    {/* Database & Server Details */}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-mono font-bold text-sm text-ink">
                          {backup.databaseName}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                            backup.engine === "sqlite"
                              ? "border-hairline bg-surface-cream-strong text-primary"
                              : backup.engine === "postgres"
                              ? "border-hairline bg-surface-cream-strong text-body-strong"
                              : "border-hairline bg-surface-soft text-body"
                          }`}
                        >
                          {backup.engine === "sqlite"
                            ? "SQLite"
                            : backup.engine === "postgres"
                            ? "PostgreSQL"
                            : "MySQL"}
                        </span>
                        <span className="inline-flex items-center rounded-md border border-hairline bg-surface-soft px-2 py-0.5 text-[11px] font-medium text-body">
                          {backup.engine === "sqlite" ? backup.host : `${backup.host}:${backup.port}`}
                        </span>
                        <span className="inline-flex items-center rounded-md border border-hairline bg-surface-cream-strong px-2 py-0.5 text-[11px] font-medium text-body-strong">
                          {formatBytes(backup.sizeBytes)}
                        </span>
                        <span
                          className="text-[11px] text-muted-soft"
                          title={new Date(backup.createdAt).toLocaleString()}
                        >
                          • {formatRelativeTime(backup.createdAt)}
                        </span>
                      </div>

                      <p
                        className="font-mono text-[11px] text-muted truncate max-w-xl"
                        title={backup.s3Key}
                      >
                        {backup.s3Key}
                      </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      {isConfirmingDelete ? (
                        <div className="flex items-center gap-1.5 rounded-md border border-error/30 bg-error/10 p-1">
                          <span className="text-xs text-error font-medium pl-1">
                            Delete?
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDelete(backup)}
                            disabled={isDeleting}
                            className="rounded bg-error px-2.5 py-1 text-xs font-semibold text-white shadow-2xs transition hover:opacity-90 disabled:opacity-50"
                          >
                            {isDeleting ? "..." : "Confirm"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded border border-hairline bg-canvas px-2 py-1 text-xs font-medium text-body hover:bg-surface-soft"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          {/* Download Button */}
                          <button
                            type="button"
                            onClick={() => handleDownload(backup)}
                            disabled={isDownloading}
                            title="Download backup (.sql.gz) from S3"
                            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-on-primary shadow-xs transition hover:bg-primary-active disabled:opacity-50"
                          >
                            {isDownloading ? (
                              <>
                                <svg
                                  className="h-3.5 w-3.5 animate-spin text-on-primary"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                >
                                  <circle
                                    className="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    strokeWidth="4"
                                  ></circle>
                                  <path
                                    className="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                  ></path>
                                </svg>
                                <span>Preparing...</span>
                              </>
                            ) : (
                              <>
                                <svg
                                  className="h-3.5 w-3.5 text-on-primary"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                  strokeWidth="2"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                                  />
                                </svg>
                                <span>Download</span>
                              </>
                            )}
                          </button>

                          {/* Inspect Button */}
                          {(() => {
                            const availability = inspectAvailability[backup.id];
                            const unavailable = availability === "unavailable";
                            const isChecking =
                              availability === undefined &&
                              inspectingId === backup.id;
                            const inspectTitle = unavailable
                              ? "This backup predates the inspection feature."
                              : "Inspect backup contents";
                            return (
                              <button
                                type="button"
                                onClick={() => void handleInspect(backup)}
                                disabled={unavailable || isChecking}
                                title={inspectTitle}
                                aria-label={inspectTitle}
                                className="flex items-center gap-1.5 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-xs font-medium text-body shadow-2xs transition hover:bg-surface-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isChecking ? (
                                  <>
                                    <svg
                                      className="h-3.5 w-3.5 animate-spin text-primary"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                    >
                                      <circle
                                        className="opacity-25"
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        stroke="currentColor"
                                        strokeWidth="4"
                                      ></circle>
                                      <path
                                        className="opacity-75"
                                        fill="currentColor"
                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                      ></path>
                                    </svg>
                                    <span>Checking...</span>
                                  </>
                                ) : (
                                  <>
                                    <svg
                                      className="h-3.5 w-3.5 text-muted"
                                      fill="none"
                                      stroke="currentColor"
                                      viewBox="0 0 24 24"
                                      strokeWidth="2"
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                      />
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                      />
                                    </svg>
                                    <span>Inspect</span>
                                  </>
                                )}
                              </button>
                            );
                          })()}

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(backup.id)}
                            title="Delete backup"
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted transition hover:border-error/30 hover:bg-error/10 hover:text-error"
                          >
                            <svg
                              className="h-3.5 w-3.5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              strokeWidth="2"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                              />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <InspectDrawer
        key={openInspectSession?.backup.id ?? "closed"}
        backup={openInspectSession?.backup ?? null}
        manifestState={
          openInspectSession?.manifestState ?? { kind: "loading" }
        }
        onRetry={handleInspectRetry}
        onClose={() => setInspectSession(null)}
        onFetchSchema={fetchSchemaFor}
        onFetchRows={fetchRowsFor}
        onFetchRaw={fetchRawFor}
        onDownload={() => {
          if (openInspectSession) {
            void handleDownload(openInspectSession.backup);
          }
        }}
      />
    </div>
  );
}
