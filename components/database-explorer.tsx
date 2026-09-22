"use client";

import { useState, useEffect, useCallback } from "react";
import { ScheduleForm, type SavedConnectionOption } from "./schedule-form";
import { ConnectionSchedules } from "./connection-schedules";

interface ServerInfo {
  host: string;
  port: number;
  user: string;
  version: string;
}

interface SavedConnectionItem {
  id: string;
  engine?: "mysql" | "postgres";
  host: string;
  port: number;
  username: string;
  database: string | null;
  maskedUri: string;
  updatedAt: string;
  createdAt: string;
}

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

interface ActiveConnectionState {
  engine?: "mysql" | "postgres";
  mode: "params" | "uri" | "saved";
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  connectionString?: string;
  savedConnectionId?: string;
}

interface DatabaseExplorerProps {
  onBackupCreated?: () => void;
}

export function DatabaseExplorer({ onBackupCreated }: DatabaseExplorerProps = {}) {
  // Connection Configuration
  const [engine, setEngine] = useState<"mysql" | "postgres">("mysql");
  const [connectMode, setConnectMode] = useState<"params" | "uri">("params");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("3306");
  const [user, setUser] = useState("root");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [connectionString, setConnectionString] = useState("");

  // Connection & Data State
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [activeConnection, setActiveConnection] = useState<ActiveConnectionState | null>(null);

  // Backup State
  const [backingUpDb, setBackingUpDb] = useState<string | null>(null);
  const [backupSuccess, setBackupSuccess] = useState<{ dbName: string; message: string } | null>(null);
  const [backupError, setBackupError] = useState<{ dbName: string; message: string } | null>(null);

  // Schedule State
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleTargetDb, setScheduleTargetDb] = useState<string | null>(null);

  // Saved Connections State
  const [savedConnections, setSavedConnections] = useState<SavedConnectionItem[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [fillingId, setFillingId] = useState<string | null>(null);

  // Explorer UI State
  const [searchQuery, setSearchQuery] = useState("");

  const fetchSavedConnections = useCallback(async () => {
    setIsLoadingConnections(true);
    setConnectionsError(null);
    try {
      const res = await fetch("/api/mysql/connections");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load saved connections.");
      }
      setSavedConnections(data.connections || []);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load saved connections.";
      setConnectionsError(message);
    } finally {
      setIsLoadingConnections(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const res = await fetch("/api/mysql/connections");
        const data = await res.json();
        if (!ignore) {
          if (!res.ok) {
            setConnectionsError(data.error || "Failed to load saved connections.");
          } else {
            setSavedConnections(data.connections || []);
            setConnectionsError(null);
          }
        }
      } catch (err: unknown) {
        if (!ignore) {
          const message =
            err instanceof Error ? err.message : "Failed to load saved connections.";
          setConnectionsError(message);
        }
      } finally {
        if (!ignore) {
          setIsLoadingConnections(false);
        }
      }
    }

    load();

    return () => {
      ignore = true;
    };
  }, []);


  const handleConnectionSuccess = (data: {
    databases?: string[];
    serverInfo?: ServerInfo | null;
  }) => {
    setDatabases(data.databases || []);
    setServerInfo(data.serverInfo || null);
    setIsConnected(true);
    fetchSavedConnections();
  };

  const handleEngineChange = (newEngine: "mysql" | "postgres") => {
    if (newEngine === engine) return;
    setEngine(newEngine);
    setConnectError(null);
    setTestSuccess(null);

    if (newEngine === "postgres") {
      if (port === "3306" || !port) setPort("5432");
      if (user === "root" || !user) setUser("postgres");
      if (connectionString.startsWith("mysql://")) {
        setConnectionString("");
      }
    } else {
      if (port === "5432" || !port) setPort("3306");
      if (user === "postgres" || !user) setUser("root");
      if (
        connectionString.startsWith("postgresql://") ||
        connectionString.startsWith("postgres://")
      ) {
        setConnectionString("");
      }
    }
  };

  const handleTestConnection = async () => {
    setConnectError(null);
    setTestSuccess(null);
    setIsTesting(true);

    try {
      const defaultPort = engine === "postgres" ? 5432 : 3306;
      const payload =
        connectMode === "uri"
          ? {
              mode: "uri",
              connectionString: connectionString.trim(),
              testOnly: true,
            }
          : {
              mode: "params",
              host: host.trim(),
              port: port.trim() ? parseInt(port.trim(), 10) : defaultPort,
              user: user.trim(),
              password,
              testOnly: true,
            };

      const endpoint =
        engine === "postgres" ? "/api/postgres/databases" : "/api/mysql/databases";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Connection test failed.");
      }

      setTestSuccess(
        `Connection verified successfully! Reachable on ${data.serverInfo?.host}:${data.serverInfo?.port} (version: ${data.serverInfo?.version || "Unknown"})`
      );
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Connection test failed.";
      setConnectError(message);
    } finally {
      setIsTesting(false);
    }
  };

  const handleConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setConnectError(null);
    setTestSuccess(null);
    setIsConnecting(true);
    setConnectingId(null);

    try {
      const defaultPort = engine === "postgres" ? 5432 : 3306;
      const payload: ActiveConnectionState =
        connectMode === "uri"
          ? {
              engine,
              mode: "uri",
              connectionString: connectionString.trim(),
            }
          : {
              engine,
              mode: "params",
              host: host.trim(),
              port: port.trim() ? parseInt(port.trim(), 10) : defaultPort,
              user: user.trim(),
              password,
            };

      const endpoint =
        engine === "postgres" ? "/api/postgres/databases" : "/api/mysql/databases";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error ||
            `Failed to connect to ${engine === "postgres" ? "PostgreSQL" : "MySQL"} server.`
        );
      }

      setActiveConnection(payload);
      handleConnectionSuccess(data);
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

  const handleConnectSaved = async (id: string) => {
    setConnectError(null);
    setTestSuccess(null);
    setIsConnecting(true);
    setConnectingId(id);

    try {
      const savedConn = savedConnections.find((c) => c.id === id);
      const connEngine = savedConn?.engine || "mysql";
      const payload: ActiveConnectionState = {
        engine: connEngine,
        mode: "saved",
        savedConnectionId: id,
      };

      const endpoint =
        connEngine === "postgres" ? "/api/postgres/databases" : "/api/mysql/databases";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error ||
            `Failed to connect to ${connEngine === "postgres" ? "PostgreSQL" : "MySQL"} server.`
        );
      }

      setEngine(connEngine);
      setActiveConnection(payload);
      handleConnectionSuccess(data);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "An unexpected error occurred while connecting to saved connection.";
      setConnectError(message);
    } finally {
      setIsConnecting(false);
      setConnectingId(null);
    }
  };

  const handleFillConnection = async (id: string) => {
    setFillingId(id);
    setConnectError(null);
    setTestSuccess(null);
    try {
      const savedConn = savedConnections.find((c) => c.id === id);
      const connEngine = savedConn?.engine || "mysql";
      const endpoint =
        connEngine === "postgres"
          ? `/api/postgres/connections/${id}`
          : `/api/mysql/connections/${id}`;

      const res = await fetch(endpoint);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load connection details.");
      }

      const conn = data.connection;
      if (conn) {
        setEngine(connEngine);
        setConnectionString(conn.connectionString || "");
        setHost(conn.host || "localhost");
        setPort(String(conn.port || (connEngine === "postgres" ? 5432 : 3306)));
        setUser(conn.user || (connEngine === "postgres" ? "postgres" : "root"));
        setPassword(conn.password || "");

        // Scroll smoothly to top connection form
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load connection details.";
      setConnectError(message);
    } finally {
      setFillingId(null);
    }
  };

  const handleDeleteConnection = async (id: string) => {
    setDeletingId(id);
    try {
      const savedConn = savedConnections.find((c) => c.id === id);
      const connEngine = savedConn?.engine || "mysql";
      const endpoint =
        connEngine === "postgres"
          ? `/api/postgres/connections/${id}`
          : `/api/mysql/connections/${id}`;

      const res = await fetch(endpoint, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete connection.");
      }

      setSavedConnections((prev) => prev.filter((item) => item.id !== id));
      setConfirmDeleteId(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to delete connection.";
      setConnectError(message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleDisconnect = () => {
    setIsConnected(false);
    setActiveConnection(null);
    setDatabases([]);
    setServerInfo(null);
    setSearchQuery("");
    setConnectError(null);
    setTestSuccess(null);
    setBackupSuccess(null);
    setBackupError(null);
    fetchSavedConnections();
  };

  const handleClear = () => {
    if (connectMode === "params") {
      setHost("localhost");
      setPort(engine === "postgres" ? "5432" : "3306");
      setUser(engine === "postgres" ? "postgres" : "root");
      setPassword("");
    } else {
      setConnectionString("");
    }
    setConnectError(null);
    setTestSuccess(null);
  };

  const handleBackup = async (dbName: string) => {
    if (!activeConnection || backingUpDb) return;

    setBackingUpDb(dbName);
    setBackupSuccess(null);
    setBackupError(null);

    try {
      const endpoint =
        activeConnection.engine === "postgres"
          ? "/api/postgres/backups"
          : "/api/mysql/backups";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          databaseName: dbName,
          connection: activeConnection,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create database backup.");
      }

      setBackupSuccess({
        dbName,
        message: `Backup for "${dbName}" was successfully uploaded to S3!`,
      });
      onBackupCreated?.();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create database backup.";
      setBackupError({
        dbName,
        message,
      });
    } finally {
      setBackingUpDb(null);
    }
  };

  const filteredDatabases = databases.filter((db) =>
    db.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Disconnected View (Connection Form & Saved Connections) */}
      {!isConnected ? (
        <div className="space-y-6">
          {/* Connection Form Card */}
          <div className="rounded-xl border border-hairline bg-surface-card p-6 shadow-2xs sm:p-8">
            <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-hairline pb-5">
              <div>
                <h2 className="font-serif text-xl sm:text-2xl font-normal tracking-tight text-ink">
                  Connect to {engine === "postgres" ? "PostgreSQL" : "MySQL"} Server
                </h2>
                <p className="mt-1 text-sm text-muted">
                  Connect via 4 individual parameters or paste a single connection string.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Engine Selector Toggle */}
                <div className="flex rounded-lg border border-hairline bg-surface-soft p-1">
                  <button
                    type="button"
                    onClick={() => handleEngineChange("mysql")}
                    className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition ${
                      engine === "mysql"
                        ? "bg-canvas text-ink border border-hairline shadow-xs font-semibold"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    MySQL
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEngineChange("postgres")}
                    className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition ${
                      engine === "postgres"
                        ? "bg-canvas text-ink border border-hairline shadow-xs font-semibold"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    PostgreSQL
                  </button>
                </div>

                {/* Mode Selector Tabs */}
                <div className="flex rounded-lg border border-hairline bg-surface-soft p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setConnectMode("params");
                      setConnectError(null);
                      setTestSuccess(null);
                    }}
                    className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition ${
                      connectMode === "params"
                        ? "bg-canvas text-ink border border-hairline shadow-xs font-semibold"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    4 Server Fields
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConnectMode("uri");
                      setConnectError(null);
                      setTestSuccess(null);
                    }}
                    className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition ${
                      connectMode === "uri"
                        ? "bg-canvas text-ink border border-hairline shadow-xs font-semibold"
                        : "text-muted hover:text-ink"
                    }`}
                  >
                    Connection String
                  </button>
                </div>
              </div>
            </div>

            {/* Error Message */}
            {connectError && (
              <div className="mb-6 flex items-start gap-3 rounded-lg border border-error/20 bg-error/10 p-4 text-sm text-error">
                <svg
                  className="mt-0.5 h-5 w-5 shrink-0 text-error"
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

            {/* Test Connection Success Message */}
            {testSuccess && (
              <div className="mb-6 flex items-start gap-3 rounded-lg border border-success/30 bg-success/10 p-4 text-sm text-success">
                <svg
                  className="mt-0.5 h-5 w-5 shrink-0 text-success"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <div className="flex-1">
                  <p className="font-semibold">Connection Verified</p>
                  <p className="mt-0.5 text-xs leading-relaxed opacity-90">{testSuccess}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setTestSuccess(null)}
                  className="text-success hover:opacity-75 font-bold"
                >
                  ✕
                </button>
              </div>
            )}

            <form onSubmit={handleConnect} className="space-y-4">
              {connectMode === "params" ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {/* Server Path / Host */}
                  <div className="sm:col-span-2 md:col-span-1">
                    <label
                      htmlFor={`${engine}-host`}
                      className="block text-xs font-semibold uppercase tracking-wider text-body"
                    >
                      Server Path / Host <span className="text-primary">*</span>
                    </label>
                    <div className="mt-1.5">
                      <input
                        id={`${engine}-host`}
                        type="text"
                        required
                        value={host}
                        onChange={(e) => setHost(e.target.value)}
                        placeholder="localhost or 127.0.0.1"
                        className="block w-full rounded-md border border-hairline bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-soft">Hostname, domain, or IP address</p>
                  </div>

                  {/* Server Port */}
                  <div className="sm:col-span-2 md:col-span-1">
                    <label
                      htmlFor={`${engine}-port`}
                      className="block text-xs font-semibold uppercase tracking-wider text-body"
                    >
                      Server Port
                    </label>
                    <div className="mt-1.5">
                      <input
                        id={`${engine}-port`}
                        type="number"
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                        placeholder={engine === "postgres" ? "5432" : "3306"}
                        className="block w-full rounded-md border border-hairline bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-soft">
                      Default {engine === "postgres" ? "PostgreSQL port is 5432" : "MySQL port is 3306"}
                    </p>
                  </div>

                  {/* Username */}
                  <div>
                    <label
                      htmlFor={`${engine}-user`}
                      className="block text-xs font-semibold uppercase tracking-wider text-body"
                    >
                      Username <span className="text-primary">*</span>
                    </label>
                    <div className="mt-1.5">
                      <input
                        id={`${engine}-user`}
                        type="text"
                        required
                        value={user}
                        onChange={(e) => setUser(e.target.value)}
                        placeholder={engine === "postgres" ? "postgres" : "root"}
                        className="block w-full rounded-md border border-hairline bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div>
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`${engine}-password`}
                        className="block text-xs font-semibold uppercase tracking-wider text-body"
                      >
                        Password
                      </label>
                    </div>
                    <div className="relative mt-1.5">
                      <input
                        id={`${engine}-password`}
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Leave blank if no password"
                        className="block w-full rounded-md border border-hairline bg-canvas px-3.5 py-2.5 pr-10 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary/20"
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
                </div>
              ) : (
                /* Single Connection String */
                <div>
                  <label
                    htmlFor={`${engine}-connection-string`}
                    className="block text-xs font-semibold uppercase tracking-wider text-body"
                  >
                    {engine === "postgres" ? "PostgreSQL" : "MySQL"} Connection String <span className="text-primary">*</span>
                  </label>
                  <div className="mt-1.5">
                    <input
                      id={`${engine}-connection-string`}
                      type="text"
                      required
                      value={connectionString}
                      onChange={(e) => setConnectionString(e.target.value)}
                      placeholder={
                        engine === "postgres"
                          ? "postgresql://postgres:password@localhost:5432/database"
                          : "mysql://user:password@localhost:3306/database"
                      }
                      className="block w-full rounded-md border border-hairline bg-canvas px-3.5 py-2.5 font-mono text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted">
                    Format:{" "}
                    <code className="font-mono text-body">
                      {engine === "postgres"
                        ? "postgresql://username:password@host:port/database"
                        : "mysql://username:password@host:port/database"}
                    </code>{" "}
                    (database name is optional)
                  </p>
                </div>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 pt-4 border-t border-hairline">
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={isConnecting || isTesting}
                  className="rounded-md border border-hairline bg-canvas px-4 py-2 text-sm font-medium text-body transition hover:bg-surface-soft hover:text-ink focus-visible:outline-2"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={isConnecting || isTesting}
                  className="flex items-center justify-center gap-2 rounded-md border border-hairline bg-canvas px-4 py-2 text-sm font-medium text-ink shadow-xs transition hover:bg-surface-soft focus-visible:outline-2 disabled:opacity-60"
                >
                  {isTesting ? (
                    <>
                      <svg className="h-4 w-4 animate-spin text-primary" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Testing Connectivity...</span>
                    </>
                  ) : (
                    <>
                      <svg className="h-4 w-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Test Connection</span>
                    </>
                  )}
                </button>
                <button
                  type="submit"
                  disabled={isConnecting || isTesting}
                  className="flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-on-primary shadow-xs transition hover:bg-primary-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                >
                  {isConnecting && !connectingId ? (
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

          {/* Saved Connections Section */}
          <div className="rounded-xl border border-hairline bg-surface-card p-6 shadow-2xs sm:p-8">
            <div className="mb-5 flex items-center justify-between border-b border-hairline pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-cream-strong border border-hairline text-ink">
                  <svg className="h-4 w-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-serif text-lg font-normal text-ink">
                      Saved Connections
                    </h3>
                    <span className="inline-flex items-center rounded-full bg-surface-cream-strong border border-hairline px-2 py-0.5 text-xs font-semibold text-body-strong">
                      {savedConnections.length}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    Previously used database server configurations. Stored encrypted at rest.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={fetchSavedConnections}
                disabled={isLoadingConnections}
                title="Refresh saved connections"
                className="flex h-8 w-8 items-center justify-center rounded-md border border-hairline bg-canvas text-body transition hover:bg-surface-soft hover:text-ink disabled:opacity-50"
              >
                <svg
                  className={`h-3.5 w-3.5 ${isLoadingConnections ? "animate-spin" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>

            {/* Error in fetching saved connections */}
            {connectionsError && (
              <div className="mb-4 flex items-center justify-between rounded-lg border border-error/20 bg-error/10 p-3 text-xs text-error">
                <span>{connectionsError}</span>
                <button
                  type="button"
                  onClick={fetchSavedConnections}
                  className="font-semibold underline hover:text-error"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Saved Connections List */}
            {isLoadingConnections && savedConnections.length === 0 ? (
              <div className="flex items-center justify-center py-8 text-muted">
                <svg className="h-5 w-5 animate-spin mr-2 text-primary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-xs">Loading saved connections...</span>
              </div>
            ) : savedConnections.length === 0 ? (
              <div className="rounded-lg border border-dashed border-hairline py-8 text-center bg-canvas/40">
                <svg
                  className="mx-auto h-7 w-7 text-muted-soft"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                </svg>
                <p className="mt-2 text-xs font-semibold text-ink">No saved connections yet</p>
                <p className="mt-1 text-[11px] text-muted">
                  Whenever you connect to a MySQL or PostgreSQL server above, it will be automatically saved here for one-click access.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {savedConnections.map((item) => {
                  const isItemConnecting = isConnecting && connectingId === item.id;
                  const isItemDeleting = deletingId === item.id;
                  const isItemFilling = fillingId === item.id;
                  const isConfirmingDelete = confirmDeleteId === item.id;

                  return (
                    <div
                      key={item.id}
                      className="group flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-hairline bg-canvas p-3.5 transition hover:border-primary/40 hover:shadow-2xs"
                    >
                      {/* Server Details */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-ink">
                            {item.host}:{item.port}
                          </span>
                          <span
                            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                              item.engine === "postgres"
                                ? "border-hairline bg-surface-cream-strong text-body-strong"
                                : "border-hairline bg-surface-soft text-body"
                            }`}
                          >
                            {item.engine === "postgres" ? "PostgreSQL" : "MySQL"}
                          </span>
                          <span className="inline-flex items-center rounded-md border border-hairline bg-surface-soft px-2 py-0.5 text-[11px] font-medium text-body">
                            user: {item.username}
                          </span>
                          {item.database && (
                            <span className="inline-flex items-center rounded-md border border-success/20 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                              db: {item.database}
                            </span>
                          )}
                          <span className="text-[11px] text-muted-soft">
                            • {formatRelativeTime(item.updatedAt)}
                          </span>
                        </div>

                        <p className="font-mono text-xs text-muted truncate" title={item.maskedUri}>
                          {item.maskedUri}
                        </p>

                        <ConnectionSchedules savedConnectionId={item.id} engine={item.engine} />
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1.5 rounded-md border border-error/30 bg-error/10 p-1">
                            <span className="text-xs text-error font-medium pl-1">
                              Delete?
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteConnection(item.id)}
                              disabled={isItemDeleting}
                              className="rounded bg-error px-2 py-1 text-xs font-semibold text-white shadow-2xs transition hover:opacity-90 disabled:opacity-50"
                            >
                              {isItemDeleting ? "..." : "Confirm"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded border border-hairline bg-canvas px-2 py-1 text-xs font-medium text-body hover:bg-surface-soft"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            {/* Fill Button */}
                            <button
                              type="button"
                              onClick={() => handleFillConnection(item.id)}
                              disabled={isConnecting || isItemFilling}
                              title="Load credentials into form to edit"
                              className="flex items-center gap-1 rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-xs font-medium text-body shadow-2xs transition hover:bg-surface-soft hover:text-ink disabled:opacity-50"
                            >
                              {isItemFilling ? (
                                <svg className="h-3.5 w-3.5 animate-spin text-primary" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                              ) : (
                                <svg className="h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              )}
                              <span>Fill</span>
                            </button>

                            {/* Connect Button */}
                            <button
                              type="button"
                              onClick={() => handleConnectSaved(item.id)}
                              disabled={isConnecting}
                              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-on-primary shadow-2xs transition hover:bg-primary-active disabled:opacity-50"
                            >
                              {isItemConnecting ? (
                                <>
                                  <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  <span>Connecting...</span>
                                </>
                              ) : (
                                <>
                                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                  </svg>
                                  <span>Connect</span>
                                </>
                              )}
                            </button>

                            {/* Delete Button */}
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(item.id)}
                              disabled={isConnecting}
                              title="Delete saved connection"
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted transition hover:border-error/30 hover:bg-error/10 hover:text-error disabled:opacity-50"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Connected View */
        <div className="space-y-6">
          {/* Server Connection Banner */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 rounded-xl border border-success/30 bg-surface-card p-5">
            <div className="flex items-start md:items-center gap-3.5">
              <div className="relative mt-1 md:mt-0 flex h-3 w-3 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-success"></span>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-ink">
                    Connected to {serverInfo?.host}:{serverInfo?.port}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${
                      activeConnection?.engine === "postgres"
                        ? "border-hairline bg-surface-cream-strong text-body-strong"
                        : "border-hairline bg-surface-soft text-body"
                    }`}
                  >
                    {activeConnection?.engine === "postgres" ? "PostgreSQL" : "MySQL"}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-success/30 bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
                    Active
                  </span>
                  {serverInfo?.version && serverInfo.version !== "Unknown" && (
                    <span className="inline-flex items-center rounded-full border border-hairline bg-surface-soft px-2 py-0.5 text-xs font-mono text-body">
                      v{serverInfo.version}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  Logged in as user: <span className="font-mono font-medium text-ink">{serverInfo?.user}</span>
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleConnect()}
                disabled={isConnecting}
                className="flex items-center gap-1.5 rounded-md border border-hairline bg-canvas px-3.5 py-1.5 text-xs font-medium text-body shadow-xs transition hover:bg-surface-soft hover:text-ink"
              >
                <svg className={`h-3.5 w-3.5 ${isConnecting ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Refresh</span>
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 rounded-md border border-error/30 bg-canvas px-3.5 py-1.5 text-xs font-medium text-error shadow-xs transition hover:bg-error/10"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span>Disconnect</span>
              </button>
            </div>
          </div>

          {/* Databases Header & Filters */}
          <div className="rounded-xl border border-hairline bg-surface-card p-6 shadow-2xs">
            <div className="flex items-center justify-between pb-5 border-b border-hairline">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-cream-strong border border-hairline text-ink">
                  <svg className="h-5 w-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-serif text-lg font-normal text-ink">
                    Databases on Server
                  </h3>
                  <p className="text-xs text-muted">
                    Total {databases.length} user database{databases.length === 1 ? "" : "s"} discovered
                    {activeConnection?.engine === "postgres"
                      ? " (system databases postgres, template0, template1 excluded)"
                      : " (system databases excluded)"}
                  </p>
                </div>
              </div>
            </div>

            {/* Search Box */}
            <div className="mt-4">
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-soft">
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
                  className="block w-full rounded-md border border-hairline bg-canvas py-2 pl-9 pr-8 text-sm text-ink placeholder:text-muted-soft focus:border-primary focus:bg-canvas focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-muted hover:text-ink"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Backup Notifications */}
            {backupSuccess && (
              <div className="mt-4 flex items-center justify-between rounded-lg border border-success/30 bg-success/10 p-3 text-xs text-success">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 shrink-0 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>{backupSuccess.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setBackupSuccess(null)}
                  className="text-success hover:opacity-80 font-bold ml-2"
                >
                  ✕
                </button>
              </div>
            )}

            {backupError && (
              <div className="mt-4 flex items-center justify-between rounded-lg border border-error/30 bg-error/10 p-3 text-xs text-error">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 shrink-0 text-error" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{backupError.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setBackupError(null)}
                  className="text-error hover:opacity-80 font-bold ml-2"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Database List / Grid */}
            <div className="mt-5">
              {filteredDatabases.length === 0 ? (
                <div className="rounded-lg border border-dashed border-hairline py-12 text-center bg-canvas/40">
                  <svg
                    className="mx-auto h-8 w-8 text-muted-soft"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                  >
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                  <p className="mt-2 text-sm font-semibold text-ink">
                    No databases found
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {searchQuery
                      ? `No databases match "${searchQuery}".`
                      : activeConnection?.engine === "postgres"
                      ? "No user databases found on this PostgreSQL server. (System databases postgres, template0, template1 are excluded)"
                      : "No user databases found on this MySQL server. (System databases are excluded)"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredDatabases.map((dbName) => {
                    const isBackingUp = backingUpDb === dbName;

                    return (
                      <div
                        key={dbName}
                        className="group flex items-center justify-between rounded-lg border border-hairline bg-canvas p-3.5 transition hover:border-primary/40 hover:shadow-2xs"
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-cream-strong border border-hairline text-primary">
                            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                              <ellipse cx="12" cy="5" rx="9" ry="3" />
                              <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                              <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-mono text-sm font-semibold text-ink" title={dbName}>
                              {dbName}
                            </p>
                          </div>
                        </div>

                        {/* Backup button */}
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleBackup(dbName)}
                            disabled={backingUpDb !== null}
                            title={`Backup ${dbName} to S3`}
                            className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-on-primary shadow-xs transition hover:bg-primary-active disabled:opacity-50"
                          >
                            {isBackingUp ? (
                              <>
                                <svg className="h-3.5 w-3.5 animate-spin text-on-primary" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span>Backing up...</span>
                              </>
                            ) : (
                              <>
                                <svg className="h-3.5 w-3.5 text-on-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                <span>Backup</span>
                              </>
                            )}
                          </button>
                          {activeConnection?.mode === "saved" && activeConnection.savedConnectionId && (
                            <button
                              type="button"
                              onClick={() => {
                                setScheduleTargetDb(dbName);
                                setScheduleModalOpen(true);
                              }}
                              disabled={backingUpDb !== null}
                              title={`Schedule recurring backups of ${dbName}`}
                              className="flex items-center gap-1.5 rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-xs font-medium text-body shadow-2xs transition hover:bg-surface-soft hover:text-ink disabled:opacity-50"
                            >
                              <svg className="h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                <circle cx="12" cy="12" r="9" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
                              </svg>
                              <span>Schedule</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ScheduleForm
        open={scheduleModalOpen}
        onClose={() => setScheduleModalOpen(false)}
        onSaved={() => {
          setScheduleTargetDb(null);
        }}
        connections={savedConnections.map<SavedConnectionOption>((c) => ({
          id: c.id,
          host: c.host,
          port: c.port,
          username: c.username,
          database: c.database,
          engine: c.engine,
        }))}
        defaultDatabase={scheduleTargetDb ?? undefined}
        defaultSavedConnectionId={
          activeConnection?.mode === "saved"
            ? activeConnection.savedConnectionId
            : undefined
        }
      />
    </div>
  );
}
