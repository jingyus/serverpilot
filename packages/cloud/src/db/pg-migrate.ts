// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * PostgreSQL migration runner for ServerPilot Cloud.
 *
 * Applies Drizzle ORM migrations from the migrations directory.
 * Supports both programmatic usage (imported as module) and CLI execution.
 *
 * @module db/pg-migrate
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';

import { buildPgConfigFromEnv } from './pg-connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_PATH = resolve(__dirname, 'migrations');

export interface PgMigrateOptions {
  connectionString?: string;
  migrationsPath?: string;
}

export interface PgMigrateResult {
  success: boolean;
  migrationsPath: string;
}

/**
 * Run all pending PostgreSQL migrations.
 *
 * Opens a new connection pool, runs migrations, then closes the pool.
 */
export async function runPgMigrations(options: PgMigrateOptions = {}): Promise<PgMigrateResult> {
  const migrationsPath = options.migrationsPath ?? DEFAULT_MIGRATIONS_PATH;
  const config = options.connectionString
    ? { connectionString: options.connectionString }
    : buildPgConfigFromEnv();

  const pool = new pg.Pool(config);
  try {
    const db = drizzle(pool);
    await drizzleMigrate(db, { migrationsFolder: migrationsPath });
    return { success: true, migrationsPath };
  } finally {
    await pool.end();
  }
}

// CLI entry point: `npx tsx src/db/pg-migrate.ts [connectionString]`
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const connectionString = process.argv[2] ?? process.env.DATABASE_URL;
  console.log('Running PostgreSQL migrations...');

  runPgMigrations({ connectionString })
    .then((result) => {
      if (result.success) {
        console.log('PostgreSQL migrations applied successfully.');
      }
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
