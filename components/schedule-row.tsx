"use client";

import { useState } from "react";
import { RunHistory } from "./run-history";

const CRON_DESCRIPTIONS: Array<{ expr: string; description: string }> = [
  { expr: "0 * * * *", description: "Every hour" },
  { expr: "0 0 * * *", description: "Daily at midnight" },
  { expr: "0 2 * * *", description: "Daily at 02:00" },
  { expr: "0 0 * * 0", description: "Weekly on Sunday at midnight" },
  { expr: "0 0 1 * *", description: "Monthly on the 1st at midnight" },
];

function describeCron(expr: string): string {
  const match = CRON_DESCRIPTIONS.find((c) => c.expr === expr);
  return match ? match.description : "Custom cron";
}

export interface ScheduleItem {
  id: string;
  userId: string;
  savedConnectionId: string;
  databaseName: string;
  cronExpression: string;
  timezone: string;
  retentionCount: number;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  connectionHost: string;
  connectionPort: number;
  connectionUsername: string;
}

interface ScheduleRowProps {
  schedule: ScheduleItem;
  onEdit: (schedule: ScheduleItem) => void;
  onDeleted: (id: string) => void;
  onChanged: () => void;
}

function formatAbsolute(dateString: string | null): string {
  if (!dateString) return "—";
  try {
    const d = new Date(dateString);
    return d.toLocaleString();
  } catch {
    return "—";
  }
}

export function ScheduleRow({ schedule, onEdit, onDeleted, onChanged }: ScheduleRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/mysql/schedules/${schedule.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete schedule.");
      onDeleted(schedule.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete schedule.");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggle = async () => {
    setToggling(true);
    setError(null);
    try {
      const res = await fetch(`/api/mysql/schedules/${schedule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update schedule.");
      onChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update schedule.");
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-4 transition hover:border-zinc-300 hover:bg-white">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-mono font-bold text-sm text-zinc-900">{schedule.databaseName}</span>
            <span className="inline-flex items-center rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700">
              {schedule.connectionHost}:{schedule.connectionPort}
            </span>
            <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
              {schedule.timezone}
            </span>
            <span className="inline-flex items-center rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
              keep last {schedule.retentionCount}
            </span>
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                schedule.enabled
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-zinc-200 text-zinc-700"
              }`}
            >
              {schedule.enabled ? "enabled" : "disabled"}
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">
            <span className="font-medium text-zinc-700">{describeCron(schedule.cronExpression)}</span>
            <span className="ml-1.5 font-mono text-zinc-400" title={schedule.cronExpression}>
              ({schedule.cronExpression})
            </span>
          </p>
          <div className="grid grid-cols-1 gap-1 text-[11px] text-zinc-500 sm:grid-cols-2">
            <span title={formatAbsolute(schedule.nextRunAt)}>
              Next run: <span className="font-medium text-zinc-700">{formatAbsolute(schedule.nextRunAt)}</span>
            </span>
            <span title={formatAbsolute(schedule.lastRunAt)}>
              Last run: <span className="font-medium text-zinc-700">{formatAbsolute(schedule.lastRunAt)}</span>
            </span>
          </div>
          {error && <p className="text-[11px] text-rose-600">{error}</p>}
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50/60 p-1">
              <span className="text-xs text-rose-700 font-medium pl-1">Delete?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white shadow-2xs transition hover:bg-rose-700 disabled:opacity-50"
              >
                {deleting ? "..." : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={handleToggle}
                disabled={toggling}
                className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-2xs transition hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50"
              >
                {schedule.enabled ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                onClick={() => setShowRuns((v) => !v)}
                className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 shadow-2xs transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                {showRuns ? "Hide runs" : "Runs"}
              </button>
              <button
                type="button"
                onClick={() => onEdit(schedule)}
                className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 shadow-2xs transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                title="Delete schedule"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-zinc-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
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

      <RunHistory scheduleId={schedule.id} open={showRuns} />
    </div>
  );
}
