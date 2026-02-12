-- Migration: Add skill tables for the Skill plugin system
-- Supports installed skills registry, execution history, and per-skill KV store (skill-001)

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
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS installed_skills_user_id_idx ON installed_skills(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS installed_skills_tenant_id_idx ON installed_skills(tenant_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS installed_skills_name_idx ON installed_skills(name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS installed_skills_status_idx ON installed_skills(status);
--> statement-breakpoint

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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skill_executions_skill_id_idx ON skill_executions(skill_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skill_executions_server_id_idx ON skill_executions(server_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skill_executions_user_id_idx ON skill_executions(user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skill_executions_status_idx ON skill_executions(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skill_executions_started_at_idx ON skill_executions(started_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS skill_store (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES installed_skills(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS skill_store_skill_key_idx ON skill_store(skill_id, key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skill_store_skill_id_idx ON skill_store(skill_id);
