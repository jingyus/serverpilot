CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`key_hash` text NOT NULL,
	`version` text,
	`last_seen` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_server_id_idx` ON `agents` (`server_id`);--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`value` text,
	`threshold` text,
	`resolved` integer DEFAULT false NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alerts_server_id_idx` ON `alerts` (`server_id`);--> statement-breakpoint
CREATE INDEX `alerts_resolved_idx` ON `alerts` (`resolved`);--> statement-breakpoint
CREATE TABLE `knowledge_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`software` text NOT NULL,
	`platform` text NOT NULL,
	`content` text NOT NULL,
	`source` text NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`last_used` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `knowledge_cache_software_idx` ON `knowledge_cache` (`software`);--> statement-breakpoint
CREATE INDEX `knowledge_cache_platform_idx` ON `knowledge_cache` (`platform`);--> statement-breakpoint
CREATE INDEX `knowledge_cache_software_platform_idx` ON `knowledge_cache` (`software`,`platform`);--> statement-breakpoint
CREATE TABLE `operations` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`session_id` text,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`description` text NOT NULL,
	`commands` text DEFAULT '[]',
	`output` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`risk_level` text DEFAULT 'green' NOT NULL,
	`snapshot_id` text,
	`duration` integer,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `operations_server_id_idx` ON `operations` (`server_id`);--> statement-breakpoint
CREATE INDEX `operations_user_id_idx` ON `operations` (`user_id`);--> statement-breakpoint
CREATE INDEX `operations_session_id_idx` ON `operations` (`session_id`);--> statement-breakpoint
CREATE INDEX `operations_status_idx` ON `operations` (`status`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`os_info` text,
	`software` text DEFAULT '[]',
	`services` text DEFAULT '[]',
	`preferences` text,
	`notes` text DEFAULT '[]',
	`operation_history` text DEFAULT '[]',
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_server_id_unique` ON `profiles` (`server_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_server_id_idx` ON `profiles` (`server_id`);--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'offline' NOT NULL,
	`tags` text DEFAULT '[]',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `servers_user_id_idx` ON `servers` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`server_id` text NOT NULL,
	`messages` text DEFAULT '[]',
	`context` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_server_id_idx` ON `sessions` (`server_id`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`operation_id` text,
	`files` text DEFAULT '[]',
	`configs` text DEFAULT '[]',
	`created_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `snapshots_server_id_idx` ON `snapshots` (`server_id`);--> statement-breakpoint
CREATE INDEX `snapshots_operation_id_idx` ON `snapshots` (`operation_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`cron` text NOT NULL,
	`command` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_run` integer,
	`last_status` text,
	`next_run` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_server_id_idx` ON `tasks` (`server_id`);--> statement-breakpoint
CREATE INDEX `tasks_user_id_idx` ON `tasks` (`user_id`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text,
	`timezone` text DEFAULT 'UTC',
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);