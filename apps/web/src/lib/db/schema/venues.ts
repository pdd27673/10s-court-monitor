import { pgTable, varchar, timestamp, boolean, integer, text, decimal } from 'drizzle-orm/pg-core';
import { users } from './users';

export const venues = pgTable('venues', {
  id: varchar('id', { length: 32 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).unique().notNull(),
  platform: varchar('platform', { length: 50 }).notNull(), // 'clubspark' or 'courtside'
  baseUrl: text('base_url').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  scrapingEnabled: boolean('scraping_enabled').default(true).notNull(),
  lastScrapedAt: timestamp('last_scraped_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const userVenuePreferences = pgTable('user_venue_preferences', {
  userId: varchar('user_id', { length: 32 }).references(() => users.id).notNull(),
  venueId: varchar('venue_id', { length: 32 }).references(() => venues.id).notNull(),
  preferredDays: integer('preferred_days').array().default([1, 2, 3, 4, 5, 6, 7]), // 1=Monday, 7=Sunday
  preferredTimeStart: integer('preferred_time_start').default(6),  // 06:00
  preferredTimeEnd: integer('preferred_time_end').default(22),     // 22:00
  maxPricePerHour: decimal('max_price_per_hour', { precision: 8, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const courtSlots = pgTable('court_slots', {
  id: varchar('id', { length: 32 }).primaryKey(),
  venueId: varchar('venue_id', { length: 32 }).references(() => venues.id).notNull(),
  courtName: varchar('court_name', { length: 100 }).notNull(),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  price: decimal('price', { precision: 8, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).default('GBP').notNull(),
  bookingUrl: text('booking_url').notNull(),
  isAvailable: boolean('is_available').default(true).notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(), // SHA256 for change detection
  scrapedAt: timestamp('scraped_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations will be defined in a separate relations file to avoid circular imports
