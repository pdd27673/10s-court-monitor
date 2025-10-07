import { Browser } from 'puppeteer';
import { type Venue } from '@10s/database';

// Re-export shared types
export type { Venue, CourtSlot, ScrapingLogParams } from '@10s/database';

// Scraped court slot (simpler version for scraping, before DB insertion)
export interface ScrapedSlot {
  venueId: string;
  courtName: string;
  startTime: Date;
  endTime: Date;
  price: number;
  currency: string;
  bookingUrl: string;
  isAvailable: boolean;
}

// Raw slot data from page.evaluate() (used internally in scrapers)
export interface RawSlotData {
  venueId: string;
  courtName: string;
  startTime: string;
  endTime: string;
  price: number | null;
  date: string;
  bookingUrl: string;
}

// Raw slot data for Courtside (includes venue name)
export interface RawCourtsideSlotData extends RawSlotData {
  venueName: string;
}

// Scraper function signature
export type ScraperFunction = (
  venue: Venue,
  browser: Browser
) => Promise<ScrapedSlot[]>;
