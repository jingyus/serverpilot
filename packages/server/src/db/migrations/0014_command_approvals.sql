-- Migration: Add command_approvals table for dangerous command approval workflow
-- Purpose: Enable users to approve/reject dangerous commands (RED/CRITICAL risk level)
-- Date: 2026-02-20

-- Command approvals table
CREATE TABLE IF NOT EXISTS command_approvals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  command TEXT NOT NULL,
  risk_level TEXT NOT NULL,  -- 'red' | 'critical' | 'forbidden'
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected' | 'expired'
  reason TEXT,               -- Why this command is risky
  warnings TEXT,             -- JSON array of warning messages
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,  -- Auto-expire after 5 minutes
  decided_at INTEGER,
  decided_by TEXT,           -- User who approved/rejected
  execution_context TEXT,    -- JSON: taskId, operationId, sessionId
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS command_approvals_user_id_idx ON command_approvals(user_id);
CREATE INDEX IF NOT EXISTS command_approvals_server_id_idx ON command_approvals(server_id);
CREATE INDEX IF NOT EXISTS command_approvals_status_idx ON command_approvals(status);
CREATE INDEX IF NOT EXISTS command_approvals_expires_at_idx ON command_approvals(expires_at);
