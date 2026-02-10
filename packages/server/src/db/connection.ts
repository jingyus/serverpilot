/**
 * Database connection management for ServerPilot.
 *
 * Creates and manages the SQLite database connection using better-sqlite3
 * and wraps it with Drizzle ORM for type-safe queries.
 *
 * @module db/connection
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema.js';

export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleDB | null = null;
let _sqlite: Database.Database | null = null;

/**
 * Initialize the database connection.
 *
 * @param dbPath - Path to the SQLite database file. Use ':memory:' for in-memory databases.
 * @returns The Drizzle ORM database instance
 */
export function initDatabase(dbPath: string): DrizzleDB {
  if (_db) return _db;

  _sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  _sqlite.pragma('journal_mode = WAL');
  // Enable foreign key enforcement (off by default in SQLite)
  _sqlite.pragma('foreign_keys = ON');

  _db = drizzle(_sqlite, { schema });

  return _db;
}

/**
 * Get the current database instance.
 *
 * @throws {Error} If the database has not been initialized
 */
export function getDatabase(): DrizzleDB {
  if (!_db) {
    throw new Error(
      'Database not initialized. Call initDatabase() first.',
    );
  }
  return _db;
}

/**
 * Close the database connection and reset state.
 */
export function closeDatabase(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
  }
  _db = null;
}

/**
 * Create all tables defined in the schema.
 *
 * Uses raw SQL to create tables matching the Drizzle schema.
 * Suitable for initial setup and testing.
 * For production, use drizzle-kit migrations instead.
 */
export function createTables(db?: DrizzleDB): void {
  const sqlite = _sqlite;
  if (!sqlite) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      timezone TEXT DEFAULT 'UTC',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'offline',
      tags TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS servers_user_id_idx ON servers(user_id);

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      key_hash TEXT NOT NULL,
      version TEXT,
      last_seen INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agents_server_id_idx ON agents(server_id);

    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
      os_info TEXT,
      software TEXT DEFAULT '[]',
      services TEXT DEFAULT '[]',
      preferences TEXT,
      notes TEXT DEFAULT '[]',
      operation_history TEXT DEFAULT '[]',
      history_summary TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS profiles_server_id_idx ON profiles(server_id);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      messages TEXT DEFAULT '[]',
      context TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_server_id_idx ON sessions(server_id);

    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      commands TEXT DEFAULT '[]',
      output TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      risk_level TEXT NOT NULL DEFAULT 'green',
      snapshot_id TEXT,
      duration INTEGER,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS operations_server_id_idx ON operations(server_id);
    CREATE INDEX IF NOT EXISTS operations_user_id_idx ON operations(user_id);
    CREATE INDEX IF NOT EXISTS operations_session_id_idx ON operations(session_id);
    CREATE INDEX IF NOT EXISTS operations_status_idx ON operations(status);

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      operation_id TEXT,
      files TEXT DEFAULT '[]',
      configs TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS snapshots_server_id_idx ON snapshots(server_id);
    CREATE INDEX IF NOT EXISTS snapshots_operation_id_idx ON snapshots(operation_id);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      cron TEXT NOT NULL,
      command TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_run INTEGER,
      last_status TEXT,
      next_run INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_server_id_idx ON tasks(server_id);
    CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);

    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      metric_type TEXT NOT NULL,
      operator TEXT NOT NULL,
      threshold INTEGER NOT NULL,
      severity TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      email_recipients TEXT DEFAULT '[]',
      cooldown_minutes INTEGER NOT NULL DEFAULT 30,
      last_triggered_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS alert_rules_server_id_idx ON alert_rules(server_id);
    CREATE INDEX IF NOT EXISTS alert_rules_user_id_idx ON alert_rules(user_id);
    CREATE INDEX IF NOT EXISTS alert_rules_enabled_idx ON alert_rules(enabled);

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      value TEXT,
      threshold TEXT,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS alerts_server_id_idx ON alerts(server_id);
    CREATE INDEX IF NOT EXISTS alerts_resolved_idx ON alerts(resolved);

    CREATE TABLE IF NOT EXISTS metrics (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      cpu_usage INTEGER NOT NULL,
      memory_usage INTEGER NOT NULL,
      memory_total INTEGER NOT NULL,
      disk_usage INTEGER NOT NULL,
      disk_total INTEGER NOT NULL,
      network_in INTEGER NOT NULL,
      network_out INTEGER NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS metrics_server_id_idx ON metrics(server_id);
    CREATE INDEX IF NOT EXISTS metrics_server_timestamp_idx ON metrics(server_id, timestamp);

    CREATE TABLE IF NOT EXISTS knowledge_cache (
      id TEXT PRIMARY KEY,
      software TEXT NOT NULL,
      platform TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL,
      success_count INTEGER NOT NULL DEFAULT 0,
      last_used INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS knowledge_cache_software_idx ON knowledge_cache(software);
    CREATE INDEX IF NOT EXISTS knowledge_cache_platform_idx ON knowledge_cache(platform);
    CREATE INDEX IF NOT EXISTS knowledge_cache_software_platform_idx ON knowledge_cache(software, platform);
  `);
}
