"use client";

import { useEffect, useState } from "react";

export interface SavedConnectionOption {
  id: string;
  host: string;
  port: number;
  username: string;
  database: string | null;
  engine?: "mysql" | "postgres" | "sqlite";
}

interface ScheduleFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  connections: SavedConnectionOption[];
  initial?: {
    id: string;
    savedConnectionId: string;
    databaseName: string;
    cronExpression: string;
    timezone: string;
    retentionCount: number;
    enabled: boolean;
    engine?: "mysql" | "postgres" | "sqlite";
  };
  defaultDatabase?: string;
  defaultSavedConnectionId?: string;
  initialTimezone?: string;
}

const CRON_PRESETS: Array<{ label: string; expr: string; description: string }> = [
  { label: "Hourly", expr: "0 * * * *", description: "At the start of every hour" },
  { label: "Daily at midnight", expr: "0 0 * * *", description: "00:00 every day" },
  { label: "Daily at 2 AM", expr: "0 2 * * *", description: "02:00 every day" },
  { label: "Weekly (Sunday midnight)", expr: "0 0 * * 0", description: "00:00 every Sunday" },
  { label: "Monthly (1st midnight)", expr: "0 0 1 * *", description: "00:00 on the 1st of each month" },
];

const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function findMatchingPreset(expr: string): string | null {
  const match = CRON_PRESETS.find((p) => p.expr === expr);
  return match ? match.label : null;
}

export function ScheduleForm({
  open,
  onClose,
  onSaved,
  connections,
  initial,
  defaultDatabase,
  defaultSavedConnectionId,
  initialTimezone,
}: ScheduleFormProps) {
  const isEdit = !!initial;

  const [savedConnectionId, setSavedConnectionId] = useState<string>(
    initial?.savedConnectionId ?? defaultSavedConnectionId ?? ""
  );
  const [databaseName, setDatabaseName] = useState<string>(
    initial?.databaseName ?? defaultDatabase ?? ""
  );
  const [preset, setPreset] = useState<string>(
    initial ? findMatchingPreset(initial.cronExpression) ?? "custom" : "Daily at 2 AM"
  );
  const [customCron, setCustomCron] = useState<string>(
    findMatchingPreset(initial?.cronExpression ?? "0 2 * * *") ? "" : initial?.cronExpression ?? ""
  );
  const effectiveCron =
    preset === "custom"
      ? customCron
      : CRON_PRESETS.find((p) => p.label === preset)?.expr ?? customCron;

  const [timezone, setTimezone] = useState<string>(() => {
    if (initial?.timezone) return initial.timezone;
    if (initialTimezone) return initialTimezone;
    return detectBrowserTimezone();
  });
  const [retentionCount, setRetentionCount] = useState<number>(
    initial?.retentionCount ?? 7
  );
  const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true);

  const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !savedConnectionId) {
      return;
    }
    let ignore = false;
    void (async () => {
      setLoadingDatabases(true);
      try {
        const selectedConn = connections.find((c) => c.id === savedConnectionId);
        const endpoint =
          selectedConn?.engine === "sqlite"
            ? `/api/sqlite/databases`
            : selectedConn?.engine === "postgres"
            ? `/api/postgres/databases`
            : `/api/mysql/databases`;

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "saved", savedConnectionId }),
        });
        const data = await res.json();
        if (ignore) return;
        if (!res.ok) {
          setError(data.error || "Failed to load databases.");
        } else {
          setAvailableDatabases(data.databases || []);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load databases.");
        }
      } finally {
        if (!ignore) setLoadingDatabases(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [open, savedConnectionId, connections]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setValidationErrors([]);

    try {
      const selectedConn = connections.find((c) => c.id === savedConnectionId);
      const targetEngine = isEdit
        ? initial?.engine || selectedConn?.engine
        : selectedConn?.engine;
      const apiPrefix =
        targetEngine === "sqlite"
          ? "/api/sqlite/schedules"
          : targetEngine === "postgres"
          ? "/api/postgres/schedules"
          : "/api/mysql/schedules";

      const body = isEdit
        ? {
            cronExpression: effectiveCron.trim(),
            timezone,
            retentionCount,
            enabled,
          }
        : {
            savedConnectionId,
            databaseName: databaseName.trim(),
            cronExpression: effectiveCron.trim(),
            timezone,
            retentionCount,
          };

      const url = isEdit ? `${apiPrefix}/${initial!.id}` : apiPrefix;
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.details)) {
          setValidationErrors(data.details);
        }
        throw new Error(data.error || "Failed to save schedule.");
      }

      onSaved();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save schedule.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-xl rounded-xl border border-hairline bg-surface-card shadow-xl">
        <div className="flex items-start justify-between border-b border-hairline p-6">
          <div>
            <h2 className="font-serif text-xl font-normal text-ink">
              {isEdit ? "Edit Schedule" : "New Schedule"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              Configure when and how often to back up a database.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-ink"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          {error && (
            <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-xs text-error">
              {error}
              {validationErrors.length > 0 && (
                <ul className="mt-2 list-disc pl-5">
                  {validationErrors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!isEdit && (
            <>
              <div>
                <label htmlFor="schedule-connection" className="block text-xs font-semibold uppercase tracking-wider text-body">
                  Saved Connection
                </label>
                <select
                  id="schedule-connection"
                  value={savedConnectionId}
                  onChange={(e) => {
                    setSavedConnectionId(e.target.value);
                    setDatabaseName("");
                  }}
                  required
                  className="mt-1.5 block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Select a connection…</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.engine === "sqlite"
                        ? `${c.host} (${c.database || "main"}) — SQLite`
                        : `${c.host}:${c.port} (${c.username}) — ${c.engine === "postgres" ? "PostgreSQL" : "MySQL"}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="schedule-database" className="block text-xs font-semibold uppercase tracking-wider text-body">
                  Database
                </label>
                {loadingDatabases ? (
                  <div className="mt-1.5 rounded-md border border-hairline bg-surface-soft px-3 py-2 text-xs text-muted">
                    Loading databases…
                  </div>
                ) : availableDatabases.length > 0 ? (
                  <select
                    id="schedule-database"
                    value={databaseName}
                    onChange={(e) => setDatabaseName(e.target.value)}
                    required
                    className="mt-1.5 block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Select a database…</option>
                    {availableDatabases.map((db) => (
                      <option key={db} value={db}>
                        {db}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="schedule-database"
                    type="text"
                    value={databaseName}
                    onChange={(e) => setDatabaseName(e.target.value)}
                    placeholder="production_app"
                    required
                    className="mt-1.5 block w-full rounded-md border border-hairline bg-canvas px-3 py-2 font-mono text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                )}
                {!savedConnectionId && (
                  <p className="mt-1 text-[11px] text-muted-soft">
                    Select a connection first to load available databases.
                  </p>
                )}
              </div>
            </>
          )}

          {isEdit && (
            <div className="rounded-md border border-hairline bg-surface-soft px-3 py-2 text-xs text-body">
              <div>
                <span className="font-semibold text-ink">Target:</span>{" "}
                <span className="font-mono">{initial!.databaseName}</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-body">
              Recurrence
            </label>
            <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CRON_PRESETS.map((p) => (
                <label
                  key={p.label}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs transition ${
                    preset === p.label
                      ? "border-primary bg-surface-soft"
                      : "border-hairline bg-canvas hover:border-primary/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="cron-preset"
                    value={p.label}
                    checked={preset === p.label}
                    onChange={() => setPreset(p.label)}
                    className="mt-0.5 h-3.5 w-3.5 accent-primary"
                  />
                  <div>
                    <div className="font-medium text-ink">{p.label}</div>
                    <div className="text-[11px] text-muted">{p.description}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted-soft">{p.expr}</div>
                  </div>
                </label>
              ))}
              <label
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs transition ${
                  preset === "custom"
                    ? "border-primary bg-surface-soft"
                    : "border-hairline bg-canvas hover:border-primary/40"
                }`}
              >
                <input
                  type="radio"
                  name="cron-preset"
                  value="custom"
                  checked={preset === "custom"}
                  onChange={() => setPreset("custom")}
                  className="mt-0.5 h-3.5 w-3.5 accent-primary"
                />
                <div>
                  <div className="font-medium text-ink">Custom</div>
                  <div className="text-[11px] text-muted">Provide a raw 5-field cron expression</div>
                </div>
              </label>
            </div>

            {preset === "custom" && (
              <div className="mt-2">
                <input
                  type="text"
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="0 2 * * *"
                  className="block w-full rounded-md border border-hairline bg-canvas px-3 py-2 font-mono text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="mt-1 text-[11px] text-muted-soft">
                  Format: <code>min hour day-of-month month day-of-week</code>
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="schedule-timezone" className="block text-xs font-semibold uppercase tracking-wider text-body">
                Timezone
              </label>
              <select
                id="schedule-timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1.5 block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Browser default…</option>
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="schedule-retention" className="block text-xs font-semibold uppercase tracking-wider text-body">
                Keep last N backups
              </label>
              <input
                id="schedule-retention"
                type="number"
                min={1}
                max={999}
                value={retentionCount}
                onChange={(e) => setRetentionCount(parseInt(e.target.value, 10) || 1)}
                className="mt-1.5 block w-full rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-body">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-hairline accent-primary"
            />
            <span>Schedule is enabled</span>
          </label>

          <div className="flex items-center justify-end gap-2 border-t border-hairline pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-hairline bg-canvas px-3.5 py-1.5 text-xs font-medium text-body hover:bg-surface-soft hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-on-primary shadow-xs transition hover:bg-primary-active disabled:opacity-50"
            >
              {submitting ? "Saving…" : isEdit ? "Save Changes" : "Create Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
