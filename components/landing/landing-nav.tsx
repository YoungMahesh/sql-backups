"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

interface LandingNavProps {
  sessionUser?: {
    name?: string | null;
    email?: string | null;
  } | null;
  isSessionLoading?: boolean;
}

export function LandingNav({ sessionUser, isSessionLoading }: LandingNavProps) {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await authClient.signOut();
      router.refresh();
    } catch {
      // ignore
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Brand Emblem & Wordmark */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-on-primary shadow-xs transition group-hover:bg-primary-active">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-serif text-xl font-normal tracking-tight text-ink sm:text-2xl">
              SQL Backups
            </span>
            <span className="hidden sm:inline-flex items-center rounded-full border border-hairline bg-surface-card px-2 py-0.5 text-[11px] font-medium text-body">
              Multi-Engine
            </span>
          </div>
        </Link>

        {/* Desktop Anchor Navigation */}
        <nav className="hidden md:flex items-center gap-8">
          <a
            href="#engines"
            className="text-sm font-medium text-body transition hover:text-primary"
          >
            Supported Engines
          </a>
          <a
            href="#capabilities"
            className="text-sm font-medium text-body transition hover:text-primary"
          >
            Capabilities
          </a>
          <a
            href="#architecture"
            className="text-sm font-medium text-body transition hover:text-primary"
          >
            Architecture
          </a>
        </nav>

        {/* Action Controls Cluster */}
        <div className="flex items-center gap-3">
          {isSessionLoading ? (
            <div className="h-8 w-20 animate-pulse rounded-md bg-surface-card" />
          ) : sessionUser ? (
            /* Authenticated cluster */
            <div className="flex items-center gap-2.5">
              <div className="hidden sm:flex items-center gap-2 rounded-full border border-hairline bg-surface-card py-1 pl-1.5 pr-3">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] font-medium text-canvas">
                  {sessionUser.name
                    ? sessionUser.name.slice(0, 2).toUpperCase()
                    : sessionUser.email?.slice(0, 2).toUpperCase() || "U"}
                </div>
                <span className="max-w-[120px] truncate text-xs font-medium text-body">
                  {sessionUser.name || sessionUser.email}
                </span>
              </div>

              <Link
                href="/dashboard"
                className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-medium text-on-primary shadow-xs transition hover:bg-primary-active"
              >
                <span>Go to Dashboard</span>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>

              <button
                type="button"
                onClick={handleLogout}
                className="hidden sm:inline-flex items-center rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-xs font-medium text-muted transition hover:border-primary hover:text-primary"
              >
                Log Out
              </button>
            </div>
          ) : (
            /* Guest cluster */
            <div className="flex items-center gap-2.5">
              <Link
                href="/login"
                className="rounded-md border border-hairline bg-canvas px-3.5 py-1.5 text-xs font-medium text-body transition hover:border-primary hover:text-primary hover:bg-surface-soft"
              >
                Sign In
              </Link>
              <Link
                href="/login"
                className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-medium text-on-primary shadow-xs transition hover:bg-primary-active"
              >
                <span>Start Backing Up</span>
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
