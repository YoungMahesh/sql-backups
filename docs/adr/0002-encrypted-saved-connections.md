# 0002. Encrypted Saved Connections

## Status
accepted

## Context and Decision
Users connecting to MySQL servers frequently reconnect to the same database hosts. Entering database credentials (host, port, username, password, or connection URI) on every session introduces friction and slows down workflow.

However, MySQL connection strings contain sensitive credentials (usernames and plaintext passwords). Persisting credentials requires balancing user convenience (1-click reconnect across devices) with security (protecting credentials at rest and against shoulder-surfing in the dashboard UI).

We decided to persist verified MySQL connection strings server-side in a dedicated `saved_connection` table, encrypted at rest using AES-256-GCM. The encryption key is securely derived from the application secret (`BETTER_AUTH_SECRET`, with optional `ENCRYPTION_KEY` override). In the client-facing UI, passwords within connection strings are masked by default (`mysql://user:••••@host:port/db`), while enabling instant one-click reconnect and pre-filling into the connection form.

## Considered Options
1. **Client-only storage (`localStorage`)**: Credentials never touch the backend database, but connections cannot synchronize across browsers or devices for logged-in users, and cleartext credentials remain accessible to any malicious client scripts/browser extensions.
2. **Plaintext server storage**: Simple to implement, but leaves database credentials exposed in cleartext in the application database backups and queries.
3. **Password-stripped persistence**: Only server host, port, and user are stored; user must re-enter the password on every connect. Safe, but degrades convenience for frequent developers.
4. **Server-side AES-256-GCM encrypted persistence with UI masking (Chosen)**: Provides cross-device availability and one-click reconnect while ensuring credentials are encrypted at rest and masked in list views.

## Consequences
- A new table `saved_connection` is added to the application database, tied to `user.id`.
- The connection string is encrypted before database insertion and decrypted only when initiating a connection or loading connection parameters into the form.
- The dashboard list endpoint returns only masked URIs and metadata, minimizing sensitive data exposure.
- If `BETTER_AUTH_SECRET` or `ENCRYPTION_KEY` is rotated without re-encrypting existing rows, stored connections will fail decryption gracefully without crashing the application.
