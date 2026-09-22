"use client";

import { useEffect, useState } from "react";

interface InlineSchedule {
  id: string;
  databaseName: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string | null;
}

interface ConnectionSchedulesProps {
  savedConnectionId: string;
}

export function ConnectionSchedules({ savedConnectionId }: ConnectionSchedulesProps) {
  const [schedules, setSchedules] = useState<InlineSchedule[] | null>(null);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const res = await fetch("/api/mysql/schedules");
        const data = await res.json();
        if (ignore) return;
        if (!res.ok) return;
        const list = (data.schedules || []) as Array<
          InlineSchedule & { savedConnectionId: string }
        >;
        setSchedules(list.filter((s) => s.savedConnectionId === savedConnectionId));
      } catch {
        if (!ignore) setSchedules([]);
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [savedConnectionId]);

  if (schedules === null) {
    return (
      <div className="mt-2 px-2 text-[11px] text-muted-soft">Loading schedules…</div>
    );
  }

  if (schedules.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 border-t border-hairline pt-2">
      <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-soft">
        Schedules
      </p>
      {schedules.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between rounded-md border border-hairline/60 bg-surface-soft px-2 py-1 text-[11px]"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono font-semibold text-ink truncate">{s.databaseName}</span>
            <span className="text-muted-soft truncate" title={s.cronExpression}>
              {s.cronExpression}
            </span>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold border ${
              s.enabled
                ? "border-success/30 bg-success/15 text-success"
                : "border-hairline bg-surface-cream-strong text-muted"
            }`}
          >
            {s.enabled ? "on" : "off"}
          </span>
        </div>
      ))}
    </div>
  );
}
