import { NextResponse } from "next/server";
import { runScheduledScrape } from "@/lib/scrape-scheduler";
import { ensureVenuesExist, storeAndDiff } from "@/lib/differ";
import { notifyUsers, sendScrapeFailureAlert, sendScrapeSummary } from "@/lib/notifiers";
import { db } from "@/lib/db";
import { slots, notificationLog, scrapeTargets, feedState } from "@/lib/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { proxyManager, formatBytes } from "@/lib/proxy-manager";
import type { ScrapeStats } from "@/lib/scraper";
import { ingestFacilities, pollSlots } from "@/lib/ingest/openactive/ingest";
import { reconcileWatchedVenueDays, fullSweep } from "@/lib/ingest/reconcile";
import type { SlotChange } from "@/lib/differ";

// How often to refresh venue metadata + courts from the OpenActive facility feed.
// Facilities change rarely, so this runs far less often than the slot scrape.
const FACILITY_REFRESH_HOURS = parseInt(process.env.FACILITY_REFRESH_HOURS || "6", 10);

// ---- Phase 3 feed-primary cutover switch ----
// When FEED_INGEST_ENABLED=true the cron runs the 3-clock feed-primary ingestion
// (Clock 1 head-poll + Clock 2b watch-reconcile + Clock 3 daily sweep) INSTEAD of
// the blind HTML scrape. Default off → prod keeps the existing scraper untouched
// (no regression); flipping the flag is the reversible cutover. Prereq before
// flipping: `courts` populated in prod (facility ingest) and `slots` reset to
// feed-owned rows (see docs/HANDOFF.md cutover procedure).
const FEED_INGEST_ENABLED = process.env.FEED_INGEST_ENABLED === "true";
const RECONCILE_INTERVAL_MIN = parseInt(process.env.RECONCILE_INTERVAL_MIN || "15", 10);
const SWEEP_INTERVAL_HOURS = parseInt(process.env.SWEEP_INTERVAL_HOURS || "24", 10);

/**
 * Refresh venue geo/address/amenities + the `courts` table from the OpenActive
 * facility feed, throttled to once per FACILITY_REFRESH_HOURS. Failure-isolated:
 * a feed hiccup logs and returns — it never breaks the scrape cycle. Does NOT
 * touch the `slots` table (the scraper still owns availability until Phase 3).
 */
async function maybeIngestFacilities() {
  try {
    const [state] = await db
      .select({ lastPolledAt: feedState.lastPolledAt })
      .from(feedState)
      .where(and(eq(feedState.source, "openactive"), eq(feedState.feed, "facility-uses")))
      .limit(1);

    if (state?.lastPolledAt) {
      const ageMs = Date.now() - new Date(state.lastPolledAt).getTime();
      if (ageMs < FACILITY_REFRESH_HOURS * 3600_000) {
        console.log(`Facility refresh skipped (last run ${(ageMs / 3600_000).toFixed(1)}h ago)`);
        return;
      }
    }

    const summary = await ingestFacilities();
    console.log(
      `Facility ingest: ${summary.londonVenues} London venues (` +
        `${summary.venuesInserted} new, ${summary.venuesUpdated} updated), ` +
        `${summary.courtsUpserted} courts, ${summary.pages} pages`
    );
  } catch (error) {
    console.error("Facility ingest failed (non-fatal):", error);
  }
}

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
    await db.execute(sql`VACUUM`);
    console.log("Database vacuumed");
  } catch (error) {
    console.error("Cleanup failed:", error);
  }
}

async function runScrapeJob(force = false) {
  try {
    console.log(`Starting ${force ? "forced full" : "scheduled"} scrape job...`);

    // Ensure all venues exist in DB
    await ensureVenuesExist();

    // Refresh venue metadata + courts from the OpenActive feed (throttled,
    // failure-isolated, slots untouched).
    await maybeIngestFacilities();

    // If forced, reset all nextScrapeAt timestamps so every target is due now
    if (force) {
      const now = new Date().toISOString();
      await db.update(scrapeTargets).set({ nextScrapeAt: now });
      console.log("Force mode: reset all scrape targets to due now");
    }

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

// Per-clock throttle, backed by feed_state(source='clock'). Lets one cron tick
// run several clocks each on its own cadence. Checked before, stamped after a
// successful run so a failed clock simply retries on the next tick.
async function clockDue(feed: string, intervalMs: number): Promise<boolean> {
  const [state] = await db
    .select({ lastPolledAt: feedState.lastPolledAt })
    .from(feedState)
    .where(and(eq(feedState.source, "clock"), eq(feedState.feed, feed)))
    .limit(1);
  if (!state?.lastPolledAt) return true;
  return Date.now() - new Date(state.lastPolledAt).getTime() >= intervalMs;
}

async function stampClock(feed: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(feedState)
    .values({ source: "clock", feed, lastPolledAt: now })
    .onConflictDoUpdate({ target: [feedState.source, feedState.feed], set: { lastPolledAt: now } });
}

/**
 * Phase 3 feed-primary ingestion: run the three hybrid clocks in one cron tick,
 * INSTEAD of the blind HTML scrape. Each clock is failure-isolated so one bad
 * clock never sinks the others; transitions from all clocks are unioned and
 * handed to notifyUsers once (it dedups per channel via notification_log).
 *   Clock 1 — feed head-poll, every tick (cheap at head).
 *   Clock 2b — bounded watch-targeted reconcile, throttled to RECONCILE_INTERVAL_MIN.
 *   Clock 3 — daily full sweep, throttled to SWEEP_INTERVAL_HOURS.
 */
async function runFeedIngest() {
  try {
    console.log("Starting feed-primary ingest (Clock 1 / 2b / 3)...");
    await ensureVenuesExist();
    // Keep venues/courts/geo fresh (throttled, failure-isolated). Also the
    // prereq that populates `courts` so slot→court resolution works.
    await maybeIngestFacilities();

    const allChanges: SlotChange[] = [];

    // Clock 1 — feed head-poll (delta). Runs every tick; near-free at head.
    try {
      const c1 = await pollSlots({ persist: true });
      console.log(
        `Clock 1 head-poll: ${c1.pages} pages, ${c1.resolved} resolved, ` +
          `${c1.slotsUpserted} upserted, ${c1.transitions} transitions` +
          `${c1.startedFromHead ? "" : " (initial backfill — notifies nothing)"}`
      );
      allChanges.push(...c1.changes);
    } catch (error) {
      console.error("Clock 1 head-poll failed (non-fatal):", error);
    }

    // Clock 2b — bounded watch-targeted reconcile (site wins), throttled.
    if (await clockDue("reconcile", RECONCILE_INTERVAL_MIN * 60_000)) {
      try {
        const c2 = await reconcileWatchedVenueDays({ persist: true });
        console.log(
          `Clock 2b reconcile: scraped ${c2.scrapedVenueDays}/${c2.pendingVenueDays} pending ` +
            `venue-days, ${c2.upserted} upserted, ${c2.transitions} transitions, ${c2.errors.length} errors`
        );
        allChanges.push(...c2.changes);
        await stampClock("reconcile");
      } catch (error) {
        console.error("Clock 2b reconcile failed (non-fatal):", error);
      }
    }

    // Clock 3 — daily full sweep (dashboard floor + feed-drop net), throttled.
    if (await clockDue("sweep", SWEEP_INTERVAL_HOURS * 3600_000)) {
      try {
        const c3 = await fullSweep({ persist: true });
        console.log(
          `Clock 3 sweep: ${c3.venueDays} venue-days, ${c3.upserted} upserted, ` +
            `${c3.transitions} transitions, ${c3.errors.length} errors`
        );
        allChanges.push(...c3.changes);
        await stampClock("sweep");
      } catch (error) {
        console.error("Clock 3 sweep failed (non-fatal):", error);
      }
    }

    if (allChanges.length > 0) {
      console.log(`Notifying on ${allChanges.length} transition(s) across clocks`);
      await notifyUsers(allChanges);
    }

    await runCleanup();
    console.log("Feed ingest completed successfully");
  } catch (error) {
    console.error("Feed ingest failed:", error);
  }
}

// Track if a scrape job is currently running to prevent concurrent executions
let isJobRunning = false;

export async function POST(request: Request) {
  // Verify cron secret (deny by default in production)
  if (!isDev) {
    if (!CRON_SECRET) {
      console.error("CRON_SECRET is not configured");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Check if a job is already running
  if (isJobRunning) {
    return NextResponse.json({ error: "Scrape job already running" }, { status: 409 });
  }

  const force = new URL(request.url).searchParams.get("force") === "true";

  // Start the job in the background (don't await). The cutover switch selects the
  // feed-primary 3-clock ingestion or the legacy blind HTML scrape.
  isJobRunning = true;
  const job = FEED_INGEST_ENABLED ? runFeedIngest() : runScrapeJob(force);
  job
    .catch((error) => {
      console.error("Unhandled error in cron job:", error);
    })
    .finally(() => {
      isJobRunning = false;
    });

  // Return immediately
  return NextResponse.json({
    success: true,
    message: FEED_INGEST_ENABLED
      ? "Feed ingest started"
      : force
        ? "Forced full scrape started"
        : "Scrape job started",
  });
}
