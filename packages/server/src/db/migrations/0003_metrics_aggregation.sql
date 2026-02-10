CREATE TABLE `metrics_hourly` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL REFERENCES servers(`id`) ON DELETE CASCADE,
	`cpu_avg` integer NOT NULL,
	`cpu_min` integer NOT NULL,
	`cpu_max` integer NOT NULL,
	`memory_avg` integer NOT NULL,
	`memory_min` integer NOT NULL,
	`memory_max` integer NOT NULL,
	`memory_total` integer NOT NULL,
	`disk_avg` integer NOT NULL,
	`disk_min` integer NOT NULL,
	`disk_max` integer NOT NULL,
	`disk_total` integer NOT NULL,
	`network_in_avg` integer NOT NULL,
	`network_in_max` integer NOT NULL,
	`network_out_avg` integer NOT NULL,
	`network_out_max` integer NOT NULL,
	`sample_count` integer NOT NULL,
	`bucket_time` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metrics_hourly_server_id_idx` ON `metrics_hourly` (`server_id`);
--> statement-breakpoint
CREATE INDEX `metrics_hourly_server_bucket_idx` ON `metrics_hourly` (`server_id`, `bucket_time`);
--> statement-breakpoint
CREATE TABLE `metrics_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL REFERENCES servers(`id`) ON DELETE CASCADE,
	`cpu_avg` integer NOT NULL,
	`cpu_min` integer NOT NULL,
	`cpu_max` integer NOT NULL,
	`memory_avg` integer NOT NULL,
	`memory_min` integer NOT NULL,
	`memory_max` integer NOT NULL,
	`memory_total` integer NOT NULL,
	`disk_avg` integer NOT NULL,
	`disk_min` integer NOT NULL,
	`disk_max` integer NOT NULL,
	`disk_total` integer NOT NULL,
	`network_in_avg` integer NOT NULL,
	`network_in_max` integer NOT NULL,
	`network_out_avg` integer NOT NULL,
	`network_out_max` integer NOT NULL,
	`sample_count` integer NOT NULL,
	`bucket_time` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `metrics_daily_server_id_idx` ON `metrics_daily` (`server_id`);
--> statement-breakpoint
CREATE INDEX `metrics_daily_server_bucket_idx` ON `metrics_daily` (`server_id`, `bucket_time`);
