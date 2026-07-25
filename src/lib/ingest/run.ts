/**
 * Feed-primary ingestion orchestration — the shared tick body.
 *
 * `runFeedIngest()` is the one place the ingestion pipeline is assembled, so both
 * entrypoints run byte-identical logic:
 *   • the HTTP cron route (`src/app/api/cron/scrape/route.ts`) — an external
 *     scheduler POSTs it; kept as a manual / fallback trigger.
 *   • the standalone worker (`src/lib/ingest/worker.ts`) — the Phase-5 second
 *     Railway service that runs this on its own timer, no external cron needed.
 *
 * IMPORTANT: this module and everything it pulls in must stay Next-runtime-free
 * (no `next/*`, no React) and use RELATIVE imports — the worker runs it under
 * `tsx`, which does not resolve the `@/*` tsconfig path alias.
 *
 * Each stage is failure-isolated: one bad stage never sinks the others, and
 * transitions from every stage are unioned and handed to `notifyUsers` once (it
 * dedups per channel via `notification_log`).
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { slots, notificationLog, feedState } from "../schema";
import { ensureVenuesExist } from "../differ";
import { notifyUsers } from "../notifiers";
import type { SlotChange } from "../differ";
import { ingestFacilities, pollSlots } from "./openactive/ingest";
import { fullSweep, confirmFeedChanges, type ConfirmSummary } from "./reconcile";
import { pollClubSpark } from "./clubspark/ingest";
import { upsertFeedState } from "./feed-state";

// How often to refresh venue metadata + courts from the OpenActive facility feed.
// Facilities change rarely, so this runs far less often than the slot poll.
const FACILITY_REFRESH_HOURS = parseInt(process.env.FACILITY_REFRESH_HOURS || "6", 10);

// Sweep cadence — the single Courtside HTML knob. The sweep is fixed-cost
// (venues × window venue-days per run, independent of watcher count), so this is
// a pure latency/bandwidth dial: sweep interval = worst-case false-negative
// notification latency. Defaults to 2h.
const SWEEP_INTERVAL_HOURS = parseInt(process.env.SWEEP_INTERVAL_HOURS || "2", 10);

// Confirm-on-notify: scrape a watched feed flip's venue-day before alerting, to
// suppress feed false-positives. Degrades safely to direct-notify when the proxy
// is off (scrape 404s → pass through). Toggle off with CONFIRM_ON_NOTIFY=off.
const CONFIRM_ON_NOTIFY = !/^(off|false|0)$/i.test(process.env.CONFIRM_ON_NOTIFY ?? "on");

// Self-heal floor. When Clock 1 sees a slot for a venue we track whose court
// isn't seeded, it re-runs the facility ingest and retries those slots in the
// same tick. That's a full facility-feed walk, so it's throttled: a court the
// facility feed genuinely never lists is a PERMANENT gap, and without a floor it
// would trigger a walk on every tick forever. The floor costs nothing in the case
// that matters — a genuinely new court heals on the first tick that sees it,
// since the throttle only bites on repeat attempts inside the window.
const FACILITY_HEAL_MIN_MINUTES = parseInt(process.env.FACILITY_HEAL_MIN_MINUTES || "60", 10);

// ClubSpark (Newham) is a full-snapshot JSON poll, not an RPDE delta feed — one
// call per venue covers the whole window, so a modest cadence stays polite while
// beating the retired scraper's ~10-min cron.
const CLUBSPARK_INTERVAL_MIN = parseInt(process.env.CLUBSPARK_INTERVAL_MIN || "5", 10);

// Retention + VACUUM cadence. This is housekeeping, not availability work, so it
// runs on its own slow clock rather than every tick — critical now that the worker
// ticks every ~30s (a per-tick VACUUM would thrash the DB). Defaults to 6h.
const CLEANUP_INTERVAL_HOURS = parseInt(process.env.CLEANUP_INTERVAL_HOURS || "6", 10);

/**
 * Refresh venue geo/address/amenities + the `courts` table from the OpenActive
 * facility feed, throttled to once per FACILITY_REFRESH_HOURS. Failure-isolated:
 * a feed hiccup logs and returns — it never breaks the ingest cycle. Populating
 * `courts` is also the prereq for slot→court resolution in the slot clocks.
 *
 * Returns whether the ingest actually ran to completion — the Clock 1 self-heal
 * needs to know, since it only reloads its court index (and retries the slots it
 * couldn't place) when the table has genuinely been refreshed.
 */
async function maybeIngestFacilities(force = false): Promise<boolean> {
  try {
    if (!force) {
      const [state] = await db
        .select({ lastPolledAt: feedState.lastPolledAt })
        .from(feedState)
        .where(and(eq(feedState.source, "openactive"), eq(feedState.feed, "facility-uses")))
        .limit(1);

      if (state?.lastPolledAt) {
        const ageMs = Date.now() - new Date(state.lastPolledAt).getTime();
        if (ageMs < FACILITY_REFRESH_HOURS * 3600_000) {
          console.log(`Facility refresh skipped (last run ${(ageMs / 3600_000).toFixed(1)}h ago)`);
          return false;
        }
      }
    }

    const summary = await ingestFacilities();
    console.log(
      `Facility ingest: ${summary.pages} pages, ${summary.itemsSeen} items seen → ` +
        `${summary.londonVenues} London venues (${summary.venuesInserted} new, ` +
        `${summary.venuesUpdated} updated), ${summary.courtsUpserted} courts`
    );
    return true;
  } catch (error) {
    console.error("Facility ingest failed (non-fatal):", error);
    return false;
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

// Per-clock throttle, backed by feed_state(source='clock'). Lets one tick run
// several clocks each on its own cadence. Checked before, stamped after a
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
  await upsertFeedState("clock", feed);
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

/** One line per confirm-on-notify pass, showing how many watched feed flips were
 * checked and what the live site said (suppressed false-positives / discovered
 * false-negatives). Only prints when there was something to confirm. */
function logConfirm(cf: ConfirmSummary): void {
  if (cf.toConfirm === 0) return;
  console.log(
    `   ✓ confirm-on-notify: ${cf.toConfirm} watched feed flip(s) → scraped ` +
      `${cf.scrapedVenueDays} venue-day(s); ${cf.suppressed} suppressed (false-positive), ` +
      `${cf.discovered} discovered (feed miss), ${cf.errors.length} scrape error(s)`
  );
  logErrorRollup("confirm-on-notify", cf.errors);
}

/**
 * Feed-primary ingestion in one tick. See the module header for the invariants.
 *   Clock 1  — OpenActive feed head-poll, every tick (cheap at head). Instant
 *              notifications for the ~95% the feed reports correctly. Self-heals
 *              slots whose court isn't seeded yet by re-running the facility
 *              ingest (throttled) and retrying them in the same tick.
 *   confirm  — confirm-on-notify: scrape the venue-day of each watched feed flip
 *              to drop false-positive alerts (per-transition cost; opt-out flag).
 *   ClubSpark — Newham first-party snapshot poll, throttled (already truth).
 *   sweep    — periodic full Courtside re-scrape, throttled to SWEEP_INTERVAL_HOURS.
 *              Fixed-cost false-negative discovery + dashboard-correctness net.
 *   cleanup  — retention + VACUUM, throttled to CLEANUP_INTERVAL_HOURS.
 */
export async function runFeedIngest(opts: { force?: boolean } = {}): Promise<void> {
  // `force` = the admin "refresh now" mode: bypass the per-clock throttles so
  // every availability stage runs this tick (facility refresh + clubspark +
  // sweep). Housekeeping (cleanup/VACUUM) stays throttled regardless — a manual
  // refresh shouldn't trigger a heavy VACUUM.
  const force = opts.force ?? false;
  const availabilityDue = async (feed: string, ms: number) => force || clockDue(feed, ms);
  try {
    console.log(
      force
        ? "Starting feed-primary ingest (manual refresh — unthrottled)..."
        : "Starting feed-primary ingest (feed → confirm → clubspark → sweep)..."
    );
    await ensureVenuesExist();
    // Keep venues/courts/geo fresh (throttled unless forced, failure-isolated).
    // Also the prereq that populates `courts` so slot→court resolution works.
    const facilitiesFreshThisTick = await maybeIngestFacilities(force);

    const allChanges: SlotChange[] = [];

    // Clock 1 — feed head-poll (delta). Runs every tick; near-free at head.
    try {
      // Self-heal hook: Clock 1 buffers slots whose court isn't seeded (at a venue
      // we DO track) and calls this once, then retries them against a reloaded
      // court index — so a court the facility feed added since our last refresh
      // costs us nothing rather than a silently-missed notification. Throttled
      // here (policy) because the walk is expensive; the retry itself lives in
      // pollSlots (mechanism). Returning false means "not refreshed, don't retry".
      const healUnmapped = async (): Promise<boolean> => {
        if (facilitiesFreshThisTick) {
          // The refresh above already ran a full walk moments ago; re-walking it
          // cannot seed a court the feed just declined to list.
          console.log("   ⚕️  unmapped court(s) seen, but facilities were already re-ingested this tick");
          return false;
        }
        if (!(await clockDue("facility-heal", FACILITY_HEAL_MIN_MINUTES * 60_000))) {
          console.log("   ⚕️  unmapped court(s) seen — self-heal throttled, skipping facility re-ingest");
          return false;
        }
        console.log("   ⚕️  unmapped court(s) seen — re-running facility ingest to self-heal");
        const ok = await maybeIngestFacilities(true);
        if (ok) await stampClock("facility-heal");
        return ok;
      };

      const c1 = await pollSlots({ persist: true, healUnmapped });
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
      // Break down the "unresolved" count so a benign national-feed miss (other
      // operators/regions we don't seed) reads differently from a real seeding gap.
      // Counts are POST-heal: anything still in `unmappedCourt` survived a facility
      // re-ingest, so the ⚠️ below means a genuine gap rather than stale seeding.
      if (c1.healedResolved > 0) {
        console.log(
          `   ⚕️  self-heal: facility re-ingest mapped ${c1.healedResolved} previously-unmapped slot(s)`
        );
      }
      if (c1.unresolved > 0) {
        const u = c1.unresolvedBy;
        console.log(
          `   unresolved ${c1.unresolved}: ${u.foreign} foreign (other operators/regions), ` +
            `${u.unmappedCourt} tracked-venue court unmapped, ` +
            `${u.excludedNonTennis} non-tennis (excluded on purpose), ` +
            `${u.noTime} no-time, ${u.badData} bad-data`
        );
        if (u.unmappedCourt > 0) {
          console.warn(
            `   ⚠️  ${u.unmappedCourt} slot(s) belonged to a venue we track but had no seeded court` +
              (c1.healed
                ? " — still missing after a facility re-ingest, so the facility feed likely never lists these court @ids"
                : " — no re-ingest ran this tick; retrying after the next facility refresh")
          );
        }
      }
      console.log(`   feed head cursor → ${c1.cursor}`);
      logChanges("Clock 1", c1.changes);

      // Confirm-on-notify: verify watched feed flips against the live site before
      // alerting (drops false-positives; the site-wins upsert also corrects the
      // dashboard). Its OWN try/catch so a confirm failure falls back to notifying
      // on the raw feed changes rather than dropping this tick's Clock 1
      // transitions entirely (the feed poll already persisted them).
      let clockOneChanges = c1.changes;
      if (CONFIRM_ON_NOTIFY && c1.changes.length > 0) {
        try {
          const cf = await confirmFeedChanges(c1.changes, { persist: true });
          logConfirm(cf);
          clockOneChanges = cf.changes;
        } catch (error) {
          console.error(
            "confirm-on-notify failed (non-fatal) — notifying on unconfirmed feed changes:",
            error
          );
        }
      }
      allChanges.push(...clockOneChanges);
    } catch (error) {
      console.error("Clock 1 head-poll failed (non-fatal):", error);
    }

    // ClubSpark (Newham) — first-party JSON snapshot poll, throttled. Direct
    // truth (no RPDE staleness), so it needs no reconcile clock of its own.
    if (await availabilityDue("clubspark", CLUBSPARK_INTERVAL_MIN * 60_000)) {
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

    // Periodic full sweep — fixed-cost false-negative discovery + dashboard floor,
    // throttled to SWEEP_INTERVAL_HOURS. Site-wins across every Courtside
    // venue-day; the only mechanism that catches slots the feed wrongly hides.
    if (await availabilityDue("sweep", SWEEP_INTERVAL_HOURS * 3600_000)) {
      try {
        const sweep = await fullSweep({ persist: true });
        console.log(
          `Full sweep: ${sweep.venueDays} venue-days, ${sweep.slotsScraped} slots, ` +
            `${sweep.upserted} upserted, ${sweep.transitions} transitions, ${sweep.errors.length} errors`
        );
        logErrorRollup("sweep", sweep.errors);
        logChanges("sweep", sweep.changes);
        allChanges.push(...sweep.changes);
        await stampClock("sweep");
      } catch (error) {
        console.error("Full sweep failed (non-fatal):", error);
      }
    }

    if (allChanges.length > 0) {
      console.log(`Notifying on ${allChanges.length} transition(s) across clocks`);
      await notifyUsers(allChanges);
    }

    // Housekeeping on its own slow clock (retention + VACUUM), so a fast tick
    // interval doesn't turn into a per-tick VACUUM.
    if (await clockDue("cleanup", CLEANUP_INTERVAL_HOURS * 3600_000)) {
      await runCleanup();
      await stampClock("cleanup");
    }
    console.log("Feed ingest completed successfully");
  } catch (error) {
    console.error("Feed ingest failed:", error);
  }
}
