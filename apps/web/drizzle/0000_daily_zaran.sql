CREATE TABLE "user_notification_preferences" (
	"user_id" varchar(32) PRIMARY KEY NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"quiet_hours_start" integer DEFAULT 22,
	"quiet_hours_end" integer DEFAULT 7,
	"max_notifications_per_day" integer DEFAULT 10 NOT NULL,
	"notification_cooldown_minutes" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"clerk_id" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(20),
	"status" varchar(20) DEFAULT 'active',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id")
);
--> statement-breakpoint
CREATE TABLE "court_slots" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"venue_id" varchar(32) NOT NULL,
	"court_name" varchar(100) NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp NOT NULL,
	"price" numeric(8, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'GBP' NOT NULL,
	"booking_url" text NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"scraped_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_venue_preferences" (
	"user_id" varchar(32) NOT NULL,
	"venue_id" varchar(32) NOT NULL,
	"preferred_days" integer[] DEFAULT '{1,2,3,4,5,6,7}',
	"preferred_time_start" integer DEFAULT 6,
	"preferred_time_end" integer DEFAULT 22,
	"max_price_per_hour" numeric(8, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"platform" varchar(50) NOT NULL,
	"base_url" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"scraping_enabled" boolean DEFAULT true NOT NULL,
	"last_scraped_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "notifications_sent" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"user_id" varchar(32) NOT NULL,
	"court_slot_id" varchar(32) NOT NULL,
	"notification_type" varchar(20) NOT NULL,
	"provider" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"cost" numeric(8, 4),
	"error_message" text,
	"provider_message_id" varchar(255),
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scraping_logs" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"venue_id" varchar(32),
	"scraper_type" varchar(50) NOT NULL,
	"status" varchar(20) NOT NULL,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"duration_ms" integer,
	"slots_found" integer DEFAULT 0 NOT NULL,
	"slots_added" integer DEFAULT 0 NOT NULL,
	"slots_updated" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"error_stack" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_slots" ADD CONSTRAINT "court_slots_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_venue_preferences" ADD CONSTRAINT "user_venue_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_venue_preferences" ADD CONSTRAINT "user_venue_preferences_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications_sent" ADD CONSTRAINT "notifications_sent_court_slot_id_court_slots_id_fk" FOREIGN KEY ("court_slot_id") REFERENCES "public"."court_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scraping_logs" ADD CONSTRAINT "scraping_logs_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;