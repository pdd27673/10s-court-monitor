import 'dotenv/config';
import puppeteer, { Browser, Page } from 'puppeteer';
import cron from 'node-cron';
import { createDb, type Database, venues } from '@10s/database';
import { eq, and } from 'drizzle-orm';
import { type Venue, type ScrapedSlot, type ScraperFunction } from './types';
import { scrapeClubSpark } from './scrapers/clubspark';
import { scrapeCourtside } from './scrapers/courtside';
import { storeCourtData, logScrapingRun } from './lib/data-pipeline';

// Type-safe scraper dispatcher
const scraperDispatcher: Record<string, ScraperFunction> = {
  clubspark: scrapeClubSpark,
  courtside: scrapeCourtside,
};

// Global instances
let browser: Browser | null = null;
let db: Database;

// Initialize database
function initDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  db = createDb(process.env.DATABASE_URL);
  console.log('✅ Database connected');
}

// Initialize Puppeteer browser with retry logic
async function initBrowser(): Promise<Browser> {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔧 Initializing browser (attempt ${attempt}/${maxRetries})...`);

      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      });

      console.log('✅ Browser initialized successfully');
      return browser;
    } catch (error) {
      console.error(`❌ Browser init attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        throw new Error('Failed to initialize browser after max retries');
      }

      // Exponential backoff: 2s, 4s, 8s
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`⏳ Retrying in ${delay/1000}s...`);
      await sleep(delay);
    }
  }

  throw new Error('Browser initialization failed');
}

// Scrape a single venue with retry logic using type-safe dispatcher
async function scrapeVenue(venue: Venue): Promise<ScrapedSlot[]> {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (!browser) {
        throw new Error('Browser not initialized');
      }

      console.log(`🔍 Scraping ${venue.name} (attempt ${attempt}/${maxRetries})...`);

      // Get the appropriate scraper function for this venue's platform
      const scraperFn = scraperDispatcher[venue.platform];

      if (!scraperFn) {
        console.error(`❌ ${venue.name}: No scraper found for platform "${venue.platform}"`);
        return [];
      }

      // Call the platform-specific scraper
      const slots = await scraperFn(venue, browser);

      console.log(`✅ ${venue.name}: Found ${slots.length} available slots`);

      // Success - exit retry loop
      return slots;

    } catch (error) {
      console.error(`❌ ${venue.name} attempt ${attempt} failed:`, error instanceof Error ? error.message : error);

      if (attempt === maxRetries) {
        console.error(`💥 ${venue.name}: Failed after ${maxRetries} attempts`);
        return [];
      } else {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`⏳ Retrying ${venue.name} in ${delay/1000}s...`);
        await sleep(delay);
      }
    }
  }

  return [];
}

// Main scraping cycle
async function runScrapingCycle(): Promise<void> {
  console.log(`\n🎾 Starting scraping cycle at ${new Date().toISOString()}`);

  try {
    // Ensure browser is initialized
    if (!browser) {
      await initBrowser();
    }

    // Fetch active venues from database
    const activeVenues = await db.select().from(venues).where(
      and(
        eq(venues.isActive, true),
        eq(venues.scrapingEnabled, true)
      )
    );

    console.log(`📍 Found ${activeVenues.length} active venues to scrape`);

    // Process each venue with isolated error handling
    for (const venue of activeVenues) {
      const startTime = new Date();
      let status: 'success' | 'failure' | 'partial' = 'success';
      let errorMessage: string | undefined;
      let errorStack: string | undefined;
      let slotsFound = 0;
      let slotsAdded = 0;
      let slotsUpdated = 0;

      try {
        const slots = await scrapeVenue(venue);
        slotsFound = slots.length;

        if (slots.length > 0) {
          console.log(`📊 ${venue.name}: Processing ${slots.length} slots...`);

          // Store slots and get newly inserted ones
          const newSlots = await storeCourtData(db, slots);
          slotsAdded = newSlots.length;
          slotsUpdated = slots.length - newSlots.length;

          if (newSlots.length > 0) {
            console.log(`🆕 ${venue.name}: ${newSlots.length} new slots available!`);
            // TODO: Trigger notifications for new slots (Task 8)
            // await notifyUsers(newSlots);
          }
        } else {
          console.log(`📭 ${venue.name}: No available slots found`);
        }
      } catch (error) {
        status = 'failure';
        errorMessage = error instanceof Error ? error.message : String(error);
        errorStack = error instanceof Error ? error.stack : undefined;
        console.error(`💥 Failed to scrape ${venue.name}:`, error);
        // Continue with other venues - don't let one failure stop everything
      } finally {
        const endTime = new Date();

        // Log the scraping run
        await logScrapingRun(db, {
          venueId: venue.id,
          scraperType: venue.platform,
          status,
          startTime,
          endTime,
          slotsFound,
          slotsAdded,
          slotsUpdated,
          errorMessage,
          errorStack,
        });
      }
    }

    console.log(`✅ Scraping cycle completed`);

  } catch (error) {
    console.error('❌ Scraping cycle failed:', error);
    // Attempt to restart browser on total failure
    browser = null;
  }
}

// Utility: sleep
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.log('\n🛑 Shutting down...');

  if (browser) {
    await browser.close();
  }

  process.exit(0);
}

// Main entry point
async function main(): Promise<void> {
  console.log('🚀 Tennis Court Scraper Service Starting...');

  try {
    // Initialize database
    initDb();

    // Initialize browser
    await initBrowser();

    // Schedule cron job for every 10 minutes
    cron.schedule('*/5 * * * *', () => {
      runScrapingCycle().catch(err => console.error('Cron job error:', err));
    });

    console.log('⏰ Cron job scheduled: every 10 minutes');

    // Run initial scrape immediately
    await runScrapingCycle();

    // Set up graceful shutdown
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

// Start the service
main();
