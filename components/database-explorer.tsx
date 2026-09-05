"use client";

import { useState } from "react";

interface ServerInfo {
  host: string;
  port: number;
  user: string;
  version: string;
}

export function DatabaseExplorer() {
  // Connection Configuration
  const [connectMode, setConnectMode] = useState<"params" | "uri">("params");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("3306");
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [connectionString, setConnectionString] = useState("");

  // Connection & Data State
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);

  // Explorer UI State
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedDb, setCopiedDb] = useState<string | null>(null);

  const handleConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setConnectError(null);
    setIsConnecting(true);

    try {
      const payload =
        connectMode === "uri"
          ? {
              mode: "uri",
              connectionString: connectionString.trim(),
            }
          : {
              mode: "params",
              host: host.trim(),
              port: port.trim() ? parseInt(port.trim(), 10) : 3306,
              user: user.trim(),
              password,
            };

      const res = await fetch("/api/mysql/databases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to connect to MySQL server.");
      }

      setDatabases(data.databases || []);
      setServerInfo(data.serverInfo || null);
      setIsConnected(true);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while connecting.";
      setConnectError(message);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setDatabases([]);
    setServerInfo(null);
    setSearchQuery("");
    setConnectError(null);
  };

  const handleClear = () => {
    if (connectMode === "params") {
      setHost("localhost");
      setPort("3306");
      setUser("root");
      setPassword("");
    } else {
      setConnectionString("");
    }
    setConnectError(null);
  };

  const copyToClipboard = async (dbName: string) => {
    try {
      await navigator.clipboard.writeText(dbName);
      setCopiedDb(dbName);
      setTimeout(() => {
        setCopiedDb((prev) => (prev === dbName ? null : prev));
      }, 2000);
    } catch {
      // Fallback if clipboard API is unavailable
    }
  };

  const filteredDatabases = databases.filter((db) =>
    db.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Top Section / Card */}
      {!isConnected ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-zinc-100 pb-5">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">
                Connect to MySQL Server
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Connect via 4 individual parameters or paste a single connection string.
              </p>
            </div>

            {/* Mode Selector Tabs */}
            <div className="flex rounded-xl bg-zinc-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setConnectMode("params");
                  setConnectError(null);
                }}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                  connectMode === "params"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                4 Server Fields
              </button>
              <button
                type="button"
                onClick={() => {
                  setConnectMode("uri");
                  setConnectError(null);
                }}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                  connectMode === "uri"
                    ? "bg-white text-zinc-900 shadow-sm"
                    : "text-zinc-600 hover:text-zinc-900"
                }`}
              >
                Connection String
              </button>
            </div>
          </div>

          {/* Error Message */}
          {connectError && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-800">
              <svg
                className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="flex-1">
                <p className="font-semibold">Connection Failed</p>
                <p className="mt-0.5 text-xs leading-relaxed opacity-90">{connectError}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleConnect} className="space-y-4">
            {connectMode === "params" ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Server Path / Host */}
                <div className="sm:col-span-2 md:col-span-1">
                  <label
                    htmlFor="mysql-host"
                    className="block text-xs font-semibold uppercase tracking-wider text-zinc-700"
                  >
                    Server Path / Host <span className="text-rose-500">*</span>
                  </label>
                  <div className="mt-1.5">
                    <input
                      id="mysql-host"
                      type="text"
                      required
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="localhost or 127.0.0.1"
                      className="block w-full rounded-xl border border-zinc-300 bg-zinc-50/50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-900"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-400">Hostname, domain, or IP address</p>
                </div>

                {/* Server Port */}
                <div className="sm:col-span-2 md:col-span-1">
                  <label
                    htmlFor="mysql-port"
                    className="block text-xs font-semibold uppercase tracking-wider text-zinc-700"
                  >
                    Server Port
                  </label>
                  <div className="mt-1.5">
                    <input
                      id="mysql-port"
                      type="number"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      placeholder="3306"
                      className="block w-full rounded-xl border border-zinc-300 bg-zinc-50/50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-900"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-400">Default MySQL port is 3306</p>
                </div>

                {/* Username */}
                <div>
                  <label
                    htmlFor="mysql-user"
                    className="block text-xs font-semibold uppercase tracking-wider text-zinc-700"
                  >
                    Username <span className="text-rose-500">*</span>
                  </label>
                  <div className="mt-1.5">
                    <input
                      id="mysql-user"
                      type="text"
                      required
                      value={user}
                      onChange={(e) => setUser(e.target.value)}
                      placeholder="root"
                      className="block w-full rounded-xl border border-zinc-300 bg-zinc-50/50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-900"
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="mysql-password"
                      className="block text-xs font-semibold uppercase tracking-wider text-zinc-700"
                    >
                      Password
                    </label>
                  </div>
                  <div className="relative mt-1.5">
                    <input
                      id="mysql-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Server password"
                      className="block w-full rounded-xl border border-zinc-300 bg-zinc-50/50 px-3.5 py-2.5 pr-10 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-zinc-400 hover:text-zinc-600"
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
              </div>
            ) : (
              <div>
                <label
                  htmlFor="mysql-uri"
                  className="block text-xs font-semibold uppercase tracking-wider text-zinc-700"
                >
                  MySQL Connection String <span className="text-rose-500">*</span>
                </label>
                <div className="mt-1.5">
                  <input
                    id="mysql-uri"
                    type="text"
                    required
                    value={connectionString}
                    onChange={(e) => setConnectionString(e.target.value)}
                    placeholder="mysql://user:password@localhost:3306"
                    className="block w-full rounded-xl border border-zinc-300 bg-zinc-50/50 px-3.5 py-2.5 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-900"
                  />
                </div>
                <p className="mt-1.5 text-xs text-zinc-500">
                  Format: <code className="font-mono text-zinc-700">mysql://username:password@host:port/database</code> (database name is optional)
                </p>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-4 border-t border-zinc-100">
              <button
                type="button"
                onClick={handleClear}
                disabled={isConnecting}
                className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-2"
              >
                Clear
              </button>
              <button
                type="submit"
                disabled={isConnecting}
                className="flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:opacity-60"
              >
                {isConnecting ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Connecting & Fetching Databases...</span>
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>Connect & List Databases</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      ) : (
        /* Connected View */
        <div className="space-y-6">
          {/* Server Connection Banner */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
            <div className="flex items-start md:items-center gap-3.5">
              <div className="relative mt-1 md:mt-0 flex h-3 w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-zinc-900">
                    Connected to {serverInfo?.host}:{serverInfo?.port}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                    Active
                  </span>
                  {serverInfo?.version && serverInfo.version !== "Unknown" && (
                    <span className="inline-flex items-center rounded-full bg-zinc-200/70 px-2 py-0.5 text-xs font-mono text-zinc-700">
                      v{serverInfo.version}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-600">
                  Logged in as user: <span className="font-mono font-medium text-zinc-900">{serverInfo?.user}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleConnect()}
                disabled={isConnecting}
                className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50"
              >
                <svg className={`h-3.5 w-3.5 ${isConnecting ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3.5 py-2 text-xs font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Disconnect</span>
              </button>
            </div>
          </div>

          {/* Databases Header & Filters */}
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between pb-5 border-b border-zinc-100">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-900">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-900">
                    Databases on Server
                  </h3>
                  <p className="text-xs text-zinc-500">
                    Total {databases.length} user database{databases.length === 1 ? "" : "s"} discovered
                  </p>
                </div>
              </div>
            </div>

            {/* Search Box */}
            <div className="mt-4">
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-400">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter databases by name..."
                  className="block w-full rounded-xl border border-zinc-300 bg-zinc-50/50 py-2 pl-9 pr-8 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-zinc-900"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-zinc-400 hover:text-zinc-600"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Database List / Grid */}
            <div className="mt-5">
              {filteredDatabases.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-200 py-12 text-center">
                  <svg
                    className="mx-auto h-8 w-8 text-zinc-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                  >
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                  <p className="mt-2 text-sm font-semibold text-zinc-900">
                    No databases found
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {searchQuery
                      ? `No databases match "${searchQuery}".`
                      : "No user databases found on this MySQL server. (System databases are excluded)"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredDatabases.map((dbName) => {
                    const isCopied = copiedDb === dbName;

                    return (
                      <div
                        key={dbName}
                        className="group flex items-center justify-between rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3.5 transition hover:border-zinc-400 hover:bg-white hover:shadow-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                              <ellipse cx="12" cy="5" rx="9" ry="3" />
                              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-mono text-sm font-semibold text-zinc-900" title={dbName}>
                              {dbName}
                            </p>
                          </div>
                        </div>

                        {/* Copy button */}
                        <button
                          type="button"
                          onClick={() => copyToClipboard(dbName)}
                          title="Copy database name"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-zinc-400 transition hover:border-zinc-300 hover:bg-white hover:text-zinc-700"
                        >
                          {isCopied ? (
                            <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                            </svg>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
