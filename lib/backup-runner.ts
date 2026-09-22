import type { Connection, ConnectionOptions } from "mysql2/promise";
import type { Sql } from "postgres";
import type { Client } from "@libsql/client";
import {
  backupDatabaseToS3,
  SYSTEM_DATABASES,
  type BackupResult,
  type ManifestSink,
} from "./mysql-backup";
import {
  backupPostgresDatabaseToS3,
  POSTGRES_SYSTEM_DATABASES,
  type PostgresBackupConnectionOptions,
} from "./postgres-backup";
import { backupSqliteDatabaseToS3 } from "./sqlite-backup";

export type DatabaseEngine = "mysql" | "postgres" | "sqlite";

export interface RunBackupConnectionOptions {
  uri?: string;
  url?: string;
  authToken?: string;
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  connectTimeout?: number;
}

export interface RunBackupOptions {
  engine: DatabaseEngine;
  databaseName: string;
  userId: string;
  connectionOptions?: RunBackupConnectionOptions;
  /**
   * Test seam: injected MySQL connection for mock testing.
   */
  mysqlConnection?: Connection;
  /**
   * Test seam: injected PostgreSQL client for mock testing.
   */
  postgresSql?: Sql;
  /**
   * Test seam: injected libSQL Client for mock testing.
   */
  libsqlClient?: Client;
  /**
   * Test seam: sink that receives the Backup Manifest JSON sibling as bytes.
   */
  manifestSink?: ManifestSink;
}

export { type BackupResult, type ManifestSink };

/**
 * Polymorphic backup runner seam that dispatches database backups
 * to the appropriate engine exporter ('mysql' | 'postgres' | 'sqlite').
 */
export async function runBackup(options: RunBackupOptions): Promise<BackupResult> {
  const { engine, databaseName, userId, connectionOptions = {} } = options;

  if (engine === "mysql") {
    if (SYSTEM_DATABASES.has(databaseName.toLowerCase())) {
      throw new Error(`Cannot backup protected system database: ${databaseName}`);
    }

    return await backupDatabaseToS3({
      connectionOptions: connectionOptions as ConnectionOptions,
      databaseName,
      userId,
      connection: options.mysqlConnection,
      manifestSink: options.manifestSink,
    });
  }

  if (engine === "postgres") {
    if (POSTGRES_SYSTEM_DATABASES.has(databaseName.toLowerCase())) {
      throw new Error(`Cannot backup protected system database: ${databaseName}`);
    }

    return await backupPostgresDatabaseToS3({
      connectionOptions: connectionOptions as PostgresBackupConnectionOptions,
      databaseName,
      userId,
      sql: options.postgresSql,
      manifestSink: options.manifestSink,
    });
  }

  if (engine === "sqlite") {
    return await backupSqliteDatabaseToS3({
      connectionOptions: {
        uri: connectionOptions.uri,
        url: connectionOptions.url,
        authToken: connectionOptions.authToken,
        database: databaseName,
      },
      databaseName,
      userId,
      client: options.libsqlClient,
      manifestSink: options.manifestSink,
    });
  }

  throw new Error(`Unsupported database engine: ${String(engine)}`);
}
