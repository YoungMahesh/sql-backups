"use client";

export function ArchitectureSection() {
  return (
    <section id="architecture" className="border-t border-hairline bg-canvas py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Architecture Card in Developer Navy Chrome */}
        <div className="overflow-hidden rounded-2xl border border-hairline/20 bg-surface-dark text-on-dark p-8 sm:p-12 shadow-xl">
          <div className="max-w-2xl">
            <span className="text-xs font-mono font-semibold uppercase tracking-wider text-accent-teal">
              Security &amp; Pipeline Architecture
            </span>
            <h2 className="mt-2 font-serif text-3xl font-normal tracking-tight text-on-dark sm:text-4xl">
              Zero temporary disk footprint &amp; end-to-end encryption
            </h2>
            <p className="mt-3 text-sm text-on-dark-soft leading-relaxed sm:text-base">
              SQL Backups is engineered around a memory-bounded streaming architecture. Credentials are encrypted at rest with authenticated AES-256-GCM, and dump data streams directly into object storage.
            </p>
          </div>

          {/* Visual Pipeline Diagram */}
          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Step 1: Target Database */}
            <div className="rounded-xl border border-surface-dark-elevated bg-surface-dark-soft p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-accent-amber">01. SOURCE</span>
                <span className="h-2 w-2 rounded-full bg-accent-amber" />
              </div>
              <h3 className="mt-3 font-serif text-lg font-normal text-on-dark">
                Target Database
              </h3>
              <p className="mt-2 text-xs text-on-dark-soft leading-relaxed">
                Connects to Postgres, MySQL, or libSQL. Connection strings and passwords are encrypted with AES-256-GCM and masked in the UI.
              </p>
              <div className="mt-4 rounded bg-surface-dark-elevated p-2 font-mono text-[10px] text-accent-amber">
                AES-256-GCM Encrypted at Rest
              </div>
            </div>

            {/* Step 2: In-Process Streaming */}
            <div className="rounded-xl border border-surface-dark-elevated bg-surface-dark-soft p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-accent-teal">02. STREAMING</span>
                <span className="h-2 w-2 rounded-full bg-accent-teal" />
              </div>
              <h3 className="mt-3 font-serif text-lg font-normal text-on-dark">
                In-Process Gzip Pipeline
              </h3>
              <p className="mt-2 text-xs text-on-dark-soft leading-relaxed">
                Batched cursor rows are serialized into SQL DDL and INSERT statements, compressed on-the-fly, and uploaded without writing to server disk.
              </p>
              <div className="mt-4 rounded bg-surface-dark-elevated p-2 font-mono text-[10px] text-accent-teal">
                Backpressured Stream → S3
              </div>
            </div>

            {/* Step 3: S3 Storage & Manifest */}
            <div className="rounded-xl border border-surface-dark-elevated bg-surface-dark-soft p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-primary">03. ARTIFACTS</span>
                <span className="h-2 w-2 rounded-full bg-primary" />
              </div>
              <h3 className="mt-3 font-serif text-lg font-normal text-on-dark">
                S3 Storage &amp; Manifest
              </h3>
              <p className="mt-2 text-xs text-on-dark-soft leading-relaxed">
                Dual object upload stores the compressed .sql.gz dump alongside a companion .manifest.json metadata sidecar for instant inspection.
              </p>
              <div className="mt-4 rounded bg-surface-dark-elevated p-2 font-mono text-[10px] text-primary">
                .sql.gz + .manifest.json Sibling Keys
              </div>
            </div>
          </div>

          {/* Core Technical Invariants */}
          <div className="mt-10 border-t border-surface-dark-elevated pt-8">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 text-xs text-on-dark-soft">
              <div>
                <span className="block font-mono font-semibold text-on-dark">
                  Zero Temporary Files
                </span>
                <p className="mt-1">
                  Buffers stream directly through Node.js transforms, completely avoiding disk exhaustion on large production databases.
                </p>
              </div>
              <div>
                <span className="block font-mono font-semibold text-on-dark">
                  Strict Single-Light UI
                </span>
                <p className="mt-1">
                  Dark surfaces are reserved exclusively for developer code chrome, ensuring maximum contrast and legibility for complex SQL schemas.
                </p>
              </div>
              <div>
                <span className="block font-mono font-semibold text-on-dark">
                  Self-Contained &amp; Private
                </span>
                <p className="mt-1">
                  Your backups, schedules, and credentials remain strictly on your infrastructure with zero third-party telemetry.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
