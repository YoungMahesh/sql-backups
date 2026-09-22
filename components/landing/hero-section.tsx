"use client";

import Link from "next/link";
import { HeroCodeCard } from "./hero-code-card";

interface HeroSectionProps {
  sessionUser?: {
    name?: string | null;
    email?: string | null;
  } | null;
}

export function HeroSection({ sessionUser }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden pt-12 pb-16 md:pt-20 md:pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-8">
          {/* Left Column: Narrative & Action */}
          <div className="lg:col-span-6 space-y-6">
            {/* Top Category Badge */}
            <div className="inline-flex items-center gap-2 rounded-full border border-hairline bg-surface-card px-3 py-1 text-xs font-medium text-body">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>Multi-Engine Database Protection</span>
            </div>

            {/* Serif Display Headline */}
            <h1 className="font-serif text-4xl font-normal leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-6xl">
              Automated SQL Backups with Instant Schema Inspection
            </h1>

            {/* Lead Narrative */}
            <p className="text-base text-body leading-relaxed sm:text-lg">
              Connect PostgreSQL, MySQL, and remote SQLite databases. Stream compressed dumps directly to S3-compatible storage with automated companion manifests and zero local disk footprint.
            </p>

            {/* CTA Button Row */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {sessionUser ? (
                <Link
                  href="/dashboard"
                  className="flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-on-primary shadow-xs transition hover:bg-primary-active"
                >
                  <span>Open Application Workspace</span>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              ) : (
                <Link
                  href="/login"
                  className="flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-on-primary shadow-xs transition hover:bg-primary-active"
                >
                  <span>Start Backing Up</span>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              )}

              <a
                href="#engines"
                className="rounded-md border border-hairline bg-canvas px-4 py-3 text-sm font-medium text-ink transition hover:border-primary hover:text-primary hover:bg-surface-soft"
              >
                Explore Supported Engines
              </a>
            </div>

            {/* Architectural Trust Badges */}
            <div className="pt-4 border-t border-hairline">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted">
                <div className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>100% In-Process Streaming</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Companion JSON Manifests</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>S3 &amp; SeaweedFS Native</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Hero Code Artifact */}
          <div className="lg:col-span-6">
            <HeroCodeCard />
          </div>
        </div>
      </div>
    </section>
  );
}
