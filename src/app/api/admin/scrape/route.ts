import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getNextNDays, runFullScrape } from "@/lib/scraper";
import { ensureVenuesExist, storeAndDiff } from "@/lib/differ";
import { notifyUsers, sendScrapeFailureAlert, sendScrapeSummary } from "@/lib/notifiers";

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
    if (!user[0] || !user[0].isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Run scrape in background
    (async () => {
      try {
        await ensureVenuesExist();

        // Get next N days (configurable via SCRAPE_DAYS env var, default 8)
        const scrapeDays = parseInt(process.env.SCRAPE_DAYS || "8", 10);
        const dates = getNextNDays(scrapeDays);

        // Run full scrape with timing and stats
        const { slots: allSlots, stats } = await runFullScrape(dates);

        // Check for high failure rate and alert admin
        await sendScrapeFailureAlert(stats);

        // Optionally send scrape summary (if LOG_SCRAPE_SUMMARY=true)
        await sendScrapeSummary(stats);

        // Store slots and detect changes
        const changes = await storeAndDiff(allSlots);
        if (changes.length > 0) {
          await notifyUsers(changes);
        }

        console.log("Manual scrape completed successfully");
      } catch (error) {
        console.error("Manual scrape failed:", error);
      }
    })();

    return NextResponse.json({ success: true, message: "Scrape started" });
  } catch (error) {
    console.error("Error starting scrape:", error);
    return NextResponse.json({ error: "Failed to start scrape" }, { status: 500 });
  }
}
