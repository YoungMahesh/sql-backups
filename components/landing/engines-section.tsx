"use client";

import Link from "next/link";

interface EnginesSectionProps {
  sessionUser?: {
    name?: string | null;
    email?: string | null;
  } | null;
}

export function EnginesSection({ sessionUser }: EnginesSectionProps) {
  const targetHref = sessionUser ? "/dashboard" : "/login";

  return (
    <section id="engines" className="border-t border-hairline bg-canvas py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section Header */}
        <div className="max-w-2xl">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Target Database Engines
          </span>
          <h2 className="mt-2 font-serif text-3xl font-normal tracking-tight text-ink sm:text-4xl">
            Engineered for dialect precision across modern SQL targets
          </h2>
          <p className="mt-3 text-base text-body">
            Every database engine has its own schema catalogs, sequence semantics, and connection protocols. SQL Backups implements dedicated exporters designed to maintain strict schema parity.
          </p>
        </div>

        {/* 3-Column Engine Matrix */}
        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
          {/* PostgreSQL Card */}
          <div className="flex flex-col justify-between rounded-xl border border-hairline bg-surface-card p-6 shadow-2xs sm:p-7">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-canvas">
                  <span className="font-mono text-xs font-bold">PG</span>
                </div>
                <span className="rounded-full border border-hairline bg-canvas px-2.5 py-0.5 font-mono text-xs font-medium text-accent-teal">
                  postgres://
                </span>
              </div>

              <h3 className="mt-5 font-serif text-xl font-normal tracking-tight text-ink">
                PostgreSQL
              </h3>
              <p className="mt-2 text-sm text-body leading-relaxed">
                Connects directly to remote PostgreSQL instances. Reconstructs schema DDL, table constraints, identity columns, and sequence owners while streaming batched INSERT statements.
              </p>

              {/* Engine Technical Specifications */}
              <ul className="mt-5 space-y-2 border-t border-hairline/60 pt-4 text-xs text-body">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" />
                  <span>Sequences &amp; identity column tracking</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" />
                  <span>SSL encryption mode support</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-teal" />
                  <span>Streams plain SQL through Gzip</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-4 border-t border-hairline/60">
              <div className="rounded-md bg-canvas p-2.5 border border-hairline mb-4">
                <span className="block font-mono text-[11px] text-muted truncate">
                  postgres://user:••••@host:5432/dbname
                </span>
              </div>
              <Link
                href={targetHref}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-hairline bg-canvas py-2 text-xs font-medium text-ink transition hover:border-primary hover:text-primary hover:bg-surface-soft"
              >
                <span>Connect PostgreSQL</span>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>

          {/* MySQL Card */}
          <div className="flex flex-col justify-between rounded-xl border border-hairline bg-surface-card p-6 shadow-2xs sm:p-7">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-canvas">
                  <span className="font-mono text-xs font-bold">MY</span>
                </div>
                <span className="rounded-full border border-hairline bg-canvas px-2.5 py-0.5 font-mono text-xs font-medium text-primary">
                  mysql://
                </span>
              </div>

              <h3 className="mt-5 font-serif text-xl font-normal tracking-tight text-ink">
                MySQL
              </h3>
              <p className="mt-2 text-sm text-body leading-relaxed">
                Connects through managed connection pools. Performs transactional table locks, extracts auto-increment counters, and streams multi-row batched insert statements.
              </p>

              {/* Engine Technical Specifications */}
              <ul className="mt-5 space-y-2 border-t border-hairline/60 pt-4 text-xs text-body">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>Transactional table write locks</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>Preserves utf8mb4 collation &amp; character sets</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <span>Auto-increment primary key preservation</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-4 border-t border-hairline/60">
              <div className="rounded-md bg-canvas p-2.5 border border-hairline mb-4">
                <span className="block font-mono text-[11px] text-muted truncate">
                  mysql://user:••••@host:3306/dbname
                </span>
              </div>
              <Link
                href={targetHref}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-hairline bg-canvas py-2 text-xs font-medium text-ink transition hover:border-primary hover:text-primary hover:bg-surface-soft"
              >
                <span>Connect MySQL</span>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>

          {/* SQLite / libSQL Card */}
          <div className="flex flex-col justify-between rounded-xl border border-hairline bg-surface-card p-6 shadow-2xs sm:p-7">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-canvas">
                  <span className="font-mono text-xs font-bold">SQLITE</span>
                </div>
                <span className="rounded-full border border-hairline bg-canvas px-2.5 py-0.5 font-mono text-xs font-medium text-accent-amber">
                  libsql://
                </span>
              </div>

              <h3 className="mt-5 font-serif text-xl font-normal tracking-tight text-ink">
                SQLite / libSQL (Turso)
              </h3>
              <p className="mt-2 text-sm text-body leading-relaxed">
                Connects to remote libSQL and Turso SQLite instances. Reconstructs schema DDL from sqlite_schema, preserves sqlite_sequence autoincrements, and encodes hex blobs.
              </p>

              {/* Engine Technical Specifications */}
              <ul className="mt-5 space-y-2 border-t border-hairline/60 pt-4 text-xs text-body">
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-amber" />
                  <span>DDL reconstruction from sqlite_schema</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-amber" />
                  <span>Sequence capture via sqlite_sequence</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-amber" />
                  <span>Typed serialization (hex blobs, bigints, JSON)</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-4 border-t border-hairline/60">
              <div className="rounded-md bg-canvas p-2.5 border border-hairline mb-4">
                <span className="block font-mono text-[11px] text-muted truncate">
                  libsql://your-db.turso.io?authToken=••••
                </span>
              </div>
              <Link
                href={targetHref}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-hairline bg-canvas py-2 text-xs font-medium text-ink transition hover:border-primary hover:text-primary hover:bg-surface-soft"
              >
                <span>Connect SQLite</span>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
