# 01: Schema Foundation, PostgreSQL Connection Management & Database Explorer

**What to build:** 
Allow users to manage and inspect PostgreSQL Target Databases in the dashboard alongside MySQL. The application database schema is extended with an engine discriminator so saved connections and backups explicitly track their database engine. In the dashboard, users can toggle between MySQL and PostgreSQL when setting up a connection, with the port defaulting to 5432 for PostgreSQL and 3306 for MySQL. Users can test connectivity against an external PostgreSQL instance, save the encrypted credentials, view visual engine badges on saved connection cards, and explore the list of user databases on the connected PostgreSQL server (with internal system databases filtered out).

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The `saved_connection` and `database_backup` tables in the Application Database include an `engine` column (`'mysql' | 'postgres'`) that defaults to `'mysql'` for existing records, supported by a generated database migration.
- [x] The connection form includes a segmented engine toggle (`[ MySQL ]` | `[ PostgreSQL ]`) that updates default port values (3306 for MySQL, 5432 for PostgreSQL), placeholder hints, and validation rules.
- [x] Users can test connectivity to an external PostgreSQL server before saving credentials.
- [x] PostgreSQL connection credentials are encrypted at rest and saved to the user's account with masked passwords in responses.
- [x] Saved connection cards in the dashboard display an engine badge identifying whether the target is MySQL or PostgreSQL.
- [x] Users can explore available User Databases on a connected PostgreSQL instance, with system databases (`postgres`, `template0`, `template1`) excluded from the list.
- [x] Existing MySQL connections and tests continue to function without regression.
