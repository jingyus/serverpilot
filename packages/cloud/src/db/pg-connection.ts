// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * PostgreSQL connection management for ServerPilot Cloud.
 *
 * Creates and manages the PostgreSQL database connection using node-postgres
 * and wraps it with Drizzle ORM for type-safe queries.
 *
 * @module db/pg-connection
 */

import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

import * as pgSchema from './pg-schema.js';

export type PgDrizzleDB = ReturnType<typeof drizzle<typeof pgSchema>>;

let _db: PgDrizzleDB | null = null;
let _pool: pg.Pool | null = null;

/** PostgreSQL connection configuration */
export interface PgConnectionConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  max?: number;
}

/**
 * Build PG connection config from environment variables.
 */
export function buildPgConfigFromEnv(): PgConnectionConfig {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return {
      connectionString,
      ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      max: parseInt(process.env.PG_POOL_MAX ?? '20', 10),
    };
  }

  return {
    host: process.env.PG_HOST ?? 'localhost',
    port: parseInt(process.env.PG_PORT ?? '5432', 10),
    database: process.env.PG_DATABASE ?? 'serverpilot',
    user: process.env.PG_USER ?? 'serverpilot',
    password: process.env.PG_PASSWORD ?? '',
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: parseInt(process.env.PG_POOL_MAX ?? '20', 10),
  };
}

/**
 * Initialize the PostgreSQL database connection.
 *
 * @param config - PostgreSQL connection configuration
 * @returns The Drizzle ORM database instance for PostgreSQL
 */
export function initPgDatabase(config: PgConnectionConfig): PgDrizzleDB {
  if (_db) return _db;

  _pool = new pg.Pool(config);

  _db = drizzle(_pool, { schema: pgSchema });

  return _db;
}

/**
 * Get the current PostgreSQL database instance.
 *
 * @throws {Error} If the database has not been initialized
 */
export function getPgDatabase(): PgDrizzleDB {
  if (!_db) {
    throw new Error('PostgreSQL database not initialized. Call initPgDatabase() first.');
  }
  return _db;
}

/**
 * Get the raw node-postgres Pool.
 *
 * @throws {Error} If the database has not been initialized
 */
export function getPgPool(): pg.Pool {
  if (!_pool) {
    throw new Error('PostgreSQL database not initialized. Call initPgDatabase() first.');
  }
  return _pool;
}

/**
 * Close the PostgreSQL connection pool and reset state.
 */
export async function closePgDatabase(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
  _db = null;
}
