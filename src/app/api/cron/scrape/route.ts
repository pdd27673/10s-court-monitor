import { NextResponse } from "next/server";
import { runScheduledScrape } from "@/lib/scrape-scheduler";
import { ensureVenuesExist, storeAndDiff } from "@/lib/differ";
import { notifyUsers, sendScrapeFailureAlert, sendScrapeSummary } from "@/lib/notifiers";
import { db } from "@/lib/db";
import { slots, notificationLog } from "@/lib/schema";
import { lt, sql } from "drizzle-orm";
import { proxyManager, formatBytes } from "@/lib/proxy-manager";
import type { ScrapeStats } from "@/lib/scraper";

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
    console.log("Starting scheduled scrape job...");

    // Ensure all venues exist in DB
    await ensureVenuesExist();

    // Reset proxy stats for this run
    proxyManager.resetStats();
    const startTime = Date.now();

    // Get configured days ahead (default 8)
    const scrapeDays = parseInt(process.env.SCRAPE_DAYS || "8", 10);

    // Run scheduled scrape (only scrapes targets that are due)
    const { slots: allSlots, targetsScraped, targetsSkipped, errors } = await runScheduledScrape(scrapeDays);

    // Build stats for alerting/summary
    const durationMs = Date.now() - startTime;
    const proxyStats = proxyManager.getStats();
    const stats: ScrapeStats = {
      durationMs,
      durationFormatted: `${(durationMs / 1000).toFixed(1)}s`,
      totalRequests: proxyStats.totalRequests,
      totalBytes: proxyStats.totalBytes,
      totalBytesFormatted: formatBytes(proxyStats.totalBytes),
      venuesTotal: targetsScraped + targetsSkipped,
      venuesSuccess: targetsScraped - errors.length,
      venuesFailed: errors.length,
      datesScraped: scrapeDays,
      slotsScraped: allSlots.length,
      failedVenues: errors,
    };

    console.log(`📊 Scrape completed in ${stats.durationFormatted}`);
    console.log(`   ${targetsScraped} targets scraped, ${targetsSkipped} skipped (not due)`);
    console.log(`   ${allSlots.length} slots fetched, ${stats.totalBytesFormatted} transferred`);

    // Only send alerts/summaries if we actually scraped something
    if (targetsScraped > 0) {
      // Check for high failure rate and alert admin
      await sendScrapeFailureAlert(stats);

      // Optionally send scrape summary (if LOG_SCRAPE_SUMMARY=true)
      await sendScrapeSummary(stats);

      // Store slots and detect changes
      const changes = await storeAndDiff(allSlots);
      console.log(`Detected ${changes.length} newly available slots`);

      // Notify users about changes
      if (changes.length > 0) {
        await notifyUsers(changes);
      }
    } else {
      console.log("No targets were due for scraping");
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
