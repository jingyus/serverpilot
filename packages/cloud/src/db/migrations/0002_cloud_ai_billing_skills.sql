-- Cloud: AI usage, routing logs, subscriptions, skill executions
-- Run after 0001_initial_schema.sql

-- ============================================================================
-- AI Usage
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_usage (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC(10,6) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pg_ai_usage_user_id_idx ON ai_usage(user_id);
CREATE INDEX IF NOT EXISTS pg_ai_usage_tenant_id_idx ON ai_usage(tenant_id);
CREATE INDEX IF NOT EXISTS pg_ai_usage_model_idx ON ai_usage(model);
CREATE INDEX IF NOT EXISTS pg_ai_usage_created_at_idx ON ai_usage(created_at);
CREATE INDEX IF NOT EXISTS pg_ai_usage_user_created_idx ON ai_usage(user_id, created_at);

-- ============================================================================
-- AI Routing Logs
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_routing_logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  command TEXT,
  risk_level TEXT,
  conversation_length INTEGER NOT NULL DEFAULT 0,
  selected_model TEXT NOT NULL,
  actual_cost NUMERIC(10,6) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pg_ai_routing_logs_user_id_idx ON ai_routing_logs(user_id);
CREATE INDEX IF NOT EXISTS pg_ai_routing_logs_tenant_id_idx ON ai_routing_logs(tenant_id);
CREATE INDEX IF NOT EXISTS pg_ai_routing_logs_model_idx ON ai_routing_logs(selected_model);
CREATE INDEX IF NOT EXISTS pg_ai_routing_logs_created_at_idx ON ai_routing_logs(created_at);

-- ============================================================================
-- Subscriptions
-- ============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_subscription_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pg_subscriptions_tenant_id_idx ON subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS pg_subscriptions_user_id_idx ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS pg_subscriptions_status_idx ON subscriptions(status);
CREATE INDEX IF NOT EXISTS pg_subscriptions_stripe_customer_id_idx ON subscriptions(stripe_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS pg_subscriptions_stripe_sub_id_idx ON subscriptions(stripe_subscription_id);

-- ============================================================================
-- Skill Executions
-- ============================================================================
CREATE TABLE IF NOT EXISTS skill_executions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  status TEXT NOT NULL,
  report JSONB,
  duration INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pg_skill_executions_tenant_id_idx ON skill_executions(tenant_id);
CREATE INDEX IF NOT EXISTS pg_skill_executions_user_id_idx ON skill_executions(user_id);
CREATE INDEX IF NOT EXISTS pg_skill_executions_created_at_idx ON skill_executions(created_at);
CREATE INDEX IF NOT EXISTS pg_skill_executions_tenant_skill_idx ON skill_executions(tenant_id, skill_name);
