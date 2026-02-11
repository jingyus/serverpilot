// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Database migration runner for ServerPilot.
 *
 * Applies Drizzle ORM migrations from the migrations directory.
 * Supports both programmatic usage (imported as module) and CLI execution.
 *
 * @module db/migrate
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default path to the migrations directory */
const DEFAULT_MIGRATIONS_PATH = resolve(__dirname, 'migrations');

export interface MigrateOptions {
  /** Path to SQLite database file. Use ':memory:' for in-memory. */
  dbPath: string;
  /** Path to the migrations directory. Defaults to ./migrations/ */
  migrationsPath?: string;
}

export interface MigrateResult {
  success: boolean;
  dbPath: string;
  migrationsPath: string;
}

/**
 * Run all pending migrations against the specified database.
 *
 * Opens a new connection, enables WAL mode and foreign keys,
 * runs migrations, then closes the connection.
 */
export function runMigrations(options: MigrateOptions): MigrateResult {
  const migrationsPath = options.migrationsPath ?? DEFAULT_MIGRATIONS_PATH;

  const sqlite = new Database(options.dbPath);
  try {
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');

    const db = drizzle(sqlite);
    drizzleMigrate(db, { migrationsFolder: migrationsPath });

    return { success: true, dbPath: options.dbPath, migrationsPath };
  } finally {
    sqlite.close();
  }
}

/**
 * Run migrations using the existing database connection from connection.ts.
 *
 * Useful when the database is already initialized and you want to
 * apply pending migrations without opening a new connection.
 */
export function runMigrationsWithConnection(
  db: ReturnType<typeof drizzle>,
  migrationsPath?: string,
): void {
  drizzleMigrate(db, {
    migrationsFolder: migrationsPath ?? DEFAULT_MIGRATIONS_PATH,
  });
}

// CLI entry point: `npx tsx src/db/migrate.ts [dbPath]`
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const dbPath = process.argv[2] ?? process.env.DATABASE_URL ?? './data/serverpilot.db';
  console.log(`Running migrations on: ${dbPath}`);

  const result = runMigrations({ dbPath });

  if (result.success) {
    console.log('Migrations applied successfully.');
  }
}
