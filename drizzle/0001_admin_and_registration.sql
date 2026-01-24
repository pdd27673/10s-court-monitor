-- Add isAdmin column to users table
ALTER TABLE `users` ADD COLUMN `is_admin` integer DEFAULT 0;
--> statement-breakpoint
-- Create registration_requests table
CREATE TABLE `registration_requests` (
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
