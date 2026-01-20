import { NextResponse } from "next/server";
import { scrapeVenue, VENUES, getNextNDays } from "@/lib/scraper";
import { ensureVenuesExist, storeAndDiff } from "@/lib/differ";
import { notifyUsers } from "@/lib/notifiers";
import type { ScrapedSlot } from "@/lib/scraper";

// Protect the cron endpoint with a secret (skip in development)
const CRON_SECRET = process.env.CRON_SECRET;
const isDev = process.env.NODE_ENV === "development";

export async function POST(request: Request) {
  // Verify cron secret if set (skip in development for easy testing)
  if (CRON_SECRET && !isDev) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

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
          const slots = await scrapeVenue(venue.slug, date);
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

    return NextResponse.json({
      success: true,
      slotsScraped: allSlots.length,
      changesDetected: changes.length,
      changes: changes.map((c) => ({
        venue: c.venueName,
        date: c.date,
        time: c.time,
        court: c.court,
        price: c.price,
      })),
    });
  } catch (error) {
    console.error("Scrape job failed:", error);
    return NextResponse.json(
      { error: "Scrape failed", details: String(error) },
      { status: 500 }
    );
  }
}

// Also support GET for easy testing
export async function GET(request: Request) {
  return POST(request);
}
