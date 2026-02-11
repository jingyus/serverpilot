-- GitHub OAuth accounts (linked identity providers)
CREATE TABLE IF NOT EXISTS `oauth_accounts` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
  `provider` text NOT NULL,
  `provider_account_id` text NOT NULL,
  `provider_username` text,
  `provider_avatar_url` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `oauth_accounts_provider_account_idx` ON `oauth_accounts` (`provider`, `provider_account_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauth_accounts_user_id_idx` ON `oauth_accounts` (`user_id`);
