import { NextResponse } from "next/server";
import { getNextNDays } from "@/lib/scraper";
import { scrapeVenue } from "@/lib/scrapers";
import { VENUES } from "@/lib/constants";
import { ensureVenuesExist, storeAndDiff } from "@/lib/differ";
import { notifyUsers } from "@/lib/notifiers";
import type { ScrapedSlot } from "@/lib/scraper";

// Protect the cron endpoint with a secret (skip in development)
const CRON_SECRET = process.env.CRON_SECRET;
const isDev = process.env.NODE_ENV === "development";

async function runScrapeJob() {
  try {
    console.log("Starting scrape job...");

    // Ensure all venues exist in DB
    await ensureVenuesExist();

    // Get next 7 days
    const dates = getNextNDays(7);
    const allSlots: ScrapedSlot[] = [];

    // Scrape all venues for all dates
    for (const venue of VENUES) {
      for (const date of dates) {
        try {
          console.log(`Scraping ${venue.slug} for ${date}...`);
          const slots = await scrapeVenue(venue, date);
          allSlots.push(...slots);
        } catch (error) {
          console.error(`Error scraping ${venue.slug} ${date}:`, error);
        }
      }
    }

    console.log(`Scraped ${allSlots.length} total slots`);

    // Store slots and detect changes
    const changes = await storeAndDiff(allSlots);
    console.log(`Detected ${changes.length} newly available slots`);

    // Notify users about changes
    if (changes.length > 0) {
      await notifyUsers(changes);
    }

    console.log("Scrape job completed successfully");
  } catch (error) {
    console.error("Scrape job failed:", error);
  }
}

export async function POST(request: Request) {
  // Verify cron secret if set (skip in development for easy testing)
  if (CRON_SECRET && !isDev) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Start the scrape job in the background (don't await)
  runScrapeJob().catch((error) => {
    console.error("Unhandled error in scrape job:", error);
  });

  // Return immediately
  return NextResponse.json({
    success: true,
    message: "Scrape job started",
  });
}

// Also support GET for easy testing
export async function GET(request: Request) {
  return POST(request);
}
