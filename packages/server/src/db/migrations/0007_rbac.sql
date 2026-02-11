-- RBAC: Add role column to users table
-- Roles: owner, admin, member (default: member)

ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
--> statement-breakpoint
-- Set existing tenant owners to 'owner' role
UPDATE users SET role = 'owner'
WHERE id IN (SELECT owner_id FROM tenants);
