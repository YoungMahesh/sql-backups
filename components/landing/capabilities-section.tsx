"use client";

export function CapabilitiesSection() {
  const capabilities = [
    {
      title: "In-Process Streaming Pipeline",
      description:
        "Extracts database records in batched cursor streams and pipes them on-the-fly through Gzip compression directly into object storage. No temporary dump files touch server disks.",
      icon: (
        <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
      pill: "Zero Disk Footprint",
    },
    {
      title: "S3 & SeaweedFS Compatible",
      description:
        "Engineered on standard S3 multi-part upload protocols. Fully interoperable with self-hosted SeaweedFS, AWS S3, Cloudflare R2, and MinIO storage backends.",
      icon: (
        <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
        </svg>
      ),
      pill: "Object Storage Native",
    },
    {
      title: "Companion Backup Manifests",
      description:
        "Every backup captures a companion .manifest.json recording table names, row counts, and uncompressed byte size. Explore tables and inspect schema instantly without downloading huge archives.",
      icon: (
        <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      pill: "Instant Content Inspection",
    },
    {
      title: "Timezone-Aware Cron Scheduling",
      description:
        "Configure automated recurring backup jobs with standard cron syntax and arbitrary IANA timezones. Automated background runners execute jobs and enforce retention pruning policies.",
      icon: (
        <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      pill: "Automated Retention Pruning",
    },
  ];

  return (
    <section id="capabilities" className="border-t border-hairline bg-surface-soft py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            Platform Capabilities
          </span>
          <h2 className="mt-2 font-serif text-3xl font-normal tracking-tight text-ink sm:text-4xl">
            Engineered for reliability, speed, and deep inspection
          </h2>
          <p className="mt-3 text-base text-body">
            SQL Backups combines streaming database extractors with sidecar manifests to make enterprise-grade database protection simple and fast.
          </p>
        </div>

        {/* 4-Up Grid */}
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:gap-8">
          {capabilities.map((item) => (
            <div
              key={item.title}
              className="flex flex-col justify-between rounded-xl border border-hairline bg-canvas p-6 shadow-2xs transition hover:border-primary/40 sm:p-8"
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-card text-primary">
                    {item.icon}
                  </div>
                  <span className="rounded-full border border-hairline bg-surface-card px-2.5 py-0.5 text-[11px] font-medium text-body">
                    {item.pill}
                  </span>
                </div>

                <h3 className="mt-6 font-serif text-xl font-normal tracking-tight text-ink">
                  {item.title}
                </h3>
                <p className="mt-2.5 text-sm text-body leading-relaxed">
                  {item.description}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-hairline/60 flex items-center gap-1.5 text-xs font-medium text-primary">
                <span>Verified in production</span>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
