"use client";

import { useEffect, useState } from "react";
import { formatRelativeTime } from "@/lib/format";

export interface BackupRunItem {
  id: string;
  scheduleId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "failed" | "skipped";
  errorMessage: string | null;
  skipReason: string | null;
  backupId: string | null;
}

interface RunHistoryProps {
  scheduleId: string;
  open: boolean;
}

function statusBadgeClass(status: BackupRunItem["status"]): string {
  switch (status) {
    case "success":
      return "bg-emerald-50 text-emerald-700";
    case "failed":
      return "bg-rose-50 text-rose-700";
    case "skipped":
      return "bg-amber-50 text-amber-700";
    case "running":
      return "bg-sky-50 text-sky-700";
  }
}

export function RunHistory({ scheduleId, open }: RunHistoryProps) {
  const [runs, setRuns] = useState<BackupRunItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    async function load() {
      setError(null);
      try {
        const res = await fetch(`/api/mysql/schedules/${scheduleId}/runs?limit=20`);
        const data = await res.json();
        if (ignore) return;
        if (!res.ok) {
          setError(data.error || "Failed to load runs.");
          return;
        }
        setRuns(data.runs || []);
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load runs.");
        }
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    void load();
    return () => {
      ignore = true;
    };
  }, [open, scheduleId]);

  if (!open) return null;

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-700">
          Recent runs
        </h4>
        {isLoading && (
          <svg className="h-3.5 w-3.5 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
      )}

      {!error && !isLoading && runs.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-200 py-4 text-center text-xs text-zinc-500">
          No runs recorded yet.
        </div>
      )}

      {!error && runs.length > 0 && (
        <div className="space-y-2">
          {runs.map((run) => (
            <div
              key={run.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-100 bg-zinc-50/40 px-2.5 py-1.5 text-xs"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase ${statusBadgeClass(run.status)}`}
                >
                  {run.status}
                </span>
                <span className="text-zinc-500" title={new Date(run.startedAt).toLocaleString()}>
                  {formatRelativeTime(run.startedAt)}
                </span>
              </div>
              {run.status === "failed" && run.errorMessage && (
                <span className="max-w-xs truncate text-[11px] text-rose-600" title={run.errorMessage}>
                  {run.errorMessage}
                </span>
              )}
              {run.status === "skipped" && run.skipReason && (
                <span className="text-[11px] text-amber-600">{run.skipReason}</span>
              )}
              {run.status === "success" && run.backupId && (
                <a
                  href={`/api/mysql/backups/${run.backupId}/download`}
                  className="text-[11px] font-semibold text-zinc-700 underline hover:text-zinc-900"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Download
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
