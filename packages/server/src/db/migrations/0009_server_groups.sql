-- Migration: Add group column to servers table
-- Supports server grouping and label management (task-047)

ALTER TABLE servers ADD COLUMN "group" TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS servers_group_idx ON servers("group");
