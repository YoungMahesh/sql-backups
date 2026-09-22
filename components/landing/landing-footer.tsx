"use client";

import Link from "next/link";

export function LandingFooter() {
  return (
    <footer className="border-t border-surface-dark-elevated bg-surface-dark text-on-dark-soft py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Main 4-Column Footer Grid */}
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          {/* Col 1: Brand & Purpose */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-on-primary">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
              </div>
              <span className="font-serif text-lg font-normal tracking-tight text-on-dark">
                SQL Backups
              </span>
            </div>
            <p className="text-xs leading-relaxed text-on-dark-soft">
              In-process streaming backups with companion manifest inspection for PostgreSQL, MySQL, and remote libSQL SQLite databases.
            </p>
            <div className="pt-2">
              <span className="inline-flex items-center rounded-full border border-surface-dark-elevated bg-surface-dark-soft px-2.5 py-1 text-[10px] font-mono text-accent-teal">
                Single-Tenant • Self-Hosted
              </span>
            </div>
          </div>

          {/* Col 2: Supported Engines */}
          <div>
            <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-on-dark">
              Supported Engines
            </h4>
            <ul className="mt-4 space-y-2.5 text-xs">
              <li>
                <a href="#engines" className="transition hover:text-on-dark">
                  PostgreSQL 14 / 15 / 16
                </a>
              </li>
              <li>
                <a href="#engines" className="transition hover:text-on-dark">
                  MySQL 8.0+ &amp; MariaDB
                </a>
              </li>
              <li>
                <a href="#engines" className="transition hover:text-on-dark">
                  SQLite (Remote libSQL / Turso)
                </a>
              </li>
              <li>
                <a href="#engines" className="transition hover:text-on-dark">
                  S3-Compatible (SeaweedFS / AWS)
                </a>
              </li>
            </ul>
          </div>

          {/* Col 3: Platform Architecture */}
          <div>
            <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-on-dark">
              Architecture
            </h4>
            <ul className="mt-4 space-y-2.5 text-xs">
              <li>
                <a href="#capabilities" className="transition hover:text-on-dark">
                  In-Process Streaming Gzip
                </a>
              </li>
              <li>
                <a href="#capabilities" className="transition hover:text-on-dark">
                  Companion .manifest.json Sidecar
                </a>
              </li>
              <li>
                <a href="#capabilities" className="transition hover:text-on-dark">
                  Timezone-Aware Cron Scheduler
                </a>
              </li>
              <li>
                <a href="#architecture" className="transition hover:text-on-dark">
                  AES-256-GCM Credential Encryption
                </a>
              </li>
            </ul>
          </div>

          {/* Col 4: Workspace Links */}
          <div>
            <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-on-dark">
              Application
            </h4>
            <ul className="mt-4 space-y-2.5 text-xs">
              <li>
                <Link href="/dashboard" className="transition hover:text-on-dark">
                  Application Workspace
                </Link>
              </li>
              <li>
                <Link href="/login" className="transition hover:text-on-dark">
                  Sign In / Create Account
                </Link>
              </li>
              <li>
                <a href="#engines" className="transition hover:text-on-dark">
                  Target Database Explorer
                </a>
              </li>
              <li>
                <a href="#architecture" className="transition hover:text-on-dark">
                  Security Model
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 flex flex-col items-center justify-between border-t border-surface-dark-elevated pt-8 text-xs sm:flex-row gap-4">
          <p className="text-[11px] text-on-dark-soft">
            &copy; {new Date().getFullYear()} SQL Backups. Crafted with Claude Warm-Canvas Editorial Tokens.
          </p>
          <div className="flex items-center gap-4 text-[11px]">
            <span className="font-mono text-on-dark-soft">v0.1.0</span>
            <span className="text-surface-dark-elevated">&bull;</span>
            <span className="text-on-dark-soft">color-scheme: light</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
