-- PostgreSQL initial schema for ServerPilot
-- Equivalent to all SQLite migrations (0000-0008) combined
-- This creates the complete schema for a fresh PostgreSQL deployment.

-- ============================================================================
-- Tenants (multi-tenant isolation boundary)
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  owner_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  max_servers INTEGER NOT NULL DEFAULT 5,
  max_users INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pg_tenants_slug_idx ON tenants(slug);
CREATE INDEX IF NOT EXISTS pg_tenants_owner_id_idx ON tenants(owner_id);

-- ============================================================================
-- Users
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  timezone TEXT DEFAULT 'UTC',
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_users_tenant_id_idx ON users(tenant_id);
CREATE INDEX IF NOT EXISTS pg_users_role_idx ON users(role);

-- ============================================================================
-- OAuth Accounts
-- ============================================================================

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  provider_username TEXT,
  provider_avatar_url TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  UNIQUE(provider, provider_account_id)
);
CREATE INDEX IF NOT EXISTS pg_oauth_user_id_idx ON oauth_accounts(user_id);

-- ============================================================================
-- User Settings
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  ai_provider JSONB NOT NULL,
  notifications JSONB NOT NULL,
  knowledge_base JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- ============================================================================
-- Servers
-- ============================================================================

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'offline',
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_servers_user_id_idx ON servers(user_id);
CREATE INDEX IF NOT EXISTS pg_servers_tenant_id_idx ON servers(tenant_id);

-- ============================================================================
-- Agents
-- ============================================================================

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL,
  version TEXT,
  last_seen TIMESTAMP,
  created_at TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pg_agents_server_id_idx ON agents(server_id);

-- ============================================================================
-- Server Profiles
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL UNIQUE REFERENCES servers(id) ON DELETE CASCADE,
  os_info JSONB,
  software JSONB DEFAULT '[]',
  services JSONB DEFAULT '[]',
  preferences JSONB,
  notes JSONB DEFAULT '[]',
  operation_history JSONB DEFAULT '[]',
  history_summary TEXT,
  updated_at TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pg_profiles_server_id_idx ON profiles(server_id);

-- ============================================================================
-- Sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  messages JSONB DEFAULT '[]',
  context JSONB,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS pg_sessions_server_id_idx ON sessions(server_id);

-- ============================================================================
-- Operations
-- ============================================================================

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  commands JSONB DEFAULT '[]',
  output TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  risk_level TEXT NOT NULL DEFAULT 'green',
  snapshot_id TEXT,
  duration INTEGER,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS pg_operations_server_id_idx ON operations(server_id);
CREATE INDEX IF NOT EXISTS pg_operations_user_id_idx ON operations(user_id);
CREATE INDEX IF NOT EXISTS pg_operations_tenant_id_idx ON operations(tenant_id);
CREATE INDEX IF NOT EXISTS pg_operations_session_id_idx ON operations(session_id);
CREATE INDEX IF NOT EXISTS pg_operations_status_idx ON operations(status);

-- ============================================================================
-- Snapshots
-- ============================================================================

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  operation_id TEXT,
  files JSONB DEFAULT '[]',
  configs JSONB DEFAULT '[]',
  created_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS pg_snapshots_server_id_idx ON snapshots(server_id);
CREATE INDEX IF NOT EXISTS pg_snapshots_operation_id_idx ON snapshots(operation_id);

-- ============================================================================
-- Tasks
-- ============================================================================

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
  last_run TIMESTAMP,
  last_status TEXT,
  next_run TIMESTAMP,
  created_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_tasks_server_id_idx ON tasks(server_id);
CREATE INDEX IF NOT EXISTS pg_tasks_user_id_idx ON tasks(user_id);
CREATE INDEX IF NOT EXISTS pg_tasks_tenant_id_idx ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS pg_tasks_status_idx ON tasks(status);

-- ============================================================================
-- Alert Rules
-- ============================================================================

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  operator TEXT NOT NULL,
  threshold INTEGER NOT NULL,
  severity TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  email_recipients JSONB DEFAULT '[]',
  cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  last_triggered_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_alert_rules_server_id_idx ON alert_rules(server_id);
CREATE INDEX IF NOT EXISTS pg_alert_rules_user_id_idx ON alert_rules(user_id);
CREATE INDEX IF NOT EXISTS pg_alert_rules_enabled_idx ON alert_rules(enabled);

-- ============================================================================
-- Alerts
-- ============================================================================

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  value TEXT,
  threshold TEXT,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_alerts_server_id_idx ON alerts(server_id);
CREATE INDEX IF NOT EXISTS pg_alerts_resolved_idx ON alerts(resolved);

-- ============================================================================
-- Metrics (raw per-minute samples)
-- ============================================================================

CREATE TABLE IF NOT EXISTS metrics (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  cpu_usage INTEGER NOT NULL,
  memory_usage BIGINT NOT NULL,
  memory_total BIGINT NOT NULL,
  disk_usage BIGINT NOT NULL,
  disk_total BIGINT NOT NULL,
  network_in BIGINT NOT NULL,
  network_out BIGINT NOT NULL,
  timestamp TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_metrics_server_id_idx ON metrics(server_id);
CREATE INDEX IF NOT EXISTS pg_metrics_server_timestamp_idx ON metrics(server_id, timestamp);

-- ============================================================================
-- Metrics Hourly (30-day retention)
-- ============================================================================

CREATE TABLE IF NOT EXISTS metrics_hourly (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  cpu_avg INTEGER NOT NULL,
  cpu_min INTEGER NOT NULL,
  cpu_max INTEGER NOT NULL,
  memory_avg BIGINT NOT NULL,
  memory_min BIGINT NOT NULL,
  memory_max BIGINT NOT NULL,
  memory_total BIGINT NOT NULL,
  disk_avg BIGINT NOT NULL,
  disk_min BIGINT NOT NULL,
  disk_max BIGINT NOT NULL,
  disk_total BIGINT NOT NULL,
  network_in_avg BIGINT NOT NULL,
  network_in_max BIGINT NOT NULL,
  network_out_avg BIGINT NOT NULL,
  network_out_max BIGINT NOT NULL,
  sample_count INTEGER NOT NULL,
  bucket_time TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_metrics_hourly_server_id_idx ON metrics_hourly(server_id);
CREATE INDEX IF NOT EXISTS pg_metrics_hourly_server_bucket_idx ON metrics_hourly(server_id, bucket_time);

-- ============================================================================
-- Metrics Daily (1-year retention)
-- ============================================================================

CREATE TABLE IF NOT EXISTS metrics_daily (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  cpu_avg INTEGER NOT NULL,
  cpu_min INTEGER NOT NULL,
  cpu_max INTEGER NOT NULL,
  memory_avg BIGINT NOT NULL,
  memory_min BIGINT NOT NULL,
  memory_max BIGINT NOT NULL,
  memory_total BIGINT NOT NULL,
  disk_avg BIGINT NOT NULL,
  disk_min BIGINT NOT NULL,
  disk_max BIGINT NOT NULL,
  disk_total BIGINT NOT NULL,
  network_in_avg BIGINT NOT NULL,
  network_in_max BIGINT NOT NULL,
  network_out_avg BIGINT NOT NULL,
  network_out_max BIGINT NOT NULL,
  sample_count INTEGER NOT NULL,
  bucket_time TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_metrics_daily_server_id_idx ON metrics_daily(server_id);
CREATE INDEX IF NOT EXISTS pg_metrics_daily_server_bucket_idx ON metrics_daily(server_id, bucket_time);

-- ============================================================================
-- Knowledge Cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS knowledge_cache (
  id TEXT PRIMARY KEY,
  software TEXT NOT NULL,
  platform TEXT NOT NULL,
  content JSONB NOT NULL,
  source TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  last_used TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_knowledge_cache_software_idx ON knowledge_cache(software);
CREATE INDEX IF NOT EXISTS pg_knowledge_cache_platform_idx ON knowledge_cache(platform);
CREATE INDEX IF NOT EXISTS pg_knowledge_cache_sw_plat_idx ON knowledge_cache(software, platform);

-- ============================================================================
-- Audit Logs
-- ============================================================================

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
  audit_warnings JSONB DEFAULT '[]',
  audit_blockers JSONB DEFAULT '[]',
  execution_result TEXT,
  operation_id TEXT,
  created_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_audit_logs_server_id_idx ON audit_logs(server_id);
CREATE INDEX IF NOT EXISTS pg_audit_logs_user_id_idx ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS pg_audit_logs_tenant_id_idx ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS pg_audit_logs_risk_level_idx ON audit_logs(risk_level);
CREATE INDEX IF NOT EXISTS pg_audit_logs_action_idx ON audit_logs(action);
CREATE INDEX IF NOT EXISTS pg_audit_logs_created_at_idx ON audit_logs(created_at);

-- ============================================================================
-- Document Sources
-- ============================================================================

CREATE TABLE IF NOT EXISTS doc_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  software TEXT NOT NULL,
  type TEXT NOT NULL,
  github_config JSONB,
  website_config JSONB,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auto_update BOOLEAN NOT NULL DEFAULT FALSE,
  update_frequency_hours INTEGER DEFAULT 168,
  last_fetched_at TIMESTAMP,
  last_fetch_status TEXT,
  last_fetch_error TEXT,
  document_count INTEGER NOT NULL DEFAULT 0,
  last_sha TEXT,
  last_hash TEXT,
  last_update_time TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_doc_sources_user_id_idx ON doc_sources(user_id);
CREATE INDEX IF NOT EXISTS pg_doc_sources_tenant_id_idx ON doc_sources(tenant_id);
CREATE INDEX IF NOT EXISTS pg_doc_sources_software_idx ON doc_sources(software);
CREATE INDEX IF NOT EXISTS pg_doc_sources_enabled_idx ON doc_sources(enabled);
CREATE INDEX IF NOT EXISTS pg_doc_sources_auto_update_idx ON doc_sources(auto_update);

-- ============================================================================
-- Document Source History
-- ============================================================================

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
  created_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_doc_source_history_source_id_idx ON doc_source_history(source_id);
CREATE INDEX IF NOT EXISTS pg_doc_source_history_user_id_idx ON doc_source_history(user_id);
CREATE INDEX IF NOT EXISTS pg_doc_source_history_created_at_idx ON doc_source_history(created_at);

-- ============================================================================
-- Webhooks
-- ============================================================================

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_retries INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_webhooks_user_id_idx ON webhooks(user_id);
CREATE INDEX IF NOT EXISTS pg_webhooks_tenant_id_idx ON webhooks(tenant_id);
CREATE INDEX IF NOT EXISTS pg_webhooks_enabled_idx ON webhooks(enabled);

-- ============================================================================
-- Webhook Deliveries
-- ============================================================================

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  http_status INTEGER,
  response_body TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP,
  next_retry_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_webhook_deliveries_webhook_id_idx ON webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS pg_webhook_deliveries_status_idx ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS pg_webhook_deliveries_next_retry_idx ON webhook_deliveries(next_retry_at);
CREATE INDEX IF NOT EXISTS pg_webhook_deliveries_created_at_idx ON webhook_deliveries(created_at);

-- ============================================================================
-- Invitations
-- ============================================================================

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  accepted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS pg_invitations_tenant_id_idx ON invitations(tenant_id);
CREATE INDEX IF NOT EXISTS pg_invitations_email_idx ON invitations(email);
CREATE INDEX IF NOT EXISTS pg_invitations_token_idx ON invitations(token);
CREATE INDEX IF NOT EXISTS pg_invitations_status_idx ON invitations(status);
CREATE INDEX IF NOT EXISTS pg_invitations_expires_at_idx ON invitations(expires_at);
