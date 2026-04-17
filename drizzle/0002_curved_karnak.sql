CREATE TABLE `scrape_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venue_slug` text NOT NULL,
	`date` text NOT NULL,
	`last_scraped_at` text,
	`next_scrape_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
