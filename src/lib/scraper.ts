import { VENUES } from "./constants";
import { scrapeVenue, ScrapedSlot } from "./scrapers";
import { proxyManager } from "./proxy-manager";

export type { ScrapedSlot } from "./scrapers";

// Concurrency limit for parallel scraping (rotating proxies = different IP per request)
const CONCURRENCY = parseInt(process.env.SCRAPE_CONCURRENCY || "5");

export async function scrapeAllVenues(date: string): Promise<ScrapedSlot[]> {
  console.log(`🚀 Scraping ${VENUES.length} venues (concurrency: ${CONCURRENCY})`);
  const startTime = Date.now();

  // Scrape all venues in parallel with concurrency limit
  const results = await Promise.allSettled(
    VENUES.map(async (venue, index) => {
      // Stagger start times slightly to avoid thundering herd
      await new Promise((r) => setTimeout(r, index * 200));
      const slots = await scrapeVenue(venue, date);
      console.log(`✅ ${venue.slug}: ${slots.length} slots`);
      return { venue: venue.slug, slots };
    })
  );

  const allSlots: ScrapedSlot[] = [];
  let successCount = 0;

  for (const result of results) {
    if (result.status === "fulfilled") {
      allSlots.push(...result.value.slots);
      successCount++;
    } else {
      console.error(`❌ Scrape failed:`, result.reason);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`📊 Done: ${successCount}/${VENUES.length} venues, ${allSlots.length} slots in ${duration}s`);

  const stats = proxyManager.getStats();
  if (stats.configured) {
    console.log(`📊 Proxy: ${stats.totalRequests} requests`);
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
