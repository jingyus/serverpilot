// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * ServerPilot Cloud Edition — entry point.
 *
 * Provides PostgreSQL database support and future cloud-only features
 * (billing, SSO, clustering, analytics). This package is loaded
 * dynamically by the server when DB_TYPE=postgres.
 *
 * @module @aiinstaller/cloud
 */

import {
  buildPgConfigFromEnv,
  initPgDatabase,
  closePgDatabase,
} from './db/pg-connection.js';

export interface CloudBootstrapResult {
  dbType: 'postgres';
  close: () => Promise<void>;
}

/**
 * Bootstrap the cloud edition.
 *
 * Initializes the PostgreSQL connection using environment variables.
 * Returns a handle that the server uses for graceful shutdown.
 */
export async function bootstrapCloud(): Promise<CloudBootstrapResult> {
  const config = buildPgConfigFromEnv();
  initPgDatabase(config);

  return {
    dbType: 'postgres',
    close: closePgDatabase,
  };
}

// Re-export database utilities for direct usage
export { buildPgConfigFromEnv, getPgDatabase, getPgPool, closePgDatabase } from './db/pg-connection.js';
export type { PgConnectionConfig, PgDrizzleDB } from './db/pg-connection.js';
export { runPgMigrations } from './db/pg-migrate.js';
export type { PgMigrateOptions, PgMigrateResult } from './db/pg-migrate.js';
