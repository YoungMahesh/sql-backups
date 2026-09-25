"use client";

import { useEffect } from "react";
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

interface InspectDrawerProps {
  backup: InspectDrawerBackup | null;
  manifestState: ManifestViewState;
  onRetry: () => void;
  onClose: () => void;
}

export function InspectDrawer({
  backup,
  manifestState,
  onRetry,
  onClose,
}: InspectDrawerProps) {
  const open = backup !== null;

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
        {/* Drawer Header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            {/* Back arrow: only visible on <sm where the drawer is full-screen */}
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
          {/* X close: visible on >=sm */}
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

        {/* Tab bar (Tables only for ticket 03; Raw is added in ticket 05) */}
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

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <TablesTab state={manifestState} onRetry={onRetry} />
        </div>
      </div>
    </div>
  );
}

interface TablesTabProps {
  state: ManifestViewState;
  onRetry: () => void;
}

function TablesTab({ state, onRetry }: TablesTabProps) {
  if (state.kind === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-xs text-zinc-500">
        <svg
          className="h-4 w-4 animate-spin text-zinc-400"
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
        <span>Loading tables...</span>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
        <p className="font-semibold">{state.message}</p>
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
      {tables.map((table) => (
        <li
          key={table.name}
          className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200/80 bg-zinc-50/40 px-3 py-2.5"
        >
          <span className="truncate font-mono text-xs font-semibold text-zinc-900">
            {table.name}
          </span>
          <span
            className={`shrink-0 text-[11px] font-medium ${
              table.rowCount === 0 ? "text-zinc-400" : "text-zinc-600"
            }`}
          >
            {formatRowCount(table.rowCount)}
          </span>
        </li>
      ))}
    </ul>
  );
}
