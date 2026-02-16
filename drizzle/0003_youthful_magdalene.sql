-- Migration: Add dayTimes column and cascade deletes
-- This migration adds the day_times column to watches table and updates foreign keys with cascade delete

PRAGMA foreign_keys=OFF;--> statement-breakpoint

-- Clean up orphaned data before migration to prevent foreign key violations
DELETE FROM `notification_log` WHERE `user_id` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `notification_log` WHERE `channel_id` NOT IN (SELECT `id` FROM `notification_channels`);--> statement-breakpoint
DELETE FROM `notification_channels` WHERE `user_id` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `watches` WHERE `user_id` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
DELETE FROM `watches` WHERE `venue_id` IS NOT NULL AND `venue_id` NOT IN (SELECT `id` FROM `venues`);--> statement-breakpoint
DELETE FROM `slots` WHERE `venue_id` NOT IN (SELECT `id` FROM `venues`);--> statement-breakpoint

-- Recreate notification_channels with cascade delete
CREATE TABLE `__new_notification_channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`destination` text NOT NULL,
	`active` integer DEFAULT 1,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_notification_channels`("id", "user_id", "type", "destination", "active") SELECT "id", "user_id", "type", "destination", "active" FROM `notification_channels`;--> statement-breakpoint
DROP TABLE `notification_channels`;--> statement-breakpoint
ALTER TABLE `__new_notification_channels` RENAME TO `notification_channels`;--> statement-breakpoint
CREATE INDEX `idx_channels_user_active` ON `notification_channels` (`user_id`,`active`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_channels_user_id_type_destination_unique` ON `notification_channels` (`user_id`,`type`,`destination`);--> statement-breakpoint

-- Recreate notification_log with cascade delete
CREATE TABLE `__new_notification_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`channel_id` integer NOT NULL,
	`slot_key` text NOT NULL,
	`sent_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_notification_log`("id", "user_id", "channel_id", "slot_key", "sent_at") SELECT "id", "user_id", "channel_id", "slot_key", "sent_at" FROM `notification_log`;--> statement-breakpoint
DROP TABLE `notification_log`;--> statement-breakpoint
ALTER TABLE `__new_notification_log` RENAME TO `notification_log`;--> statement-breakpoint
CREATE INDEX `idx_log_channel_slot` ON `notification_log` (`channel_id`,`slot_key`);--> statement-breakpoint
CREATE INDEX `idx_log_sent_at` ON `notification_log` (`sent_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `notification_log_channel_id_slot_key_unique` ON `notification_log` (`channel_id`,`slot_key`);--> statement-breakpoint

-- Recreate slots with cascade delete
CREATE TABLE `__new_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venue_id` integer NOT NULL,
	`date` text NOT NULL,
	`time` text NOT NULL,
	`court` text NOT NULL,
	`status` text NOT NULL,
	`price` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_slots`("id", "venue_id", "date", "time", "court", "status", "price", "updated_at") SELECT "id", "venue_id", "date", "time", "court", "status", "price", "updated_at" FROM `slots`;--> statement-breakpoint
DROP TABLE `slots`;--> statement-breakpoint
ALTER TABLE `__new_slots` RENAME TO `slots`;--> statement-breakpoint
CREATE INDEX `idx_slots_venue_date_time` ON `slots` (`venue_id`,`date`,`time`);--> statement-breakpoint
CREATE UNIQUE INDEX `slots_venue_id_date_time_court_unique` ON `slots` (`venue_id`,`date`,`time`,`court`);--> statement-breakpoint

-- Recreate watches with day_times column and cascade delete
CREATE TABLE `__new_watches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`venue_id` integer,
	`day_times` text,
	`weekday_times` text,
	`weekend_times` text,
	`active` integer DEFAULT 1,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_watches`("id", "user_id", "venue_id", "weekday_times", "weekend_times", "active") SELECT "id", "user_id", "venue_id", "weekday_times", "weekend_times", "active" FROM `watches`;--> statement-breakpoint
DROP TABLE `watches`;--> statement-breakpoint
ALTER TABLE `__new_watches` RENAME TO `watches`;--> statement-breakpoint
CREATE INDEX `idx_watches_user_active` ON `watches` (`user_id`,`active`);--> statement-breakpoint

-- Create index on registration_requests
CREATE INDEX IF NOT EXISTS `idx_requests_status` ON `registration_requests` (`status`);--> statement-breakpoint

-- Re-enable foreign keys
PRAGMA foreign_keys=ON;--> statement-breakpoint

-- Migrate existing watch data from weekday_times/weekend_times to day_times format
-- Only for watches that have old format data but no day_times
UPDATE `watches`
SET `day_times` = json_object(
  'monday', COALESCE(json(`weekday_times`), json('[]')),
  'tuesday', COALESCE(json(`weekday_times`), json('[]')),
  'wednesday', COALESCE(json(`weekday_times`), json('[]')),
  'thursday', COALESCE(json(`weekday_times`), json('[]')),
  'friday', COALESCE(json(`weekday_times`), json('[]')),
  'saturday', COALESCE(json(`weekend_times`), json('[]')),
  'sunday', COALESCE(json(`weekend_times`), json('[]'))
)
WHERE `day_times` IS NULL AND (`weekday_times` IS NOT NULL OR `weekend_times` IS NOT NULL);
