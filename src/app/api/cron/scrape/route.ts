import { NextResponse } from "next/server";
import { ensureVenuesExist } from "@/lib/differ";
import { notifyUsers } from "@/lib/notifiers";
import { db } from "@/lib/db";
import { slots, notificationLog, feedState } from "@/lib/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { ingestFacilities, pollSlots } from "@/lib/ingest/openactive/ingest";
import { reconcileWatchedVenueDays, fullSweep } from "@/lib/ingest/reconcile";
import { pollClubSpark } from "@/lib/ingest/clubspark/ingest";
import type { SlotChange } from "@/lib/differ";

// How often to refresh venue metadata + courts from the OpenActive facility feed.
// Facilities change rarely, so this runs far less often than the slot poll.
const FACILITY_REFRESH_HOURS = parseInt(process.env.FACILITY_REFRESH_HOURS || "6", 10);

// Clock cadences (each throttled independently within one cron tick).
const RECONCILE_INTERVAL_MIN = parseInt(process.env.RECONCILE_INTERVAL_MIN || "15", 10);
const SWEEP_INTERVAL_HOURS = parseInt(process.env.SWEEP_INTERVAL_HOURS || "24", 10);
// ClubSpark (Newham) is a full-snapshot JSON poll, not an RPDE delta feed — one
// call per venue covers the whole window, so a modest cadence stays polite while
// beating the retired scraper's ~10-min cron.
const CLUBSPARK_INTERVAL_MIN = parseInt(process.env.CLUBSPARK_INTERVAL_MIN || "5", 10);

// Protect the cron endpoint with a secret (skip in development)
const CRON_SECRET = process.env.CRON_SECRET;
const isDev = process.env.NODE_ENV === "development";

/**
 * Refresh venue geo/address/amenities + the `courts` table from the OpenActive
 * facility feed, throttled to once per FACILITY_REFRESH_HOURS. Failure-isolated:
 * a feed hiccup logs and returns — it never breaks the ingest cycle. Populating
 * `courts` is also the prereq for slot→court resolution in the slot clocks.
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
      `Facility ingest: ${summary.pages} pages, ${summary.itemsSeen} items seen → ` +
        `${summary.londonVenues} London venues (${summary.venuesInserted} new, ` +
        `${summary.venuesUpdated} updated), ${summary.courtsUpserted} courts`
    );
  } catch (error) {
    console.error("Facility ingest failed (non-fatal):", error);
  }
}

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

// How many individual transition lines to print per clock before summarizing the
// rest as a count — keeps a busy tick readable without hiding the flips entirely.
const MAX_CHANGE_LINES = 25;

/** Log each booked/closed→available flip a clock found (bounded), so the notify
 * path is auditable from the logs alone. */
function logChanges(clock: string, changes: SlotChange[]): void {
  for (const c of changes.slice(0, MAX_CHANGE_LINES)) {
    console.log(
      `   🎾 ${clock}: ${c.venue} | ${c.date} ${c.time} | ${c.court}  ` +
        `${c.oldStatus ?? "∅"} → ${c.newStatus}${c.price ? `  ${c.price}` : ""}`
    );
  }
  if (changes.length > MAX_CHANGE_LINES) {
    console.log(`   … and ${changes.length - MAX_CHANGE_LINES} more ${clock} transition(s)`);
  }
}

/** Roll up a clock's per-venue-day errors into "N× <reason>" lines so a bulk
 * failure (e.g. every venue 404ing with the proxy off) reads as one summary
 * rather than dozens of identical lines. */
function logErrorRollup(clock: string, errors: { error: string }[]): void {
  if (!errors.length) return;
  const byReason = new Map<string, number>();
  for (const e of errors) byReason.set(e.error, (byReason.get(e.error) ?? 0) + 1);
  const rolled = [...byReason.entries()].map(([reason, n]) => `${n}× ${reason}`).join("; ");
  console.warn(`   ⚠️  ${clock} errors (${errors.length}): ${rolled}`);
}

/**
 * Feed-primary ingestion: run the three hybrid clocks in one cron tick. Each
 * clock is failure-isolated so one bad clock never sinks the others; transitions
 * from all clocks are unioned and handed to notifyUsers once (it dedups per
 * channel via notification_log).
 *   Clock 1 — feed head-poll, every tick (cheap at head).
 *   ClubSpark — Newham full-snapshot poll, throttled to CLUBSPARK_INTERVAL_MIN.
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
      const mode = c1.startedFromHead ? "delta from head" : "INITIAL BACKFILL — notifies nothing";
      console.log(
        `Clock 1 OpenActive head-poll (${mode}): ${c1.pages} pages walked, ` +
          `${c1.updated} updated + ${c1.deleted} deleted items seen, ` +
          `${c1.resolved} resolved / ${c1.unresolved} unresolved, ` +
          `${c1.slotsUpserted} upserted, ${c1.transitions} transitions`
      );
      const perVenue = Object.entries(c1.byVenue).sort((a, b) => b[1] - a[1]);
      if (perVenue.length) {
        console.log(`   by venue: ${perVenue.map(([slug, n]) => `${slug}=${n}`).join(", ")}`);
      }
      console.log(`   feed head cursor → ${c1.cursor}`);
      logChanges("Clock 1", c1.changes);
      allChanges.push(...c1.changes);
    } catch (error) {
      console.error("Clock 1 head-poll failed (non-fatal):", error);
    }

    // ClubSpark (Newham) — first-party JSON snapshot poll, throttled. Direct
    // truth (no RPDE staleness), so it needs no reconcile clock of its own.
    if (await clockDue("clubspark", CLUBSPARK_INTERVAL_MIN * 60_000)) {
      try {
        const cs = await pollClubSpark({ persist: true });
        console.log(
          `ClubSpark (Newham) poll: ${cs.venues} venues, ${cs.slotsScraped} scraped, ` +
            `${cs.courtsUpserted} courts, ${cs.slotsUpserted} upserted, ${cs.transitions} transitions, ` +
            `${cs.errors.length} errors`
        );
        logErrorRollup("ClubSpark", cs.errors);
        logChanges("ClubSpark", cs.changes);
        allChanges.push(...cs.changes);
        await stampClock("clubspark");
      } catch (error) {
        console.error("ClubSpark poll failed (non-fatal):", error);
      }
    }

    // Clock 2b — bounded watch-targeted reconcile (site wins), throttled.
    if (await clockDue("reconcile", RECONCILE_INTERVAL_MIN * 60_000)) {
      try {
        const c2 = await reconcileWatchedVenueDays({ persist: true });
        console.log(
          `Clock 2b reconcile: scraped ${c2.scrapedVenueDays}/${c2.pendingVenueDays} pending ` +
            `venue-days (budget ${c2.maxPages}), ${c2.slotsScraped} slots, ${c2.upserted} upserted, ` +
            `${c2.transitions} transitions, ${c2.errors.length} errors`
        );
        logErrorRollup("Clock 2b", c2.errors);
        logChanges("Clock 2b", c2.changes);
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
          `Clock 3 sweep: ${c3.venueDays} venue-days, ${c3.slotsScraped} slots, ${c3.upserted} upserted, ` +
            `${c3.transitions} transitions, ${c3.errors.length} errors`
        );
        logErrorRollup("Clock 3", c3.errors);
        logChanges("Clock 3", c3.changes);
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

// Track if a job is currently running to prevent concurrent executions
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
    return NextResponse.json({ error: "Ingest job already running" }, { status: 409 });
  }

  // Start the ingest in the background (don't await)
  isJobRunning = true;
  runFeedIngest()
    .catch((error) => {
      console.error("Unhandled error in ingest job:", error);
    })
    .finally(() => {
      isJobRunning = false;
    });

  // Return immediately
  return NextResponse.json({ success: true, message: "Feed ingest started" });
}
