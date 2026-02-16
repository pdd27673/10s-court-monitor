import { VENUES, Venue } from "./constants";
import { scrapeVenue, ScrapedSlot } from "./scrapers";
import { proxyManager, formatBytes } from "./proxy-manager";

export type { ScrapedSlot } from "./scrapers";

export interface ScrapeStats {
  durationMs: number;
  durationFormatted: string;
  totalRequests: number;
  totalBytes: number;
  totalBytesFormatted: string;
  venuesTotal: number;
  venuesSuccess: number;
  venuesFailed: number;
  datesScraped: number;
  slotsScraped: number;
  failedVenues: string[];
}

export interface ScrapeResult {
  slots: ScrapedSlot[];
  stats: ScrapeStats;
}

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

/**
 * Run a full scrape job with comprehensive timing and stats.
 * Scrapes all venues for the given dates in parallel.
 */
export async function runFullScrape(dates: string[]): Promise<ScrapeResult> {
  const startTime = Date.now();
  proxyManager.resetStats();

  console.log(`🚀 Starting full scrape: ${VENUES.length} venues × ${dates.length} dates`);

  const allSlots: ScrapedSlot[] = [];
  const failedVenues: string[] = [];
  let successCount = 0;
  let failCount = 0;

  // Create all venue-date combinations
  const tasks: { venue: Venue; date: string }[] = [];
  for (const venue of VENUES) {
    for (const date of dates) {
      tasks.push({ venue, date });
    }
  }

  // Scrape all venue-date combinations in parallel
  const results = await Promise.allSettled(
    tasks.map(async ({ venue, date }, index) => {
      // Stagger start times slightly to avoid thundering herd
      await new Promise((r) => setTimeout(r, index * 100));
      const slots = await scrapeVenue(venue, date);
      return { venue: venue.slug, date, slots };
    })
  );

  // Process results
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const { venue, date } = tasks[i];

    if (result.status === "fulfilled") {
      allSlots.push(...result.value.slots);
      successCount++;
    } else {
      failCount++;
      const venueDate = `${venue.slug}:${date}`;
      if (!failedVenues.includes(venueDate)) {
        failedVenues.push(venueDate);
      }
      console.error(`❌ ${venue.slug} ${date}:`, result.reason);
    }
  }

  const durationMs = Date.now() - startTime;
  const proxyStats = proxyManager.getStats();

  const stats: ScrapeStats = {
    durationMs,
    durationFormatted: `${(durationMs / 1000).toFixed(1)}s`,
    totalRequests: proxyStats.totalRequests,
    totalBytes: proxyStats.totalBytes,
    totalBytesFormatted: formatBytes(proxyStats.totalBytes),
    venuesTotal: VENUES.length,
    venuesSuccess: successCount,
    venuesFailed: failCount,
    datesScraped: dates.length,
    slotsScraped: allSlots.length,
    failedVenues,
  };

  // Log summary
  console.log(`📊 Scrape completed in ${stats.durationFormatted}`);
  console.log(`   ${successCount}/${tasks.length} venue-dates succeeded`);
  console.log(`   ${allSlots.length} slots scraped`);
  console.log(`   ${stats.totalBytesFormatted} transferred (${proxyStats.totalRequests} requests)`);

  if (failedVenues.length > 0) {
    console.log(`   ⚠️  ${failedVenues.length} failures: ${failedVenues.slice(0, 5).join(", ")}${failedVenues.length > 5 ? "..." : ""}`);
  }

  return { slots: allSlots, stats };
}
