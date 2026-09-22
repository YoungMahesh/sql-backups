"use client";

import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { ScheduleForm, type SavedConnectionOption } from "./schedule-form";
import { ScheduleRow, type ScheduleItem } from "./schedule-row";

interface ScheduleManagerProps {
  onSchedulesLoaded?: (count: number) => void;
  refreshTrigger?: number;
}

export function ScheduleManager({
  onSchedulesLoaded,
  refreshTrigger,
}: ScheduleManagerProps = {}) {
  const { data: session } = authClient.useSession();
  const userTimezone =
    (session?.user as { timezone?: string | null } | undefined)?.timezone ?? null;

  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [connections, setConnections] = useState<SavedConnectionOption[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleItem | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchSchedules = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mysql/schedules");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load schedules.");
      }
      const list: ScheduleItem[] = data.schedules || [];
      setSchedules(list);
      onSchedulesLoaded?.(list.length);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load schedules.");
    } finally {
      setIsLoading(false);
    }
  }, [onSchedulesLoaded]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch("/api/mysql/schedules");
        const data = await res.json();
        if (!ignore) {
          if (!res.ok) {
            setError(data.error || "Failed to load schedules.");
          } else {
            const list: ScheduleItem[] = data.schedules || [];
            setSchedules(list);
            onSchedulesLoaded?.(list.length);
          }
        }
      } catch (err: unknown) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load schedules.");
        }
      } finally {
        if (!ignore) setIsLoading(false);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [refreshTrigger, onSchedulesLoaded]);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch("/api/mysql/connections");
        const data = await res.json();
        if (ignore) return;
        if (!res.ok) return;
        setConnections(data.connections || []);
      } catch {
        // Non-critical
      } finally {
        if (!ignore) setIsLoadingConnections(false);
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingConnections(true);
    void load();
    return () => {
      ignore = true;
    };
  }, []);

  const handleSaved = () => {
    setActionSuccess("Schedule saved successfully.");
    setTimeout(() => setActionSuccess(null), 3000);
    fetchSchedules();
  };

  const handleDeleted = (id: string) => {
    setSchedules((prev) => prev.filter((s) => s.id !== id));
    onSchedulesLoaded?.(schedules.length - 1);
    setActionSuccess("Schedule deleted.");
    setTimeout(() => setActionSuccess(null), 3000);
  };

  const filteredSchedules = schedules.filter((s) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      s.databaseName.toLowerCase().includes(q) ||
      s.connectionHost.toLowerCase().includes(q) ||
      String(s.connectionPort).includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-hairline bg-surface-card p-6 shadow-2xs sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-hairline pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-cream-strong border border-hairline text-primary">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-xl sm:text-2xl font-normal tracking-tight text-ink">
                  Scheduled Backups
                </h2>
                <span className="inline-flex items-center rounded-full bg-surface-cream-strong border border-hairline px-2.5 py-0.5 text-xs font-semibold text-body-strong">
                  {schedules.length}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Cron-based backup schedules. Evaluated in each schedule&apos;s timezone.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <button
              type="button"
              onClick={fetchSchedules}
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded-md border border-hairline bg-canvas px-3.5 py-1.5 text-xs font-medium text-body shadow-xs transition hover:bg-surface-soft hover:text-ink disabled:opacity-50"
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
            <button
              type="button"
              onClick={() => {
                setEditingSchedule(null);
                setFormOpen(true);
              }}
              disabled={isLoadingConnections || connections.length === 0}
              title={
                connections.length === 0
                  ? "Create a saved connection first"
                  : "New schedule"
              }
              className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-medium text-on-primary shadow-xs transition hover:bg-primary-active disabled:opacity-50"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              <span>New Schedule</span>
            </button>
          </div>
        </div>

        {actionSuccess && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">
            <svg className="h-4 w-4 shrink-0 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>{actionSuccess}</span>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-center justify-between rounded-lg border border-error/30 bg-error/10 p-3.5 text-xs text-error">
            <span>{error}</span>
            <button
              type="button"
              onClick={fetchSchedules}
              className="font-semibold underline hover:text-error ml-2"
            >
              Retry
            </button>
          </div>
        )}

        <div className="mt-5">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-soft">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search schedules by database or server host..."
              className="block w-full rounded-md border border-hairline bg-canvas py-2 pl-9 pr-8 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-muted hover:text-ink"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="mt-6">
          {isLoading && schedules.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted">
              <svg className="h-5 w-5 animate-spin mr-2 text-primary" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-xs">Loading schedules...</span>
            </div>
          ) : schedules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hairline py-12 text-center bg-canvas/40">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-surface-cream-strong text-primary border border-hairline">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                  <circle cx="12" cy="12" r="9" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                </svg>
              </div>
              <p className="mt-3 text-sm font-semibold text-ink">No schedules yet</p>
              <p className="mt-1 text-xs text-muted max-w-sm mx-auto">
                {connections.length === 0
                  ? "Create a saved connection in the Database Explorer tab first."
                  : "Click New Schedule to set up a recurring backup for any of your databases."}
              </p>
            </div>
          ) : filteredSchedules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hairline py-8 text-center text-xs text-muted bg-canvas/40">
              No schedules match &quot;{searchQuery}&quot;.
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSchedules.map((s) => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  onEdit={(sched) => {
                    setEditingSchedule(sched);
                    setFormOpen(true);
                  }}
                  onDeleted={handleDeleted}
                  onChanged={fetchSchedules}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ScheduleForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
        connections={connections}
        initial={
          editingSchedule
            ? {
                id: editingSchedule.id,
                savedConnectionId: editingSchedule.savedConnectionId,
                databaseName: editingSchedule.databaseName,
                cronExpression: editingSchedule.cronExpression,
                timezone: editingSchedule.timezone,
                retentionCount: editingSchedule.retentionCount,
                enabled: editingSchedule.enabled,
              }
            : undefined
        }
        initialTimezone={userTimezone ?? undefined}
      />
    </div>
  );
}
