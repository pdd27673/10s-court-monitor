// Infer types from Drizzle schemas
import { courtSlots, scrapingLogs, venues } from './schema/index.js';

// Database table types
export type Venue = typeof venues.$inferSelect;
export type CourtSlot = typeof courtSlots.$inferSelect;
export type ScrapingLog = typeof scrapingLogs.$inferSelect;

// Insert types (for creating new records)
export type VenueInsert = typeof venues.$inferInsert;
export type CourtSlotInsert = typeof courtSlots.$inferInsert;
export type ScrapingLogInsert = typeof scrapingLogs.$inferInsert;

// Scraping log parameters
export interface ScrapingLogParams {
  venueId: string;
  scraperType: string;
  status: 'success' | 'failure' | 'partial';
  startTime: Date;
  endTime: Date;
  slotsFound: number;
  slotsAdded: number;
  slotsUpdated: number;
  errorMessage?: string;
  errorStack?: string;
}
