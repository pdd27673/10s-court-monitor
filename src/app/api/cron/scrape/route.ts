import { NextResponse } from "next/server";
import { getNextNDays } from "@/lib/scraper";
import { scrapeVenue } from "@/lib/scrapers";
import { VENUES } from "@/lib/constants";
import { ensureVenuesExist, storeAndDiff } from "@/lib/differ";
import { notifyUsers } from "@/lib/notifiers";
import type { ScrapedSlot } from "@/lib/scraper";
import { db } from "@/lib/db";
import { slots, notificationLog } from "@/lib/schema";
import { lt, sql } from "drizzle-orm";

// Protect the cron endpoint with a secret (skip in development)
const CRON_SECRET = process.env.CRON_SECRET;
const isDev = process.env.NODE_ENV === "development";

async function runCleanup() {
  try {
    console.log("Running cleanup...");

    // Keep data for 7 days (can be configured)
    const daysToKeep = parseInt(process.env.CLEANUP_DAYS || "7", 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoff = cutoffDate.toISOString().split("T")[0];

    // Delete old slots
    const deletedSlots = await db.delete(slots).where(lt(slots.date, cutoff)).returning();
    console.log(`Deleted ${deletedSlots.length} old slots (before ${cutoff})`);

    // Delete old notification logs
    const deletedLogs = await db.delete(notificationLog).where(lt(notificationLog.sentAt, cutoff)).returning();
    console.log(`Deleted ${deletedLogs.length} old notification logs`);

    // Vacuum database to reclaim space
    db.run(sql`VACUUM`);
    console.log("Database vacuumed");
  } catch (error) {
    console.error("Cleanup failed:", error);
  }
}

async function runScrapeJob() {
  try {
    console.log("Starting scrape job...");

    // Ensure all venues exist in DB
    await ensureVenuesExist();

    // Get next 7 days
    const dates = getNextNDays(8);
    const allSlots: ScrapedSlot[] = [];

    // Scrape all venues for all dates
    for (const venue of VENUES) {
      for (const date of dates) {
        try {
          console.log(`Scraping ${venue.slug} for ${date}...`);
          const slotsData = await scrapeVenue(venue, date);
          allSlots.push(...slotsData);
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

    // Run cleanup after scraping
    await runCleanup();

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
