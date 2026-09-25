"use client";

import { useEffect, useState } from "react";
import type { BackupManifest } from "@/lib/manifest";
import { formatRowCount } from "@/lib/format";

export interface InspectDrawerBackup {
  id: string;
  databaseName: string;
  host: string;
  port: number;
}

export type ManifestViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; manifest: BackupManifest };

export type PanelState<T> =
  | { kind: "loading" }
  | { kind: "loaded"; data: T }
  | { kind: "error"; message: string };

export interface TableInspectState {
  expanded: boolean;
  schema: PanelState<string>;
  rows: PanelState<Record<string, unknown>[]>;
}

const DEFAULT_TABLE_INSPECT_STATE: TableInspectState = {
  expanded: false,
  schema: { kind: "loading" },
  rows: { kind: "loading" },
};

interface InspectDrawerProps {
  backup: InspectDrawerBackup | null;
  manifestState: ManifestViewState;
  onRetry: () => void;
  onClose: () => void;
  onFetchSchema: (backupId: string, table: string) => Promise<PanelState<string>>;
  onFetchRows: (backupId: string, table: string) => Promise<PanelState<Record<string, unknown>[]>>;
}

export function InspectDrawer({
  backup,
  manifestState,
  onRetry,
  onClose,
  onFetchSchema,
  onFetchRows,
}: InspectDrawerProps) {
  const open = backup !== null;

  const [tableState, setTableState] = useState<Record<string, TableInspectState>>({});

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || !backup) return null;

  const ensureTableState = (tableName: string): TableInspectState => {
    return tableState[tableName] ?? { ...DEFAULT_TABLE_INSPECT_STATE };
  };

  const updateTableState = (tableName: string, patch: Partial<TableInspectState>) => {
    setTableState((prev) => {
      const current = prev[tableName] ?? { ...DEFAULT_TABLE_INSPECT_STATE };
      return { ...prev, [tableName]: { ...current, ...patch } };
    });
  };

  const setPanelState = <T,>(
    tableName: string,
    panel: "schema" | "rows",
    state: PanelState<T>
  ) => {
    setTableState((prev) => {
      const current = prev[tableName] ?? { ...DEFAULT_TABLE_INSPECT_STATE };
      return {
        ...prev,
        [tableName]: { ...current, [panel]: state } as TableInspectState,
      };
    });
  };

  const handleToggleTable = async (tableName: string) => {
    const current = ensureTableState(tableName);
    const willExpand = !current.expanded;
    updateTableState(tableName, { expanded: willExpand });

    if (willExpand && current.schema.kind === "loading") {
      setPanelState<string>(tableName, "schema", { kind: "loading" });
      const result = await onFetchSchema(backup.id, tableName);
      setPanelState<string>(tableName, "schema", result);
    }
  };

  const handleShowData = async (tableName: string) => {
    setPanelState<Record<string, unknown>[]>(tableName, "rows", { kind: "loading" });
    const result = await onFetchRows(backup.id, tableName);
    setPanelState<Record<string, unknown>[]>(tableName, "rows", result);
  };

  const handleRetrySchema = async (tableName: string) => {
    setPanelState<string>(tableName, "schema", { kind: "loading" });
    const result = await onFetchSchema(backup.id, tableName);
    setPanelState<string>(tableName, "schema", result);
  };

  const handleRetryRows = async (tableName: string) => {
    setPanelState<Record<string, unknown>[]>(tableName, "rows", { kind: "loading" });
    const result = await onFetchRows(backup.id, tableName);
    setPanelState<Record<string, unknown>[]>(tableName, "rows", result);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Inspect ${backup.databaseName}`}
      className="fixed inset-0 z-50 flex bg-zinc-900/50 backdrop-blur-sm sm:items-stretch sm:justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full flex-col bg-white shadow-xl sm:max-w-xl sm:rounded-l-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 sm:hidden"
              aria-label="Back"
            >
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
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold tracking-tight text-zinc-900 sm:text-lg">
                {backup.databaseName}
              </h2>
              <p className="truncate font-mono text-[11px] text-zinc-500">
                {backup.host}:{backup.port}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 sm:flex"
          >
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Backup inspector tabs"
          className="flex border-b border-zinc-200 px-4 sm:px-6"
        >
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="border-b-2 border-zinc-900 pb-2 pt-3 text-xs font-semibold text-zinc-900"
          >
            Tables
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <TablesTab
            state={manifestState}
            onRetry={onRetry}
            ensureTableState={ensureTableState}
            onToggleTable={handleToggleTable}
            onShowData={handleShowData}
            onRetrySchema={handleRetrySchema}
            onRetryRows={handleRetryRows}
          />
        </div>
      </div>
    </div>
  );
}

interface TablesTabProps {
  state: ManifestViewState;
  onRetry: () => void;
  ensureTableState: (tableName: string) => TableInspectState;
  onToggleTable: (tableName: string) => void;
  onShowData: (tableName: string) => void;
  onRetrySchema: (tableName: string) => void;
  onRetryRows: (tableName: string) => void;
}

function TablesTab({
  state,
  onRetry,
  ensureTableState,
  onToggleTable,
  onShowData,
  onRetrySchema,
  onRetryRows,
}: TablesTabProps) {
  if (state.kind === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-xs text-zinc-500">
        <Spinner />
        <span>Loading tables...</span>
      </div>
    );
  }

  if (state.kind === "error") {
    return <PanelError message={state.message} onRetry={onRetry} />;
  }

  const { tables } = state.manifest;

  if (tables.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 py-12 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400">
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
              d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
            />
          </svg>
        </div>
        <p className="mt-3 text-sm font-semibold text-zinc-800">
          No tables in this backup
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          The backup contains no base tables to inspect.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-1.5">
      {tables.map((table) => {
        const ts = ensureTableState(table.name);
        const isEmpty = table.rowCount === 0;
        return (
          <li
            key={table.name}
            className="overflow-hidden rounded-lg border border-zinc-200/80 bg-zinc-50/40"
          >
            <button
              type="button"
              onClick={() => onToggleTable(table.name)}
              aria-expanded={ts.expanded}
              aria-controls={`table-panel-${cssId(table.name)}`}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-zinc-100/60"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Caret open={ts.expanded} />
                <span className="truncate font-mono text-xs font-semibold text-zinc-900">
                  {table.name}
                </span>
                {isEmpty && (
                  <span className="inline-flex shrink-0 items-center rounded-md bg-zinc-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    empty
                  </span>
                )}
              </span>
              <span
                className={`shrink-0 text-[11px] font-medium ${
                  isEmpty ? "text-zinc-400" : "text-zinc-600"
                }`}
              >
                {formatRowCount(table.rowCount)}
              </span>
            </button>
            {ts.expanded && (
              <div
                id={`table-panel-${cssId(table.name)}`}
                className="border-t border-zinc-200/80 bg-white px-3 py-3 sm:px-4 sm:py-4"
              >
                <SchemaPanel state={ts.schema} onRetry={() => onRetrySchema(table.name)} />
                {isEmpty ? (
                  <p className="mt-3 text-[11px] italic text-zinc-400">
                    This table is empty.
                  </p>
                ) : (
                  <RowsPanel
                    state={ts.rows}
                    onShowData={() => onShowData(table.name)}
                    onRetry={() => onRetryRows(table.name)}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface SchemaPanelProps {
  state: PanelState<string>;
  onRetry: () => void;
}

function SchemaPanel({ state, onRetry }: SchemaPanelProps) {
  if (state.kind === "loading") {
    return (
      <div className="flex items-center gap-2 py-3 text-[11px] text-zinc-500">
        <Spinner />
        <span>Loading schema...</span>
      </div>
    );
  }
  if (state.kind === "error") {
    return <PanelError message={state.message} onRetry={onRetry} compact />;
  }
  return (
    <pre className="max-h-72 overflow-auto rounded-md border border-zinc-200 bg-zinc-50/60 px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-800">
      <code>{state.data}</code>
    </pre>
  );
}

interface RowsPanelProps {
  state: PanelState<Record<string, unknown>[]>;
  onShowData: () => void;
  onRetry: () => void;
}

function RowsPanel({ state, onShowData, onRetry }: RowsPanelProps) {
  if (state.kind === "loading") {
    return (
      <div className="mt-3 flex items-center gap-2 py-2 text-[11px] text-zinc-500">
        <Spinner />
        <span>Loading rows...</span>
      </div>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="mt-3">
        <PanelError message={state.message} onRetry={onRetry} compact />
      </div>
    );
  }
  if (state.data.length === 0) {
    return (
      <p className="mt-3 text-[11px] italic text-zinc-400">
        This table is empty.
      </p>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={onShowData}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 shadow-2xs transition hover:border-zinc-300 hover:bg-zinc-50"
      >
        Show data
      </button>
      <RowsTable rows={state.data} />
    </>
  );
}

function RowsTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = Object.keys(rows[0] ?? {});
  return (
    <div className="mt-3 max-h-80 overflow-auto rounded-md border border-zinc-200">
      <table className="min-w-full divide-y divide-zinc-200 text-[11px]">
        <thead className="sticky top-0 bg-zinc-50">
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                scope="col"
                className="px-2.5 py-1.5 text-left font-mono font-semibold text-zinc-700"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 bg-white">
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} className="px-2.5 py-1.5 align-top text-zinc-800">
                  {renderCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderCell(value: unknown) {
  if (value === null || value === undefined) {
    return <span className="italic text-zinc-400">NULL</span>;
  }
  if (typeof value === "boolean") {
    return <span>{value ? "true" : "false"}</span>;
  }
  if (typeof value === "number") {
    return <span>{String(value)}</span>;
  }
  if (typeof value === "string") {
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }
  if (Buffer.isBuffer(value)) {
    return <span className="font-mono text-zinc-700">0x{value.toString("hex")}</span>;
  }
  if (typeof value === "object") {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] text-zinc-700">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span>{String(value)}</span>;
}

interface PanelErrorProps {
  message: string;
  onRetry: () => void;
  compact?: boolean;
}

function PanelError({ message, onRetry, compact }: PanelErrorProps) {
  return (
    <div
      className={`rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700 ${
        compact ? "p-3" : ""
      }`}
    >
      <p className="font-semibold">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 shadow-2xs transition hover:bg-rose-100"
      >
        Retry
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-zinc-400"
      xmlns="http://www.w3.org/2000/svg"
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
  );
}

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3 w-3 shrink-0 text-zinc-400 transition-transform ${
        open ? "rotate-90" : ""
      }`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth="2"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function cssId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}
