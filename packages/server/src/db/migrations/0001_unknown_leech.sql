CREATE TABLE `alert_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`metric_type` text NOT NULL,
	`operator` text NOT NULL,
	`threshold` integer NOT NULL,
	`severity` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`email_recipients` text DEFAULT '[]',
	`cooldown_minutes` integer DEFAULT 30 NOT NULL,
	`last_triggered_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alert_rules_server_id_idx` ON `alert_rules` (`server_id`);--> statement-breakpoint
CREATE INDEX `alert_rules_user_id_idx` ON `alert_rules` (`user_id`);--> statement-breakpoint
CREATE INDEX `alert_rules_enabled_idx` ON `alert_rules` (`enabled`);--> statement-breakpoint
CREATE TABLE `doc_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`software` text NOT NULL,
	`type` text NOT NULL,
	`github_config` text,
	`website_config` text,
	`enabled` integer DEFAULT true NOT NULL,
	`auto_update` integer DEFAULT false NOT NULL,
	`update_frequency_hours` integer DEFAULT 168,
	`last_fetched_at` integer,
	`last_fetch_status` text,
	`last_fetch_error` text,
	`document_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `doc_sources_user_id_idx` ON `doc_sources` (`user_id`);--> statement-breakpoint
CREATE INDEX `doc_sources_software_idx` ON `doc_sources` (`software`);--> statement-breakpoint
CREATE INDEX `doc_sources_enabled_idx` ON `doc_sources` (`enabled`);--> statement-breakpoint
CREATE INDEX `doc_sources_auto_update_idx` ON `doc_sources` (`auto_update`);--> statement-breakpoint
CREATE TABLE `metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`cpu_usage` integer NOT NULL,
	`memory_usage` integer NOT NULL,
	`memory_total` integer NOT NULL,
	`disk_usage` integer NOT NULL,
	`disk_total` integer NOT NULL,
	`network_in` integer NOT NULL,
	`network_out` integer NOT NULL,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `metrics_server_id_idx` ON `metrics` (`server_id`);--> statement-breakpoint
CREATE INDEX `metrics_server_timestamp_idx` ON `metrics` (`server_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ai_provider` text NOT NULL,
	`notifications` text NOT NULL,
	`knowledge_base` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_idx` ON `user_settings` (`user_id`);--> statement-breakpoint
ALTER TABLE `operations` ADD `input_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `operations` ADD `output_tokens` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `history_summary` text;