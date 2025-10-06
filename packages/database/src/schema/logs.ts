import { pgTable, varchar, timestamp, integer, text } from 'drizzle-orm/pg-core';
import { venues } from './venues';

export const scrapingLogs = pgTable('scraping_logs', {
  id: varchar('id', { length: 32 }).primaryKey(),
  venueId: varchar('venue_id', { length: 32 }).references(() => venues.id),
  scraperType: varchar('scraper_type', { length: 50 }).notNull(), // 'clubspark', 'courtside'
  status: varchar('status', { length: 20 }).notNull(), // 'success', 'failure', 'partial'
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time'),
  durationMs: integer('duration_ms'),
  slotsFound: integer('slots_found').default(0).notNull(),
  slotsAdded: integer('slots_added').default(0).notNull(),
  slotsUpdated: integer('slots_updated').default(0).notNull(),
  errorMessage: text('error_message'),
  errorStack: text('error_stack'),
  metadata: text('metadata'), // JSON string for additional data
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations will be defined in a separate relations file to avoid circular imports
