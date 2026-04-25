-- Initial schema: all tables in their current final state.
-- Uses IF NOT EXISTS so this is safe to run against both fresh databases
-- and existing databases that were built by older incremental migrations.

CREATE TABLE IF NOT EXISTS `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`email_verified` text,
	`image` text,
	`is_allowed` integer DEFAULT 0,
	`is_admin` integer DEFAULT 0,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `venues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `venues_slug_unique` ON `venues` (`slug`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venue_id` integer NOT NULL,
	`date` text NOT NULL,
	`time` text NOT NULL,
	`court` text NOT NULL,
	`status` text NOT NULL,
	`price` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `slots_venue_id_date_time_court_unique` ON `slots` (`venue_id`,`date`,`time`,`court`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_slots_venue_date_time` ON `slots` (`venue_id`,`date`,`time`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `watches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`venue_id` integer,
	`day_times` text,
	`weekday_times` text,
	`weekend_times` text,
	`active` integer DEFAULT 1,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_watches_user_active` ON `watches` (`user_id`,`active`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notification_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`destination` text NOT NULL,
	`active` integer DEFAULT 1,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `notification_channels_user_id_type_destination_unique` ON `notification_channels` (`user_id`,`type`,`destination`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_channels_user_active` ON `notification_channels` (`user_id`,`active`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `notification_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`channel_id` integer NOT NULL,
	`slot_key` text NOT NULL,
	`sent_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `notification_log_channel_id_slot_key_unique` ON `notification_log` (`channel_id`,`slot_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_log_channel_slot` ON `notification_log` (`channel_id`,`slot_key`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_log_sent_at` ON `notification_log` (`sent_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `registration_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`reason` text,
	`status` text DEFAULT 'pending',
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`reviewed_at` text,
	`reviewed_by` integer,
	FOREIGN KEY (`reviewed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_requests_status` ON `registration_requests` (`status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scrape_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venue_slug` text NOT NULL,
	`date` text NOT NULL,
	`last_scraped_at` text,
	`next_scrape_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verification_tokens` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` text NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
