-- Webhook notification system: webhooks config + delivery log
CREATE TABLE `webhooks` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `tenant_id` text REFERENCES `tenants`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `url` text NOT NULL,
  `secret` text NOT NULL,
  `events` text NOT NULL,
  `enabled` integer NOT NULL DEFAULT 1,
  `max_retries` integer NOT NULL DEFAULT 3,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhooks_user_id_idx` ON `webhooks` (`user_id`);
--> statement-breakpoint
CREATE INDEX `webhooks_tenant_id_idx` ON `webhooks` (`tenant_id`);
--> statement-breakpoint
CREATE INDEX `webhooks_enabled_idx` ON `webhooks` (`enabled`);
--> statement-breakpoint

CREATE TABLE `webhook_deliveries` (
  `id` text PRIMARY KEY NOT NULL,
  `webhook_id` text NOT NULL REFERENCES `webhooks`(`id`) ON DELETE CASCADE,
  `event_type` text NOT NULL,
  `payload` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `http_status` integer,
  `response_body` text,
  `attempts` integer NOT NULL DEFAULT 0,
  `last_attempt_at` integer,
  `next_retry_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_id_idx` ON `webhook_deliveries` (`webhook_id`);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_status_idx` ON `webhook_deliveries` (`status`);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_next_retry_idx` ON `webhook_deliveries` (`next_retry_at`);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_created_at_idx` ON `webhook_deliveries` (`created_at`);
