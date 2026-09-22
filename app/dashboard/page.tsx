"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { DatabaseExplorer } from "@/components/database-explorer";
import { BackupManager } from "@/components/backup-manager";
import { ScheduleManager } from "@/components/schedule-manager";

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending: isSessionLoading } = authClient.useSession();

  const [activeTab, setActiveTab] = useState<"explorer" | "backups" | "schedules">(
    "explorer"
  );
  const [backupsCount, setBackupsCount] = useState<number | null>(null);
  const [backupsRevision, setBackupsRevision] = useState(0);
  const [schedulesCount, setSchedulesCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Redirect unauthenticated visitors to the dedicated login page
  useEffect(() => {
    if (!isSessionLoading && !session?.user) {
      router.replace("/login");
    }
  }, [session, isSessionLoading, router]);

  useEffect(() => {
    if (!session?.user) return;
    let ignore = false;
    async function loadCount() {
      try {
        const res = await fetch("/api/mysql/backups");
        const data = await res.json();
        if (!ignore && res.ok && Array.isArray(data.backups)) {
          setBackupsCount(data.backups.length);
        }
      } catch {
        // Non-critical, ignore
      }
    }
    loadCount();
    return () => {
      ignore = true;
    };
  }, [session?.user]);

  const handleLogout = async () => {
    setLoading(true);
    try {
      await authClient.signOut();
      router.push("/login");
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  if (isSessionLoading || !session?.user) {
    return (
      <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-canvas px-4 text-ink">
        <div className="flex flex-col items-center justify-center gap-3 py-6">
          <svg
            className="h-8 w-8 animate-spin text-primary"
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
          <p className="text-sm font-medium text-muted">Opening workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col">
      {/* Top Navigation */}
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            {/* Brand Geometric Database Emblem */}
            <Link href="/" className="flex items-center gap-3 group">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-on-primary shadow-xs transition group-hover:bg-primary-active">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
              </div>
              <div className="flex items-center gap-2.5">
                <h1 className="font-serif text-xl font-normal tracking-tight text-ink sm:text-2xl">
                  SQL Backups
                </h1>
                <span className="hidden sm:inline-flex items-center rounded-full border border-hairline bg-surface-card px-2.5 py-0.5 text-xs font-medium text-body">
                  Workspace
                </span>
              </div>
            </Link>
          </div>

          {/* User Profile, Home link & Logout */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="hidden md:inline-flex items-center text-xs font-medium text-muted transition hover:text-ink"
            >
              Public Overview
            </Link>

            <div className="hidden sm:flex items-center gap-2.5 rounded-full border border-hairline bg-surface-card py-1 pl-1.5 pr-3.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-medium text-canvas">
                {session.user.name
                  ? session.user.name.slice(0, 2).toUpperCase()
                  : session.user.email?.slice(0, 2).toUpperCase() || "U"}
              </div>
              <span className="max-w-[150px] truncate text-xs font-medium text-body">
                {session.user.name || session.user.email}
              </span>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-md border border-hairline bg-canvas px-3 py-1.5 text-xs font-medium text-body transition hover:border-primary hover:text-primary hover:bg-surface-soft disabled:opacity-50"
            >
              {loading ? (
                <svg className="h-3.5 w-3.5 animate-spin text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              )}
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Dashboard Main Workspace */}
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 flex-1">
        {/* Top-Level Navigation Tabs */}
        <div className="mb-6 flex items-center justify-between border-b border-hairline pb-3">
          <div className="flex gap-1.5 rounded-xl border border-hairline bg-surface-card p-1">
            <button
              type="button"
              onClick={() => setActiveTab("explorer")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                activeTab === "explorer"
                  ? "bg-canvas text-ink border border-hairline shadow-xs font-semibold"
                  : "text-muted hover:text-ink"
              }`}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
              <span>Database Explorer</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("backups")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                activeTab === "backups"
                  ? "bg-canvas text-ink border border-hairline shadow-xs font-semibold"
                  : "text-muted hover:text-ink"
              }`}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
                />
              </svg>
              <span>Backups</span>
              {backupsCount !== null && (
                <span className="inline-flex items-center rounded-full bg-surface-cream-strong px-2 py-0.5 text-[10px] font-semibold text-body-strong">
                  {backupsCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("schedules")}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                activeTab === "schedules"
                  ? "bg-canvas text-ink border border-hairline shadow-xs font-semibold"
                  : "text-muted hover:text-ink"
              }`}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
              </svg>
              <span>Schedules</span>
              {schedulesCount !== null && (
                <span className="inline-flex items-center rounded-full bg-surface-cream-strong px-2 py-0.5 text-[10px] font-semibold text-body-strong">
                  {schedulesCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <div className={activeTab === "explorer" ? "block" : "hidden"}>
          <DatabaseExplorer
            onBackupCreated={() => {
              setBackupsCount((prev) => (prev !== null ? prev + 1 : 1));
              setBackupsRevision((prev) => prev + 1);
            }}
          />
        </div>

        <div className={activeTab === "backups" ? "block" : "hidden"}>
          <BackupManager
            refreshTrigger={backupsRevision}
            onBackupDeleted={() => {
              setBackupsCount((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
            }}
            onBackupsLoaded={setBackupsCount}
          />
        </div>

        <div className={activeTab === "schedules" ? "block" : "hidden"}>
          <ScheduleManager onSchedulesLoaded={setSchedulesCount} />
        </div>
      </main>
    </div>
  );
}
