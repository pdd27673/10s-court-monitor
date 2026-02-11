import { VENUES } from "./constants";
import { scrapeVenue, ScrapedSlot } from "./scrapers";
import { proxyManager } from "./proxy-manager";

export type { ScrapedSlot } from "./scrapers";

// Random delay helper to avoid pattern detection
const randomDelay = (min: number, max: number) =>
  new Promise((resolve) =>
    setTimeout(resolve, Math.random() * (max - min) + min)
  );

export async function scrapeAllVenues(date: string): Promise<ScrapedSlot[]> {
  const allSlots: ScrapedSlot[] = [];

  const delayMin = parseInt(process.env.VENUE_DELAY_MIN || "2000");
  const delayMax = parseInt(process.env.VENUE_DELAY_MAX || "6000");

  for (let i = 0; i < VENUES.length; i++) {
    const venue = VENUES[i];

    try {
      const slots = await scrapeVenue(venue, date);
      allSlots.push(...slots);

      // Random delay between venues (skip after last venue)
      if (i < VENUES.length - 1) {
        const delay = Math.random() * (delayMax - delayMin) + delayMin;
        console.log(
          `⏳ Waiting ${Math.round(delay / 1000)}s before next venue...`
        );
        await randomDelay(delayMin, delayMax);
      }
    } catch (error) {
      console.error(`Error scraping ${venue.slug}:`, error);
    }
  }

  // Log proxy stats at the end
  const stats = proxyManager.getStats();
  if (stats.configured) {
    console.log(`📊 Proxy stats: ${stats.totalSessions} sessions, ${stats.totalRequests} requests`);
  }

  return allSlots;
}

export function getNextNDays(n: number): string[] {
  const dates: string[] = [];
  const today = new Date();

  for (let i = 0; i < n; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    dates.push(date.toISOString().split("T")[0]);
  }

  return dates;
}
