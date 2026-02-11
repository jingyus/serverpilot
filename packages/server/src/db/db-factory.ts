// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Database factory for ServerPilot.
 *
 * Selects between SQLite and PostgreSQL based on the DB_TYPE environment variable.
 * Default is 'sqlite' for backward compatibility with the community edition.
 *
 * Environment variables:
 *   DB_TYPE=sqlite|postgres  (default: sqlite)
 *
 * For SQLite:
 *   DATABASE_PATH=./data/serverpilot.db  (or ':memory:')
 *
 * For PostgreSQL:
 *   DATABASE_URL=postgres://user:pass@host:5432/db
 *   (or PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD)
 *
 * @module db/db-factory
 */

import type { DrizzleDB } from './connection.js';
import type { PgDrizzleDB } from './pg-connection.js';

export type DbType = 'sqlite' | 'postgres';

/** Union type representing any supported Drizzle database instance */
export type AnyDrizzleDB = DrizzleDB | PgDrizzleDB;

let _dbType: DbType = 'sqlite';

/**
 * Get the current database type.
 */
export function getDbType(): DbType {
  return _dbType;
}

/**
 * Resolve DB_TYPE from environment. Defaults to 'sqlite'.
 */
export function resolveDbType(): DbType {
  const envType = process.env.DB_TYPE?.toLowerCase();
  if (envType === 'postgres' || envType === 'postgresql') {
    return 'postgres';
  }
  return 'sqlite';
}

/**
 * Initialize the database based on DB_TYPE environment variable.
 *
 * For SQLite: initializes with the given path (default: ./data/serverpilot.db)
 * For PostgreSQL: initializes with connection config from env vars
 *
 * @returns The database type that was initialized
 */
export async function initDatabaseFromEnv(): Promise<DbType> {
  _dbType = resolveDbType();

  if (_dbType === 'postgres') {
    const { initPgDatabase, buildPgConfigFromEnv } = await import('./pg-connection.js');
    const config = buildPgConfigFromEnv();
    initPgDatabase(config);
  } else {
    const { initDatabase } = await import('./connection.js');
    const dbPath = process.env.DATABASE_PATH ?? './data/serverpilot.db';
    initDatabase(dbPath);
  }

  return _dbType;
}

/**
 * Close the active database connection.
 */
export async function closeDatabaseConnection(): Promise<void> {
  if (_dbType === 'postgres') {
    const { closePgDatabase } = await import('./pg-connection.js');
    await closePgDatabase();
  } else {
    const { closeDatabase } = await import('./connection.js');
    closeDatabase();
  }
}

/**
 * Check if the current database type is PostgreSQL.
 */
export function isPostgres(): boolean {
  return _dbType === 'postgres';
}

/**
 * Check if the current database type is SQLite.
 */
export function isSQLite(): boolean {
  return _dbType === 'sqlite';
}

/** Reset internal state (for testing only) */
export function _resetDbType(): void {
  _dbType = 'sqlite';
}
