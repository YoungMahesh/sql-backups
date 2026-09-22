# 01: Schema Foundation, Remote libSQL Connection Management & Database Explorer

**What to build:** 
Allow users to connect to and explore remote libSQL / Turso SQLite Target Databases in the dashboard alongside MySQL and PostgreSQL. The application database schema is extended so the `engine` column accepts `'sqlite'` across `saved_connection`, `database_backup`, and scheduling tables, backed by a Drizzle migration. Connection string parsing and encryption are updated to support `libsql://` and `https://` URLs with bearer auth tokens. In the dashboard, the Connection Explorer provides a 3-way segmented toggle (`[ MySQL ] | [ PostgreSQL ] | [ SQLite (Turso) ]`) with dedicated Database URL and Auth Token input fields, as well as full connection string pasting. Users can test connectivity to remote libSQL targets via `@libsql/client`, save encrypted credentials, view visual `SQLite` badges on saved connection cards, and explore the connected User Database with its table catalog and row counts.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The `engine` column across `saved_connection`, `database_backup`, and `backup_schedule` tables in the Application Database is extended to accept `'sqlite'` (`'mysql' | 'postgres' | 'sqlite'`), supported by a generated database migration applied via `pnpm run db-migrate`.
- [x] Connection string parsing and serialization in `lib/crypto.ts` recognize `libsql://` and `https://` schemes, extract database names and auth tokens, and preserve encrypted tokens for storage.
- [x] The `@libsql/client` package is added to project dependencies.
- [x] Parallel endpoints `/api/sqlite/connections` and `/api/sqlite/databases` are implemented for connection verification, saving, listing, deletion, and database/table exploration.
- [x] The connection form in `components/database-explorer.tsx` features a 3-way toggle (`[ MySQL ] | [ PostgreSQL ] | [ SQLite (Turso) ]`) that adapts fields to Database URL and Auth Token, with connection testing validating remote connectivity.
- [x] Saved connection cards in the dashboard display an engine badge identifying SQLite targets and display masked connection details.
- [x] Users can explore the connected SQLite database, listing all user tables and row counts with system metadata tables filtered out.
- [x] Existing MySQL and PostgreSQL connections, schedules, and tests continue to pass without regression.
