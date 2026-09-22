"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { BackupManifest } from "@/lib/manifest";
import { formatRowCount } from "@/lib/format";

export interface InspectDrawerBackup {
  id: string;
  databaseName: string;
  host: string;
  port: number;
  engine?: "mysql" | "postgres";
}

export type ManifestViewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; manifest: BackupManifest };

export type PanelState<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: T }
  | { kind: "error"; message: string };

export type RawViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "guardrail"; sizeBytes: number }
  | { kind: "loaded"; sql: string }
  | { kind: "error"; message: string };

export interface TableInspectState {
  expanded: boolean;
  schema: PanelState<string>;
  rows: PanelState<Record<string, unknown>[]>;
}

const DEFAULT_TABLE_INSPECT_STATE: TableInspectState = {
  expanded: false,
  schema: { kind: "loading" },
  rows: { kind: "idle" },
};

interface InspectDrawerProps {
  backup: InspectDrawerBackup | null;
  manifestState: ManifestViewState;
  onRetry: () => void;
  onClose: () => void;
  onFetchSchema: (backupId: string, table: string) => Promise<PanelState<string>>;
  onFetchRows: (backupId: string, table: string) => Promise<PanelState<Record<string, unknown>[]>>;
  onFetchRaw: (backupId: string) => Promise<RawViewState>;
  onDownload: () => void;
}

export function InspectDrawer({
  backup,
  manifestState,
  onRetry,
  onClose,
  onFetchSchema,
  onFetchRows,
  onFetchRaw,
  onDownload,
}: InspectDrawerProps) {
  const open = backup !== null;

  const [activeTab, setActiveTab] = useState<"tables" | "raw">("tables");
  const [tableState, setTableState] = useState<Record<string, TableInspectState>>({});
  const [rawState, setRawState] = useState<RawViewState>({ kind: "idle" });

  const handleLoadRaw = useCallback(async () => {
    if (!backup) return;
    setRawState({ kind: "loading" });
    const res = await onFetchRaw(backup.id);
    setRawState(res);
  }, [backup, onFetchRaw]);

  const handleSelectRawTab = () => {
    setActiveTab("raw");
    if (rawState.kind === "idle") {
      void handleLoadRaw();
    }
  };

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
      className="fixed inset-0 z-50 flex bg-ink/40 backdrop-blur-xs sm:items-stretch sm:justify-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full flex-col bg-surface-soft shadow-2xl sm:max-w-xl sm:rounded-l-2xl border-l border-hairline">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-6 sm:py-4 bg-surface-soft">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-card hover:text-ink sm:hidden"
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
              <div className="flex items-center gap-2">
                <h2 className="truncate font-serif text-lg font-medium tracking-tight text-ink sm:text-xl">
                  {backup.databaseName}
                </h2>
                {backup.engine && (
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                      backup.engine === "postgres"
                        ? "border-hairline bg-surface-cream-strong text-body-strong"
                        : "border-hairline bg-surface-soft text-body"
                    }`}
                  >
                    {backup.engine === "postgres" ? "PostgreSQL" : "MySQL"}
                  </span>
                )}
              </div>
              <p className="truncate font-mono text-[11px] text-muted">
                {backup.host}:{backup.port}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-surface-card hover:text-ink sm:flex"
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
          className="flex border-b border-hairline px-4 sm:px-6 bg-surface-soft"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "tables"}
            onClick={() => setActiveTab("tables")}
            className={`border-b-2 pb-2.5 pt-3 text-xs font-medium transition ${
              activeTab === "tables"
                ? "border-primary text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            Tables
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "raw"}
            onClick={handleSelectRawTab}
            className={`ml-4 border-b-2 pb-2.5 pt-3 text-xs font-medium transition ${
              activeTab === "raw"
                ? "border-primary text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            Raw
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5 bg-canvas">
          {activeTab === "tables" ? (
            <TablesTab
              state={manifestState}
              onRetry={onRetry}
              ensureTableState={ensureTableState}
              onToggleTable={handleToggleTable}
              onShowData={handleShowData}
              onRetrySchema={handleRetrySchema}
              onRetryRows={handleRetryRows}
            />
          ) : (
            <RawTab
              state={rawState}
              onRetry={handleLoadRaw}
              onDownload={onDownload}
            />
          )}
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
      <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted">
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
      <div className="rounded-xl border border-dashed border-hairline bg-surface-soft/60 py-12 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-surface-card text-muted">
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
        <p className="mt-3 font-serif text-base font-medium text-ink">
          No tables in this backup
        </p>
        <p className="mt-1 text-xs text-muted">
          The backup contains no base tables to inspect.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {tables.map((table) => {
        const ts = ensureTableState(table.name);
        const isEmpty = table.rowCount === 0;
        return (
          <li
            key={table.name}
            className="overflow-hidden rounded-lg border border-hairline bg-surface-card/60"
          >
            <button
              type="button"
              onClick={() => onToggleTable(table.name)}
              aria-expanded={ts.expanded}
              aria-controls={`table-panel-${cssId(table.name)}`}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition hover:bg-surface-cream-strong/50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Caret open={ts.expanded} />
                <span className="truncate font-mono text-xs font-semibold text-ink">
                  {table.name}
                </span>
                {isEmpty && (
                  <span className="inline-flex shrink-0 items-center rounded-md bg-surface-cream-strong px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                    empty
                  </span>
                )}
              </span>
              <span
                className={`shrink-0 font-mono text-[11px] ${
                  isEmpty ? "text-muted-soft" : "text-muted"
                }`}
              >
                {formatRowCount(table.rowCount)}
              </span>
            </button>
            {ts.expanded && (
              <div
                id={`table-panel-${cssId(table.name)}`}
                className="border-t border-hairline bg-canvas px-3 py-3 sm:px-4 sm:py-4"
              >
                <SchemaPanel state={ts.schema} onRetry={() => onRetrySchema(table.name)} />
                {isEmpty ? (
                  <p className="mt-3 text-[11px] italic text-muted">
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
  if (state.kind === "loading" || state.kind === "idle") {
    return (
      <div className="flex items-center gap-2 py-3 text-[11px] text-muted">
        <Spinner />
        <span>Loading schema...</span>
      </div>
    );
  }
  if (state.kind === "error") {
    return <PanelError message={state.message} onRetry={onRetry} compact />;
  }
  return (
    <pre className="max-h-72 overflow-auto rounded-lg border border-surface-dark-elevated bg-surface-dark px-3 py-2.5 font-mono text-[11px] leading-relaxed text-on-dark selection:bg-surface-dark-soft selection:text-white">
      <code className="font-mono text-on-dark">{state.data}</code>
    </pre>
  );
}

interface RowsPanelProps {
  state: PanelState<Record<string, unknown>[]>;
  onShowData: () => void;
  onRetry: () => void;
}

function RowsPanel({ state, onShowData, onRetry }: RowsPanelProps) {
  if (state.kind === "idle") {
    return (
      <button
        type="button"
        onClick={onShowData}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface-soft px-2.5 py-1.5 text-xs font-medium text-ink shadow-2xs transition hover:bg-surface-cream-strong"
      >
        Show data
      </button>
    );
  }
  if (state.kind === "loading") {
    return (
      <div className="mt-3 flex items-center gap-2 py-2 text-[11px] text-muted">
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
      <p className="mt-3 text-[11px] italic text-muted">
        This table is empty.
      </p>
    );
  }
  return <RowsTable rows={state.data} />;
}

function RowsTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = Object.keys(rows[0] ?? {});
  return (
    <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-hairline bg-canvas">
      <table className="min-w-full divide-y divide-hairline text-[11px]">
        <thead className="sticky top-0 bg-surface-soft">
          <tr>
            {columns.map((c) => (
              <th
                key={c}
                scope="col"
                className="border-b border-hairline px-2.5 py-1.5 text-left font-mono font-medium text-body-strong"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline-soft bg-canvas">
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c} className="px-2.5 py-1.5 align-top text-body">
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

function isBufferObject(
  val: unknown
): val is { type: "Buffer"; data: number[] } {
  return (
    typeof val === "object" &&
    val !== null &&
    (val as { type?: unknown }).type === "Buffer" &&
    Array.isArray((val as { data?: unknown }).data)
  );
}

function renderCell(value: unknown) {
  if (value === null || value === undefined) {
    return <span className="italic text-muted-soft">NULL</span>;
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
  if (isBufferObject(value)) {
    const hex = value.data.map((b) => b.toString(16).padStart(2, "0")).join("");
    return <span className="font-mono text-muted">0x{hex}</span>;
  }
  if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(value)) {
    return <span className="font-mono text-muted">0x{value.toString("hex")}</span>;
  }
  if (typeof value === "object") {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-[10.5px] text-body">
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
      className={`rounded-xl border border-error/20 bg-error/5 p-4 text-xs text-error ${
        compact ? "p-3" : ""
      }`}
    >
      <p className="font-medium">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-error/30 bg-canvas px-2.5 py-1 text-xs font-medium text-error shadow-2xs transition hover:bg-error/10"
      >
        Retry
      </button>
    </div>
  );
}

interface RawTabProps {
  state: RawViewState;
  onRetry: () => void;
  onDownload: () => void;
}

function RawTab({ state, onRetry, onDownload }: RawTabProps) {
  const [copied, setCopied] = useState(false);

  const lineCount =
    state.kind === "loaded" ? (state.sql.match(/\n/g)?.length ?? 0) + 1 : 0;
  const gutter = useMemo(() => {
    if (state.kind !== "loaded") return "";
    const nums: string[] = [];
    for (let i = 1; i <= lineCount; i++) {
      nums.push(String(i));
    }
    return nums.join("\n");
  }, [state.kind, lineCount]);

  if (state.kind === "loading" || state.kind === "idle") {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted">
        <Spinner />
        <span>Loading raw SQL...</span>
      </div>
    );
  }

  if (state.kind === "error") {
    return <PanelError message={state.message} onRetry={onRetry} />;
  }

  if (state.kind === "guardrail") {
    const sizeMb = Math.round(state.sizeBytes / (1024 * 1024));
    return (
      <div className="rounded-xl border border-dashed border-hairline bg-surface-soft/60 py-12 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-surface-card text-muted">
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
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
        </div>
        <p className="mt-3 font-serif text-base font-medium text-ink">
          Download to view — file is {sizeMb} MB
        </p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted">
          This backup exceeds the 50 MB in-browser viewing limit. Download the
          file to view its full contents.
        </p>
        <button
          type="button"
          onClick={onDownload}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-2xs transition hover:bg-primary-active"
        >
          <svg
            className="h-3.5 w-3.5 text-white"
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
        </button>
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(state.sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy raw SQL:", err);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleCopy}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-2xs transition ${
            copied
              ? "border-success/30 bg-success/10 text-success"
              : "border-hairline bg-surface-card hover:bg-surface-cream-strong text-ink"
          }`}
        >
          {copied ? (
            <>
              <svg
                className="h-3.5 w-3.5 text-success"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span>Copied!</span>
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
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <span>Copy to clipboard</span>
            </>
          )}
        </button>
      </div>

      <pre className="max-h-[calc(100vh-220px)] overflow-auto rounded-lg border border-surface-dark-elevated bg-surface-dark p-3 font-mono text-[11px] leading-relaxed text-on-dark selection:bg-surface-dark-soft selection:text-white">
        <div className="flex min-w-full">
          <span
            className="select-none pr-4 text-right text-on-dark-soft font-mono"
            aria-hidden="true"
          >
            {gutter}
          </span>
          <code className="whitespace-pre overflow-x-auto flex-1 font-mono text-on-dark">
            {state.sql}
          </code>
        </div>
      </pre>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-muted"
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
      className={`h-3 w-3 shrink-0 text-muted transition-transform ${
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
