CREATE TABLE `doc_source_history` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`user_id` text NOT NULL,
	`change_type` text NOT NULL,
	`previous_version` text,
	`current_version` text,
	`status` text NOT NULL,
	`error` text,
	`document_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `doc_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `doc_source_history_source_id_idx` ON `doc_source_history` (`source_id`);--> statement-breakpoint
CREATE INDEX `doc_source_history_user_id_idx` ON `doc_source_history` (`user_id`);--> statement-breakpoint
CREATE INDEX `doc_source_history_created_at_idx` ON `doc_source_history` (`created_at`);--> statement-breakpoint
ALTER TABLE `doc_sources` ADD `last_sha` text;--> statement-breakpoint
ALTER TABLE `doc_sources` ADD `last_hash` text;--> statement-breakpoint
ALTER TABLE `doc_sources` ADD `last_update_time` integer;