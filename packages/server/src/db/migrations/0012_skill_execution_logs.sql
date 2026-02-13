-- Migration: Add skill_execution_logs table for step-level event persistence (skill-079)
-- Stores SSE events (step/log/error/completed/confirmation_required) for replay after disconnect.

CREATE TABLE IF NOT EXISTS skill_execution_logs (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES skill_executions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN ('step', 'log', 'error', 'completed', 'confirmation_required')),
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skill_execution_logs_execution_id_idx ON skill_execution_logs(execution_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skill_execution_logs_event_type_idx ON skill_execution_logs(event_type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS skill_execution_logs_created_at_idx ON skill_execution_logs(created_at);
