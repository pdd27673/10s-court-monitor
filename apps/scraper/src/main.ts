import puppeteer, { Browser, Page } from 'puppeteer';
import cron from 'node-cron';
import { createDb, type Database, venues } from '@10s/database';
import { eq, and } from 'drizzle-orm';

type Venue = typeof venues.$inferSelect;

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

// Scrape a single venue with retry logic
async function scrapeVenue(venue: typeof venues.$inferSelect): Promise<void> {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let page: Page | null = null;

    try {
      if (!browser) {
        throw new Error('Browser not initialized');
      }

      console.log(`🔍 Scraping ${venue.name} (attempt ${attempt}/${maxRetries})...`);

      page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');

      // Navigate to test URL (will be replaced with actual scraper logic in Task 6)
      await page.goto('https://example.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      const title = await page.title();
      console.log(`✅ ${venue.name}: Page title = "${title}"`);

      // Success - exit retry loop
      return;

    } catch (error) {
      console.error(`❌ ${venue.name} attempt ${attempt} failed:`, error instanceof Error ? error.message : error);

      if (attempt === maxRetries) {
        console.error(`💥 ${venue.name}: Failed after ${maxRetries} attempts`);
      } else {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`⏳ Retrying ${venue.name} in ${delay/1000}s...`);
        await sleep(delay);
      }
    } finally {
      if (page) {
        await page.close().catch(err => console.error('Failed to close page:', err));
      }
    }
  }
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
      try {
        await scrapeVenue(venue);
      } catch (error) {
        console.error(`💥 Failed to scrape ${venue.name}:`, error);
        // Continue with other venues - don't let one failure stop everything
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
    cron.schedule('*/10 * * * *', () => {
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
