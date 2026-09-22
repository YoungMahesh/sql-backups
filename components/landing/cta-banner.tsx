"use client";

import Link from "next/link";

interface CtaBannerProps {
  sessionUser?: {
    name?: string | null;
    email?: string | null;
  } | null;
}

export function CtaBanner({ sessionUser }: CtaBannerProps) {
  const targetHref = sessionUser ? "/dashboard" : "/login";
  const buttonLabel = sessionUser ? "Open Application Workspace" : "Start Backing Up Now";

  return (
    <section className="bg-canvas py-12 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-2xl bg-primary px-6 py-12 text-center text-on-primary sm:px-12 sm:py-16 shadow-md">
          {/* Subtle Background Accent Pattern */}
          <div className="pointer-events-none absolute inset-0 opacity-10">
            <svg className="h-full w-full" fill="none" viewBox="0 0 400 400">
              <defs>
                <pattern id="cta-dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="2" cy="2" r="1.5" fill="currentColor" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#cta-dots)" />
            </svg>
          </div>

          <div className="relative mx-auto max-w-2xl">
            <h2 className="font-serif text-3xl font-normal tracking-tight sm:text-4xl lg:text-5xl">
              Protect your production databases with confidence
            </h2>
            <p className="mt-4 text-sm text-on-primary/90 leading-relaxed sm:text-base">
              Connect PostgreSQL, MySQL, or remote SQLite instances in seconds. Schedule automated backups with companion manifest inspection and zero local disk overhead.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link
                href={targetHref}
                className="flex items-center gap-2 rounded-md bg-canvas px-6 py-3 text-sm font-medium text-ink shadow-xs transition hover:bg-surface-soft active:opacity-90"
              >
                <span>{buttonLabel}</span>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
