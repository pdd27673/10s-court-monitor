import { db } from "./db";
import { scrapeTargets } from "./schema";
import { VENUES, Venue } from "./constants";
import { scrapeVenue, ScrapedSlot } from "./scrapers";
import { eq, and, lt, lte, isNull, or } from "drizzle-orm";

/**
 * Scrape Scheduler - Tiered frequency based on day offset
 *
 * Day 0 (today):    10 min until 6pm, then 4 hours (stop after 6pm)
 * Day 1 (tomorrow): 10 min (highest frequency)
 * Day 2:            20 min (half of day 1)
 * Day 3:            40 min (half of day 2)
 * Days 4-7:         60 min (once an hour)
 */

// Frequency in minutes for each day offset
const SCRAPE_INTERVALS: Record<number, number> = {
  0: 10, // Today: 10 min (but stop after 6pm)
  1: 10, // Tomorrow: highest frequency
  2: 20, // Half of day 1
  3: 40, // Half of day 2
  4: 60, // Once an hour
  5: 60,
  6: 60,
  7: 60,
};

// After this hour (local time), day 0 switches to 4-hour intervals
const DAY0_CUTOFF_HOUR = 18; // 6pm
const DAY0_AFTER_CUTOFF_INTERVAL = 240; // 4 hours in minutes

export interface ScrapeScheduleResult {
  venue: Venue;
  date: string;
  dayOffset: number;
  intervalMinutes: number;
}

export interface ScheduledScrapeResult {
  slots: ScrapedSlot[];
  targetsScraped: number;
  targetsSkipped: number;
  errors: string[];
}

/**
 * Get the scrape interval for a given day offset and current hour
 */
export function getScrapeInterval(dayOffset: number, currentHour: number): number {
  // Day 0 after 6pm: switch to 4-hour intervals
  if (dayOffset === 0 && currentHour >= DAY0_CUTOFF_HOUR) {
    return DAY0_AFTER_CUTOFF_INTERVAL;
  }

  // Use defined interval or default to 60 min for far future dates
  return SCRAPE_INTERVALS[dayOffset] ?? 60;
}

/**
 * Calculate the day offset from today for a given date string
 */
export function getDayOffset(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetDate = new Date(dateStr);
  targetDate.setHours(0, 0, 0, 0);

  const diffMs = targetDate.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get all dates for the next N days (including today)
 */
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
 * Ensure scrape targets exist for all venue-date combinations
 */
export async function ensureScrapeTargets(dates: string[]): Promise<void> {
  for (const venue of VENUES) {
    for (const date of dates) {
      // Check if target exists
      const existing = await db
        .select()
        .from(scrapeTargets)
        .where(and(eq(scrapeTargets.venueSlug, venue.slug), eq(scrapeTargets.date, date)))
        .limit(1);

      if (existing.length === 0) {
        // Create new target - immediately due for scraping
        await db.insert(scrapeTargets).values({
          venueSlug: venue.slug,
          date,
          lastScrapedAt: null,
          nextScrapeAt: new Date().toISOString(), // Due now
        });
      }
    }
  }
}

/**
 * Get all scrape targets that are due for scraping
 */
export async function getDueScrapeTargets(): Promise<ScrapeScheduleResult[]> {
  const now = new Date();
  const currentHour = now.getHours();
  const nowIso = now.toISOString();

  // Get targets where nextScrapeAt <= now OR nextScrapeAt is null
  const dueTargets = await db
    .select()
    .from(scrapeTargets)
    .where(or(lte(scrapeTargets.nextScrapeAt, nowIso), isNull(scrapeTargets.nextScrapeAt)));

  const results: ScrapeScheduleResult[] = [];

  for (const target of dueTargets) {
    const dayOffset = getDayOffset(target.date);

    // Skip dates in the past
    if (dayOffset < 0) continue;

    // Skip day 0 after 6pm entirely (unless it's a 4-hour check)
    // Actually, we still scrape but at 4-hour intervals
    const venue = VENUES.find((v) => v.slug === target.venueSlug);
    if (!venue) continue;

    const intervalMinutes = getScrapeInterval(dayOffset, currentHour);

    results.push({
      venue,
      date: target.date,
      dayOffset,
      intervalMinutes,
    });
  }

  return results;
}

/**
 * Mark a scrape target as scraped and calculate next scrape time
 */
export async function markTargetScraped(venueSlug: string, date: string): Promise<void> {
  const now = new Date();
  const currentHour = now.getHours();
  const dayOffset = getDayOffset(date);
  const intervalMinutes = getScrapeInterval(dayOffset, currentHour);

  const nextScrapeAt = new Date(now.getTime() + intervalMinutes * 60 * 1000);

  await db
    .update(scrapeTargets)
    .set({
      lastScrapedAt: now.toISOString(),
      nextScrapeAt: nextScrapeAt.toISOString(),
    })
    .where(and(eq(scrapeTargets.venueSlug, venueSlug), eq(scrapeTargets.date, date)));
}

/**
 * Clean up old scrape targets (dates in the past)
 */
export async function cleanupOldTargets(): Promise<number> {
  const today = new Date().toISOString().split("T")[0];

  const deleted = await db
    .delete(scrapeTargets)
    .where(lt(scrapeTargets.date, today))
    .returning();

  return deleted.length;
}

/**
 * Main scraping function - scrapes only targets that are due
 * Call this from the cron job (every 10 minutes)
 */
export async function runScheduledScrape(daysAhead: number = 8): Promise<ScheduledScrapeResult> {
  const dates = getNextNDays(daysAhead);

  // Ensure all targets exist
  await ensureScrapeTargets(dates);

  // Get targets that are due
  const dueTargets = await getDueScrapeTargets();

  console.log(`📅 Scheduled scrape: ${dueTargets.length} targets due`);

  if (dueTargets.length === 0) {
    return {
      slots: [],
      targetsScraped: 0,
      targetsSkipped: VENUES.length * dates.length,
      errors: [],
    };
  }

  // Log what we're scraping
  const byDay = dueTargets.reduce(
    (acc, t) => {
      acc[t.dayOffset] = (acc[t.dayOffset] || 0) + 1;
      return acc;
    },
    {} as Record<number, number>
  );
  console.log(`   By day offset: ${Object.entries(byDay).map(([d, c]) => `Day ${d}: ${c}`).join(", ")}`);

  const allSlots: ScrapedSlot[] = [];
  const errors: string[] = [];

  // Scrape all due targets
  const results = await Promise.allSettled(
    dueTargets.map(async ({ venue, date }, index) => {
      // Stagger requests slightly
      await new Promise((r) => setTimeout(r, index * 100));

      const slots = await scrapeVenue(venue, date);
      await markTargetScraped(venue.slug, date);

      console.log(`   ✅ ${venue.slug} ${date}: ${slots.length} slots`);
      return { venue: venue.slug, date, slots };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const target = dueTargets[i];

    if (result.status === "fulfilled") {
      allSlots.push(...result.value.slots);
    } else {
      const error = `${target.venue.slug} ${target.date}: ${result.reason}`;
      errors.push(error);
      console.error(`   ❌ ${error}`);
      // Still mark as scraped to avoid retrying immediately
      await markTargetScraped(target.venue.slug, target.date);
    }
  }

  // Cleanup old targets
  const cleanedUp = await cleanupOldTargets();
  if (cleanedUp > 0) {
    console.log(`   🧹 Cleaned up ${cleanedUp} old targets`);
  }

  return {
    slots: allSlots,
    targetsScraped: dueTargets.length,
    targetsSkipped: VENUES.length * dates.length - dueTargets.length,
    errors,
  };
}

/**
 * Get current scraping status for debugging/monitoring
 */
export async function getScrapeStatus(): Promise<{
  totalTargets: number;
  dueNow: number;
  byDayOffset: Record<number, { total: number; due: number }>;
}> {
  const now = new Date();
  const nowIso = now.toISOString();

  const allTargets = await db.select().from(scrapeTargets);

  const byDayOffset: Record<number, { total: number; due: number }> = {};

  for (const target of allTargets) {
    const dayOffset = getDayOffset(target.date);
    if (dayOffset < 0) continue;

    if (!byDayOffset[dayOffset]) {
      byDayOffset[dayOffset] = { total: 0, due: 0 };
    }

    byDayOffset[dayOffset].total++;

    const isDue = !target.nextScrapeAt || target.nextScrapeAt <= nowIso;
    if (isDue) {
      byDayOffset[dayOffset].due++;
    }
  }

  const dueNow = allTargets.filter((t) => !t.nextScrapeAt || t.nextScrapeAt <= nowIso).length;

  return {
    totalTargets: allTargets.length,
    dueNow,
    byDayOffset,
  };
}
