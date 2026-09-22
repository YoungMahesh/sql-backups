"use client";

import { useState, useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { DatabaseExplorer } from "@/components/database-explorer";
import { BackupManager } from "@/components/backup-manager";
import { ScheduleManager } from "@/components/schedule-manager";

export default function Home() {
  const { data: session, isPending: isSessionLoading } = authClient.useSession();

  const [activeTab, setActiveTab] = useState<"explorer" | "backups" | "schedules">(
    "explorer"
  );
  const [backupsCount, setBackupsCount] = useState<number | null>(null);
  const [backupsRevision, setBackupsRevision] = useState(0);
  const [schedulesCount, setSchedulesCount] = useState<number | null>(null);

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setError(null);
    setSuccessMessage(null);
  };

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

  const handleModeSwitch = (newMode: "login" | "signup") => {
    resetForm();
    setMode(newMode);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!email || !password) {
      setError("Please fill in both email and password.");
      return;
    }

    setLoading(true);
    try {
      const { error: signInError } = await authClient.signIn.email({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message || "Failed to sign in. Please check your credentials.");
      } else {
        setSuccessMessage("Logged in successfully!");
        resetForm();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }

    if (!email || !password) {
      setError("Please fill in all required fields.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setLoading(true);
    try {
      const { error: signUpError } = await authClient.signUp.email({
        email,
        password,
        name: name.trim(),
      });

      if (signUpError) {
        setError(signUpError.message || "Failed to create account. Please try again.");
      } else {
        setSuccessMessage("Account created successfully!");
        resetForm();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setError(null);
    setLoading(true);
    try {
      await authClient.signOut();
      resetForm();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to log out.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (isSessionLoading) {
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
          <p className="text-sm font-medium text-muted">
            Checking session...
          </p>
        </div>
      </div>
    );
  }

  // Authenticated View
  if (session?.user) {
    return (
      <div className="min-h-screen bg-canvas text-ink flex flex-col">
        {/* Top Navigation */}
        <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/90 backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
            <div className="flex items-center gap-3">
              {/* Brand Geometric Database Emblem */}
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-on-primary shadow-xs">
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
                  Database Backups
                </span>
              </div>
            </div>

            {/* User Profile & Logout */}
            <div className="flex items-center gap-3">
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
            <ScheduleManager
              onSchedulesLoaded={setSchedulesCount}
            />
          </div>
        </main>
      </div>
    );
  }

  // Guest / Unauthenticated View
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center bg-canvas px-4 py-12 text-ink">
      <div className="w-full max-w-md">
        {/* Header Branding */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-on-primary shadow-xs">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
            </svg>
          </div>
          <h1 className="font-serif text-3xl font-normal tracking-tight text-ink sm:text-4xl">
            {mode === "login" ? "Welcome to SQL Backups" : "Create an Account"}
          </h1>
          <p className="mt-2 text-sm text-body">
            {mode === "login"
              ? "Sign in to manage and automate your database backups"
              : "Sign up to start connecting and managing your databases"}
          </p>
        </div>

        {/* Auth Form Card (Sign In / Sign Up) */}
        <div className="rounded-xl border border-hairline bg-surface-card p-6 shadow-2xs sm:p-8">
          {/* Mode Switcher Tabs */}
          <div className="mb-6 flex rounded-lg border border-hairline bg-surface-soft p-1">
            <button
              type="button"
              onClick={() => handleModeSwitch("login")}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                mode === "login"
                  ? "bg-canvas text-ink border border-hairline shadow-xs font-semibold"
                  : "text-muted hover:text-ink"
              }`}
            >
              Log In
            </button>
            <button
              type="button"
              onClick={() => handleModeSwitch("signup")}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
                mode === "signup"
                  ? "bg-canvas text-ink border border-hairline shadow-xs font-semibold"
                  : "text-muted hover:text-ink"
              }`}
            >
              Sign Up
            </button>
          </div>

          {/* Error Message Alert */}
          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-error/20 bg-error/10 p-3 text-sm text-error">
              <svg
                className="mt-0.5 h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Success Message Alert */}
          {successMessage && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-success/20 bg-success/10 p-3 text-sm text-success">
              <svg
                className="mt-0.5 h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{successMessage}</span>
            </div>
          )}

          {/* Login Form */}
          {mode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label
                  htmlFor="login-email"
                  className="block text-sm font-medium text-body"
                >
                  Email Address
                </label>
                <div className="mt-1.5">
                  <input
                    id="login-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="block w-full rounded-md border border-hairline bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="login-password"
                    className="block text-sm font-medium text-body"
                  >
                    Password
                  </label>
                </div>
                <div className="relative mt-1.5">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="block w-full rounded-md border border-hairline bg-canvas px-3.5 py-2.5 pr-10 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted hover:text-ink"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-on-primary shadow-xs transition hover:bg-primary-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin"
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
                    <span>Signing In...</span>
                  </>
                ) : (
                  "Sign In"
                )}
              </button>

              <p className="pt-2 text-center text-xs text-muted">
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => handleModeSwitch("signup")}
                  className="font-medium text-primary hover:text-primary-active underline underline-offset-4"
                >
                  Sign up now
                </button>
              </p>
            </form>
          ) : (
            /* Sign Up Form */
            <form onSubmit={handleSignUp} className="space-y-4">
              <div>
                <label
                  htmlFor="signup-name"
                  className="block text-sm font-medium text-body"
                >
                  Full Name
                </label>
                <div className="mt-1.5">
                  <input
                    id="signup-name"
                    type="text"
                    required
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Doe"
                    className="block w-full rounded-md border border-hairline bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="signup-email"
                  className="block text-sm font-medium text-body"
                >
                  Email Address
                </label>
                <div className="mt-1.5">
                  <input
                    id="signup-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="block w-full rounded-md border border-hairline bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="signup-password"
                  className="block text-sm font-medium text-body"
                >
                  Password
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="signup-password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    className="block w-full rounded-md border border-hairline bg-canvas px-3.5 py-2.5 pr-10 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted hover:text-ink"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-on-primary shadow-xs transition hover:bg-primary-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin"
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
                    <span>Creating Account...</span>
                  </>
                ) : (
                  "Create Account"
                )}
              </button>

              <p className="pt-2 text-center text-xs text-muted">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => handleModeSwitch("login")}
                  className="font-medium text-primary hover:text-primary-active underline underline-offset-4"
                >
                  Log in
                </button>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
