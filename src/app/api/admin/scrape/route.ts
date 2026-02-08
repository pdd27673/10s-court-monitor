import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getNextNDays } from "@/lib/scraper";
import { scrapeVenue } from "@/lib/scrapers";
import { VENUES } from "@/lib/constants";
import { ensureVenuesExist, storeAndDiff } from "@/lib/differ";
import { notifyUsers } from "@/lib/notifiers";
import type { ScrapedSlot } from "@/lib/scraper";

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await db.select().from(users).where(eq(users.email, session.user.email.toLowerCase())).limit(1);
    if (!user[0] || !user[0].isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Run scrape in background
    (async () => {
      try {
        await ensureVenuesExist();
        const dates = getNextNDays(8);
        const allSlots: ScrapedSlot[] = [];

        for (const venue of VENUES) {
          for (const date of dates) {
            try {
              const slotsData = await scrapeVenue(venue, date);
              allSlots.push(...slotsData);
            } catch (error) {
              console.error(`Error scraping ${venue.slug} ${date}:`, error);
            }
          }
        }

        const changes = await storeAndDiff(allSlots);
        if (changes.length > 0) {
          await notifyUsers(changes);
        }
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
