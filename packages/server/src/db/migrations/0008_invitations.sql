-- Migration: 0008_invitations
-- Description: Add invitations table for team member invite workflow
-- Date: 2026-02-11

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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invitations_tenant_id_idx ON invitations(tenant_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invitations_email_idx ON invitations(email);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invitations_token_idx ON invitations(token);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invitations_status_idx ON invitations(status);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS invitations_expires_at_idx ON invitations(expires_at);
