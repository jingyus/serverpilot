// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
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
 * Get the raw better-sqlite3 connection.
 * Useful for direct SQL execution in tests.
 *
 * @throws {Error} If the database has not been initialized
 */
export function getRawDatabase(): Database.Database {
  if (!_sqlite) {
    throw new Error(
      'Database not initialized. Call initDatabase() first.',
    );
  }
  return _sqlite;
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
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      max_servers INTEGER NOT NULL DEFAULT 5,
      max_users INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_idx ON tenants(slug);
    CREATE INDEX IF NOT EXISTS tenants_owner_id_idx ON tenants(owner_id);

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      timezone TEXT DEFAULT 'UTC',
      tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users(tenant_id);
    CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);

    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'offline',
      tags TEXT DEFAULT '[]',
      "group" TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS servers_user_id_idx ON servers(user_id);
    CREATE INDEX IF NOT EXISTS servers_tenant_id_idx ON servers(tenant_id);
    CREATE INDEX IF NOT EXISTS servers_group_idx ON servers("group");

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
      tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      commands TEXT DEFAULT '[]',
      output TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      risk_level TEXT NOT NULL DEFAULT 'green',
      snapshot_id TEXT,
      duration INTEGER,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS operations_server_id_idx ON operations(server_id);
    CREATE INDEX IF NOT EXISTS operations_user_id_idx ON operations(user_id);
    CREATE INDEX IF NOT EXISTS operations_tenant_id_idx ON operations(tenant_id);
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
      tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
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
    CREATE INDEX IF NOT EXISTS tasks_tenant_id_idx ON tasks(tenant_id);
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

    CREATE TABLE IF NOT EXISTS metrics_hourly (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      cpu_avg INTEGER NOT NULL,
      cpu_min INTEGER NOT NULL,
      cpu_max INTEGER NOT NULL,
      memory_avg INTEGER NOT NULL,
      memory_min INTEGER NOT NULL,
      memory_max INTEGER NOT NULL,
      memory_total INTEGER NOT NULL,
      disk_avg INTEGER NOT NULL,
      disk_min INTEGER NOT NULL,
      disk_max INTEGER NOT NULL,
      disk_total INTEGER NOT NULL,
      network_in_avg INTEGER NOT NULL,
      network_in_max INTEGER NOT NULL,
      network_out_avg INTEGER NOT NULL,
      network_out_max INTEGER NOT NULL,
      sample_count INTEGER NOT NULL,
      bucket_time INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS metrics_hourly_server_id_idx ON metrics_hourly(server_id);
    CREATE INDEX IF NOT EXISTS metrics_hourly_server_bucket_idx ON metrics_hourly(server_id, bucket_time);

    CREATE TABLE IF NOT EXISTS metrics_daily (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      cpu_avg INTEGER NOT NULL,
      cpu_min INTEGER NOT NULL,
      cpu_max INTEGER NOT NULL,
      memory_avg INTEGER NOT NULL,
      memory_min INTEGER NOT NULL,
      memory_max INTEGER NOT NULL,
      memory_total INTEGER NOT NULL,
      disk_avg INTEGER NOT NULL,
      disk_min INTEGER NOT NULL,
      disk_max INTEGER NOT NULL,
      disk_total INTEGER NOT NULL,
      network_in_avg INTEGER NOT NULL,
      network_in_max INTEGER NOT NULL,
      network_out_avg INTEGER NOT NULL,
      network_out_max INTEGER NOT NULL,
      sample_count INTEGER NOT NULL,
      bucket_time INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS metrics_daily_server_id_idx ON metrics_daily(server_id);
    CREATE INDEX IF NOT EXISTS metrics_daily_server_bucket_idx ON metrics_daily(server_id, bucket_time);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
      session_id TEXT,
      command TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      reason TEXT NOT NULL,
      matched_pattern TEXT,
      action TEXT NOT NULL,
      audit_warnings TEXT DEFAULT '[]',
      audit_blockers TEXT DEFAULT '[]',
      execution_result TEXT,
      operation_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS audit_logs_server_id_idx ON audit_logs(server_id);
    CREATE INDEX IF NOT EXISTS audit_logs_user_id_idx ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS audit_logs_tenant_id_idx ON audit_logs(tenant_id);
    CREATE INDEX IF NOT EXISTS audit_logs_risk_level_idx ON audit_logs(risk_level);
    CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at);

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

    CREATE TABLE IF NOT EXISTS doc_sources (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      software TEXT NOT NULL,
      type TEXT NOT NULL,
      github_config TEXT,
      website_config TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      auto_update INTEGER NOT NULL DEFAULT 0,
      update_frequency_hours INTEGER DEFAULT 168,
      last_fetched_at INTEGER,
      last_fetch_status TEXT,
      last_fetch_error TEXT,
      document_count INTEGER NOT NULL DEFAULT 0,
      last_sha TEXT,
      last_hash TEXT,
      last_update_time INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS doc_sources_user_id_idx ON doc_sources(user_id);
    CREATE INDEX IF NOT EXISTS doc_sources_tenant_id_idx ON doc_sources(tenant_id);
    CREATE INDEX IF NOT EXISTS doc_sources_software_idx ON doc_sources(software);
    CREATE INDEX IF NOT EXISTS doc_sources_enabled_idx ON doc_sources(enabled);
    CREATE INDEX IF NOT EXISTS doc_sources_auto_update_idx ON doc_sources(auto_update);

    CREATE TABLE IF NOT EXISTS oauth_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      provider_username TEXT,
      provider_avatar_url TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS oauth_accounts_provider_account_idx ON oauth_accounts(provider, provider_account_id);
    CREATE INDEX IF NOT EXISTS oauth_accounts_user_id_idx ON oauth_accounts(user_id);

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      max_retries INTEGER NOT NULL DEFAULT 3,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS webhooks_user_id_idx ON webhooks(user_id);
    CREATE INDEX IF NOT EXISTS webhooks_tenant_id_idx ON webhooks(tenant_id);
    CREATE INDEX IF NOT EXISTS webhooks_enabled_idx ON webhooks(enabled);

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      http_status INTEGER,
      response_body TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER,
      next_retry_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_id_idx ON webhook_deliveries(webhook_id);
    CREATE INDEX IF NOT EXISTS webhook_deliveries_status_idx ON webhook_deliveries(status);
    CREATE INDEX IF NOT EXISTS webhook_deliveries_next_retry_idx ON webhook_deliveries(next_retry_at);
    CREATE INDEX IF NOT EXISTS webhook_deliveries_created_at_idx ON webhook_deliveries(created_at);

    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      token TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS invitations_tenant_id_idx ON invitations(tenant_id);
    CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations(email);
    CREATE INDEX IF NOT EXISTS invitations_token_idx ON invitations(token);
    CREATE INDEX IF NOT EXISTS invitations_status_idx ON invitations(status);
    CREATE INDEX IF NOT EXISTS invitations_expires_at_idx ON invitations(expires_at);

    CREATE TABLE IF NOT EXISTS user_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      ai_provider TEXT NOT NULL,
      notifications TEXT NOT NULL,
      knowledge_base TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS user_settings_user_id_idx ON user_settings(user_id);

    CREATE TABLE IF NOT EXISTS doc_source_history (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES doc_sources(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      change_type TEXT NOT NULL,
      previous_version TEXT,
      current_version TEXT,
      status TEXT NOT NULL,
      error TEXT,
      document_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS doc_source_history_source_id_idx ON doc_source_history(source_id);
    CREATE INDEX IF NOT EXISTS doc_source_history_user_id_idx ON doc_source_history(user_id);
    CREATE INDEX IF NOT EXISTS doc_source_history_created_at_idx ON doc_source_history(created_at);

    CREATE TABLE IF NOT EXISTS installed_skills (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      display_name TEXT,
      version TEXT NOT NULL,
      source TEXT NOT NULL,
      skill_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'installed',
      config TEXT,
      manifest_inputs TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS installed_skills_user_id_idx ON installed_skills(user_id);
    CREATE INDEX IF NOT EXISTS installed_skills_tenant_id_idx ON installed_skills(tenant_id);
    CREATE INDEX IF NOT EXISTS installed_skills_name_idx ON installed_skills(name);
    CREATE INDEX IF NOT EXISTS installed_skills_status_idx ON installed_skills(status);

    CREATE TABLE IF NOT EXISTS skill_executions (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES installed_skills(id) ON DELETE CASCADE,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      result TEXT,
      steps_executed INTEGER NOT NULL DEFAULT 0,
      duration INTEGER
    );
    CREATE INDEX IF NOT EXISTS skill_executions_skill_id_idx ON skill_executions(skill_id);
    CREATE INDEX IF NOT EXISTS skill_executions_server_id_idx ON skill_executions(server_id);
    CREATE INDEX IF NOT EXISTS skill_executions_user_id_idx ON skill_executions(user_id);
    CREATE INDEX IF NOT EXISTS skill_executions_status_idx ON skill_executions(status);
    CREATE INDEX IF NOT EXISTS skill_executions_started_at_idx ON skill_executions(started_at);

    CREATE TABLE IF NOT EXISTS skill_store (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES installed_skills(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS skill_store_skill_key_idx ON skill_store(skill_id, key);
    CREATE INDEX IF NOT EXISTS skill_store_skill_id_idx ON skill_store(skill_id);
  `);
}
