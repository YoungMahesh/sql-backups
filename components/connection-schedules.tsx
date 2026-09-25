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
      <div className="mt-2 px-2 text-[11px] text-zinc-400">Loading schedules…</div>
    );
  }

  if (schedules.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 border-t border-zinc-100 pt-2">
      <p className="px-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        Schedules
      </p>
      {schedules.map((s) => (
        <div
          key={s.id}
          className="flex items-center justify-between rounded-md bg-white/60 px-2 py-1 text-[11px]"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono font-semibold text-zinc-800 truncate">{s.databaseName}</span>
            <span className="text-zinc-400 truncate" title={s.cronExpression}>
              {s.cronExpression}
            </span>
          </div>
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              s.enabled ? "bg-emerald-50 text-emerald-700" : "bg-zinc-200 text-zinc-700"
            }`}
          >
            {s.enabled ? "on" : "off"}
          </span>
        </div>
      ))}
    </div>
  );
}
