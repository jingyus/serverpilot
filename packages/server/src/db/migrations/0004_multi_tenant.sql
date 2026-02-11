-- Multi-tenant data isolation: add tenants table and tenant_id columns
-- Phase 4 cloud version foundation (task-032)

CREATE TABLE `tenants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`owner_id` text NOT NULL,
	`plan` text NOT NULL DEFAULT 'free',
	`max_servers` integer NOT NULL DEFAULT 5,
	`max_users` integer NOT NULL DEFAULT 1,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tenants_slug_idx` ON `tenants` (`slug`);--> statement-breakpoint
CREATE INDEX `tenants_owner_id_idx` ON `tenants` (`owner_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text,
	`command` text NOT NULL,
	`risk_level` text NOT NULL,
	`reason` text NOT NULL,
	`matched_pattern` text,
	`action` text NOT NULL,
	`audit_warnings` text DEFAULT '[]',
	`audit_blockers` text DEFAULT '[]',
	`execution_result` text,
	`operation_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_server_id_idx` ON `audit_logs` (`server_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_user_id_idx` ON `audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_risk_level_idx` ON `audit_logs` (`risk_level`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_action_idx` ON `audit_logs` (`action`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `audit_logs_created_at_idx` ON `audit_logs` (`created_at`);--> statement-breakpoint
ALTER TABLE `users` ADD `tenant_id` text REFERENCES `tenants`(`id`) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `users_tenant_id_idx` ON `users` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `servers` ADD `tenant_id` text REFERENCES `tenants`(`id`) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `servers_tenant_id_idx` ON `servers` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `operations` ADD `tenant_id` text REFERENCES `tenants`(`id`) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `operations_tenant_id_idx` ON `operations` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `tenant_id` text REFERENCES `tenants`(`id`) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `tasks_tenant_id_idx` ON `tasks` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `audit_logs` ADD `tenant_id` text REFERENCES `tenants`(`id`) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `audit_logs_tenant_id_idx` ON `audit_logs` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `doc_sources` ADD `tenant_id` text REFERENCES `tenants`(`id`) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX `doc_sources_tenant_id_idx` ON `doc_sources` (`tenant_id`);
