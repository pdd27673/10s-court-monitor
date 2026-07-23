/**
 * Courtside HTML cross-check — the site-truth half of the hybrid ingestion.
 *
 * The OpenActive feed hides ~5% of genuinely-bookable court-hours because the
 * operator doesn't reliably re-emit a slot when a booking is cancelled (see
 * `scripts/feed-vs-site-audit.ts` and docs/REARCHITECTURE-PLAN.md), in BOTH
 * directions: false-positives (feed says available, site says booked) and
 * false-negatives (feed says booked, site says available). The feed can't detect
 * its own staleness, so the only fix is to cross-check against the live site — but
 * scraping every venue-day every tick defeats the point of the feed.
 *
 * Two mechanisms consume the shared scrape/site-wins core below:
 *
 *   • `fullSweep` — the periodic full re-scrape (the workhorse). The ONLY thing
 *     that discovers false-negatives, at FIXED cost independent of watcher count.
 *   • `confirmFeedChanges` — confirm-on-notify. Scrapes just the venue-days of
 *     *watched* feed flips to suppress false-positive notifications, at
 *     per-transition cost.
 *
 * The watch-targeted `reconcileWatchedVenueDays` clock (and its `computePendingSet`
 * planner / `selectReconcileTargets` round-robin) is RETIRED from the live tick —
 * its bandwidth scaled with watched-taken venue-days, which the fixed-cost sweep
 * now covers. It is retained here (and in `scripts/reconcile-*.ts`) as a read-only
 * diagnostic. `persist` defaults FALSE on every writer (the Phase 3 cutover gate).
 */
import { db } from "../db";
import { slots, venues, watches, courts, feedState } from "../schema";
import { and, eq, inArray } from "drizzle-orm";
import { scrapeCourtside } from "../scrapers/courtside";
import { courtNumberFromName } from "./openactive/parse";
import { toHhmm, anyToMinutes, DAY_NAMES, nextDates, watchPreferredTimes } from "../time";
import { upsertFeedState } from "./feed-state";
import { detectSlotTransition } from "./slot-write";
import { VENUES } from "../constants";
import type { SlotChange } from "../differ";

// Re-exported for existing importers (tests, scripts/maintain.ts) that pull these
// from here; the definitions now live in ../time.
export { nextDates, watchPreferredTimes };

/** Canonical time part for a composite (venue|date|time[|court]) key: normalises
 * "7pm" and "19:00" to the same "HH:MM" so watch-derived and slot-derived keys
 * compare equal across the dayTimes migration. Falls back to lowercased/trimmed
 * for anything unparseable (keeps a stable key rather than dropping the entry). */
function timeKeyPart(time: string): string {
  return toHhmm(time) ?? time.toLowerCase().trim();
}

/** The watch fields that determine which (venue,date,time) it would notify on. */
interface WatchTimes {
  venueId: number | null;
  dayTimes: string | null;
  weekdayTimes: string | null;
  weekendTimes: string | null;
}

/**
 * The set of "<slug>|<date>|<time>" (time lowercased/trimmed) that some active
 * watch would notify on across `dates`. Pure — the single definition of "watched
 * (venue,date,time)" shared by the pending-set planner and confirm-on-notify, so
 * the two never drift. An all-venues watch (venueId null) fans out to
 * `activeVenueSlugs`.
 */
export function buildWatchCandidates(
  activeWatches: WatchTimes[],
  activeVenueSlugs: string[],
  slugById: Map<number, string>,
  dates: string[]
): Set<string> {
  const candidates = new Set<string>();
  for (const w of activeWatches) {
    const venuesForWatch =
      w.venueId == null ? activeVenueSlugs : ([slugById.get(w.venueId)].filter(Boolean) as string[]);
    for (const date of dates) {
      // "YYYY-MM-DD" parses as UTC midnight → read the weekday in UTC so it agrees
      // with the matcher and doesn't shift a day on a non-UTC host.
      const dayName = DAY_NAMES[new Date(date).getUTCDay()];
      const times = watchPreferredTimes(w, dayName);
      for (const slug of venuesForWatch) {
        for (const time of times) {
          candidates.add(`${slug}|${date}|${timeKeyPart(time)}`);
        }
      }
    }
  }
  return candidates;
}

/** DB-backed `buildWatchCandidates` over the next `windowDays` (defaults to
 * SCRAPE_DAYS). Used by confirm-on-notify to decide whether a feed flip is worth
 * a confirmation scrape. */
export async function activeWatchCandidates(opts: { windowDays?: number } = {}): Promise<Set<string>> {
  const windowDays = opts.windowDays ?? parseInt(process.env.SCRAPE_DAYS || "8", 10);
  const dates = nextDates(windowDays);
  const activeWatches = await db.query.watches.findMany({ where: eq(watches.active, 1) });
  const allVenues = await db.select({ id: venues.id, slug: venues.slug, active: venues.active }).from(venues);
  const slugById = new Map(allVenues.map((v) => [v.id, v.slug]));
  const activeVenueSlugs = allVenues.filter((v) => v.active !== 0).map((v) => v.slug);
  return buildWatchCandidates(activeWatches, activeVenueSlugs, slugById, dates);
}

export interface PendingVenueDay {
  venueSlug: string;
  date: string;
  /** distinct watched times at this venue-day that are currently unmet (taken/missing). */
  pendingTimes: string[];
}

export interface PendingSet {
  windowDays: number;
  activeWatches: number;
  /** distinct (venue,date,time) a watch cares about across the window. */
  candidateSlots: number;
  /** of those, how many are currently NOT available in the DB (need a cross-check). */
  pendingSlots: number;
  /** venue-days to actually scrape (the HTML budget for one reconcile run). */
  venueDays: PendingVenueDay[];
}

/**
 * Compute the pending set from active watches. Read-only.
 *
 * A (venue, date, time) is a *candidate* if an active watch would notify on it
 * (right venue + the day's preferred times). It is *pending* if the DB shows no
 * available court at that (venue, date, time) — i.e. every court is taken, or we
 * have no row yet. Pending candidates, grouped by venue-day, are what a reconcile
 * run scrapes; the count of `venueDays` is that run's HTML page budget.
 */
export async function computePendingSet(opts: { windowDays?: number } = {}): Promise<PendingSet> {
  const windowDays = opts.windowDays ?? parseInt(process.env.SCRAPE_DAYS || "8", 10);
  const dates = nextDates(windowDays);

  const activeWatches = await db.query.watches.findMany({ where: eq(watches.active, 1) });
  const allVenues = await db.select({ id: venues.id, slug: venues.slug, active: venues.active }).from(venues);
  const slugById = new Map(allVenues.map((v) => [v.id, v.slug]));
  const activeVenueSlugs = allVenues.filter((v) => v.active !== 0).map((v) => v.slug);

  // 1. Candidate (venueSlug, date, time) set from watches × window.
  const candidates = buildWatchCandidates(activeWatches, activeVenueSlugs, slugById, dates);

  // 2. Current availability for the candidate venue-days: a (venue,date,time) is
  //    "available" if ANY court there is available in the DB.
  const involvedSlugs = new Set([...candidates].map((k) => k.split("|")[0]));
  const venueIdsInvolved = allVenues.filter((v) => involvedSlugs.has(v.slug)).map((v) => v.id);

  const availableAt = new Set<string>();
  if (venueIdsInvolved.length) {
    const rows = await db
      .select({ venueId: slots.venueId, date: slots.date, time: slots.time, status: slots.status })
      .from(slots)
      .where(and(inArray(slots.venueId, venueIdsInvolved), inArray(slots.date, dates)));
    for (const r of rows) {
      if (r.status === "available") {
        availableAt.add(`${slugById.get(r.venueId)}|${r.date}|${timeKeyPart(r.time)}`);
      }
    }
  }

  // 3. Pending = candidate with no available court. Group into venue-days.
  const pendingByVenueDay = new Map<string, Set<string>>();
  let pendingSlots = 0;
  for (const c of candidates) {
    if (availableAt.has(c)) continue;
    pendingSlots++;
    const [slug, date, time] = c.split("|");
    const vd = `${slug}|${date}`;
    if (!pendingByVenueDay.has(vd)) pendingByVenueDay.set(vd, new Set());
    pendingByVenueDay.get(vd)!.add(time);
  }

  const venueDays: PendingVenueDay[] = [...pendingByVenueDay.entries()]
    .map(([vd, times]) => {
      const [venueSlug, date] = vd.split("|");
      return { venueSlug, date, pendingTimes: [...times].sort() };
    })
    .sort((a, b) => (a.venueSlug + a.date).localeCompare(b.venueSlug + b.date));

  return {
    windowDays,
    activeWatches: activeWatches.length,
    candidateSlots: candidates.size,
    pendingSlots,
    venueDays,
  };
}

// ============================================================================
// Watch-targeted reconcile — RETIRED from the live tick (see module header).
// Kept as a read-only diagnostic + `scripts/reconcile-*.ts`. Site-wins reconcile:
// fetch → upsert → notify (bounded round-robin).
// ============================================================================

/** `feed_state.source` namespace for the reconcile round-robin cursors. One row
 * per reconciled venue-day (`feed = "<slug>|<date>"`), `last_polled_at` = when it
 * was last cross-checked. Kept separate from the 'openactive' feed cursors. */
const RECONCILE_SOURCE = "reconcile";

/** HTML pages (venue-days) one reconcile run may scrape. Bounds the cost so it is
 * independent of watch growth: the run rotates through the least-recently-checked
 * pending venue-days, so at N runs/day it visits N × maxPages venue-days/day and
 * the worst-case miss latency for any one pending slot ≈ (pending venue-days /
 * maxPages) × run-interval. Tune against `scripts/reconcile-preview.ts`. */
const DEFAULT_MAX_PAGES = parseInt(process.env.RECONCILE_MAX_PAGES || "40", 10);

/** Courtside slugs known from static config, used as a fallback for venues the
 * facility feed hasn't enriched with `source_type` yet (pre-cutover prod). */
const CONSTANTS_COURTSIDE = new Set(VENUES.filter((v) => v.type === "courtside").map((v) => v.slug));

/**
 * Map a scraped court label ("Tennis court 3") to the feed-canonical label the
 * feed writes ("Court 3") plus its `courtId`, using a per-venue court index keyed
 * by court number. This is what lets the reconcile UPDATE the feed-owned row
 * instead of creating a "Tennis court N" duplicate under the
 * (venue,date,time,court) unique key. Falls back to a synthesized "Court N" when
 * `courts` isn't populated yet (pre-cutover), so both writers still converge.
 * Returns null when the label carries no court number (unmappable → skip).
 */
export function canonicalCourtLabel(
  scrapedCourt: string,
  venueCourts: Map<number, { courtId: number; name: string | null }> | undefined
): { court: string; courtId: number | null } | null {
  const n = courtNumberFromName(scrapedCourt);
  if (n == null) return null;
  const match = venueCourts?.get(n);
  if (match) return { court: match.name ?? `Court ${n}`, courtId: match.courtId };
  return { court: `Court ${n}`, courtId: null };
}

/**
 * Order pending venue-days least-recently-checked first (never-checked sort
 * first, epoch 0), then take the first `maxPages`. Deterministic tiebreak by
 * "<slug>|<date>" so repeated runs rotate cleanly through the backlog. Pure.
 */
export function selectReconcileTargets(
  pending: PendingVenueDay[],
  lastCheckedByKey: Map<string, number>,
  maxPages: number
): PendingVenueDay[] {
  return [...pending]
    .sort((a, b) => {
      const ka = `${a.venueSlug}|${a.date}`;
      const kb = `${b.venueSlug}|${b.date}`;
      const la = lastCheckedByKey.get(ka) ?? 0; // never checked → oldest → first
      const lb = lastCheckedByKey.get(kb) ?? 0;
      if (la !== lb) return la - lb;
      return ka.localeCompare(kb);
    })
    .slice(0, Math.max(0, maxPages));
}

interface CourtsideVenue {
  id: number;
  name: string;
  /** court-number → { courtId, name } for canonical-label resolution. */
  courts: Map<number, { courtId: number; name: string | null }>;
}

/** Load the Courtside (Tower Hamlets) venues `scrapeCourtside` can fetch, each
 * with its court-number index. Data-driven — includes feed-discovered bonus
 * venues via `source_type='courtside'`, falling back to the static config for
 * venues the feed hasn't enriched yet. Newham/ClubSpark is Phase 4. */
async function loadCourtsideVenueIndex(): Promise<Map<string, CourtsideVenue>> {
  const vs = await db
    .select({ id: venues.id, slug: venues.slug, name: venues.name, sourceType: venues.sourceType, active: venues.active })
    .from(venues);
  const courtside = vs.filter(
    (v) => v.active !== 0 && (v.sourceType === "courtside" || CONSTANTS_COURTSIDE.has(v.slug))
  );
  const ids = courtside.map((v) => v.id);

  const courtsByVenue = new Map<number, Map<number, { courtId: number; name: string | null }>>();
  if (ids.length) {
    const cs = await db
      .select({ venueId: courts.venueId, id: courts.id, name: courts.name })
      .from(courts)
      .where(inArray(courts.venueId, ids));
    for (const c of cs) {
      const n = courtNumberFromName(c.name);
      if (n == null) continue;
      let m = courtsByVenue.get(c.venueId);
      if (!m) { m = new Map(); courtsByVenue.set(c.venueId, m); }
      m.set(n, { courtId: c.id, name: c.name });
    }
  }

  const idx = new Map<string, CourtsideVenue>();
  for (const v of courtside) {
    idx.set(v.slug, { id: v.id, name: v.name, courts: courtsByVenue.get(v.id) ?? new Map() });
  }
  return idx;
}

/** Load the round-robin cursors: "<slug>|<date>" → last-checked epoch ms. */
async function loadReconcileState(): Promise<Map<string, number>> {
  const rows = await db
    .select({ feed: feedState.feed, lastPolledAt: feedState.lastPolledAt })
    .from(feedState)
    .where(eq(feedState.source, RECONCILE_SOURCE));
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.lastPolledAt) m.set(r.feed, new Date(r.lastPolledAt).getTime());
  }
  return m;
}

/** Stamp a venue-day as just reconciled (advances its round-robin cursor). */
async function markReconciled(venueSlug: string, date: string): Promise<void> {
  await upsertFeedState(RECONCILE_SOURCE, `${venueSlug}|${date}`);
}

/** Site-wins upsert: write the scraped status/price into the feed-owned row,
 * preserving the feed's metadata columns (starts_at/remaining_uses/…) on
 * conflict. `court_id` is only set when we resolved it, else left as-is. */
async function upsertReconciledSlot(
  venueId: number,
  s: { date: string; time: string; status: string; price?: string },
  canon: { court: string; courtId: number | null }
): Promise<void> {
  const now = new Date().toISOString();
  const startMinute = anyToMinutes(s.time); // canonical minute-of-day (Phase 6)
  await db
    .insert(slots)
    .values({
      venueId,
      date: s.date,
      time: s.time,
      court: canon.court,
      status: s.status,
      price: s.price ?? null,
      courtId: canon.courtId ?? undefined,
      startMinute,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [slots.venueId, slots.date, slots.time, slots.court],
      set: {
        status: s.status,
        price: s.price ?? null,
        courtId: canon.courtId ?? undefined,
        startMinute,
        updatedAt: now,
      },
    });
}

interface ReconcileRun {
  slotsScraped: number;
  upserted: number;
  transitions: number;
  errors: { venueSlug: string; date: string; error: string }[];
  changes: SlotChange[];
  /** "<slug>|<date>|<time>" (time lowercased/trimmed) the SITE showed available
   * this run — regardless of court. Lets confirm-on-notify verify a feed flip
   * against live truth without a second read. */
  availableSet: Set<string>;
}

/**
 * Shared inner loop for the two scrape-backed clocks (2b reconcile + 3 sweep):
 * for each target venue-day, scrape it, canonicalise each court label to the
 * feed-owned row, and — SITE WINS — upsert the scraped truth, collecting
 * booked/closed→available transitions. When `persist`, also advances that
 * venue-day's round-robin cursor so Clock 3 re-baselines Clock 2 for free.
 * Per-venue-day scrape failures are isolated so one dead page never sinks a run.
 */
async function scrapeAndReconcileVenueDays(
  targets: { venueSlug: string; date: string }[],
  venueIndex: Map<string, CourtsideVenue>,
  persist: boolean
): Promise<ReconcileRun> {
  const changes: SlotChange[] = [];
  const errors: { venueSlug: string; date: string; error: string }[] = [];
  const availableSet = new Set<string>();
  let slotsScraped = 0;
  let upserted = 0;
  let transitions = 0;

  for (const vd of targets) {
    const venue = venueIndex.get(vd.venueSlug);
    if (!venue) continue;

    let scraped;
    try {
      scraped = await scrapeCourtside(vd.venueSlug, vd.date);
    } catch (e) {
      errors.push({ venueSlug: vd.venueSlug, date: vd.date, error: (e as Error).message });
      // Advance the round-robin cursor even on failure so a permanently-failing
      // venue-day (persistent 404 / IP block) rotates to the back of the queue
      // instead of sorting first forever and starving other pending venue-days.
      if (persist) await markReconciled(vd.venueSlug, vd.date);
      continue;
    }
    slotsScraped += scraped.length;

    for (const s of scraped) {
      // Record live availability at the (venue,date,time) level before the court
      // canonicalisation — an unmappable court label is still a real free court
      // for notification purposes (watches match on time, not court).
      if (s.status === "available") {
        availableSet.add(`${vd.venueSlug}|${s.date}|${timeKeyPart(s.time)}`);
      }

      const canon = canonicalCourtLabel(s.court, venue.courts);
      if (!canon) continue;

      const { change } = await detectSlotTransition(
        venue.id,
        { date: s.date, time: s.time, court: canon.court, status: s.status, price: s.price },
        { venue: vd.venueSlug, venueName: venue.name }
      );
      if (change) {
        transitions++;
        changes.push(change);
      }

      if (persist) {
        await upsertReconciledSlot(venue.id, s, canon);
        upserted++;
      }
    }

    if (persist) await markReconciled(vd.venueSlug, vd.date);
  }

  return { slotsScraped, upserted, transitions, errors, changes, availableSet };
}

export interface ReconcileSummary {
  windowDays: number;
  /** pending venue-days after restricting to scrapeable Courtside venues. */
  pendingVenueDays: number;
  /** the bounded subset actually scraped this run (≤ maxPages). */
  scrapedVenueDays: number;
  maxPages: number;
  slotsScraped: number;
  /** rows written (0 unless persist). */
  upserted: number;
  /** booked/closed → available flips detected (candidates for notifyUsers). */
  transitions: number;
  errors: { venueSlug: string; date: string; error: string }[];
  changes: SlotChange[];
  persist: boolean;
}

/**
 * RETIRED from the live tick (the fixed-cost `fullSweep` now covers this); kept as
 * a read-only diagnostic. Was the watch-targeted correctness backstop for the
 * feed's ~5% stale misses (see docs/REARCHITECTURE-PLAN.md → "Feed reliability"). It:
 *
 *   1. asks `computePendingSet()` which watched venue-days currently show no
 *      available court (the only places a stale-feed false-negative can cost a
 *      missed notification),
 *   2. restricts to Courtside venues (the ones `scrapeCourtside` can fetch),
 *   3. picks a BOUNDED, least-recently-checked subset (`selectReconcileTargets`,
 *      `maxPages`) so the cost is independent of watch growth,
 *   4. scrapes each, canonicalises court labels, and — SITE WINS — writes the
 *      site's truth into the feed-owned `slots` rows, and
 *   5. returns booked/closed→available transitions for the caller to notify:
 *
 *        const { changes } = await reconcileWatchedVenueDays({ persist: true });
 *        if (changes.length) await notifyUsers(changes);
 *
 * `persist` defaults FALSE — a read-only preview that detects would-be changes,
 * writes nothing, and does NOT advance the round-robin cursors. Flip it on only
 * at the Phase 3 cutover, after the feed owns `slots` (see `pollSlots`): before
 * then the scraper's rows are keyed "Tennis court N" while this writes "Court N",
 * so a persisting run would create duplicates AND find no prior feed row to
 * transition from (every lookup is null → no transitions). The transition signal
 * is therefore only meaningful post-cutover; pre-cutover this previews mechanics.
 *
 * Per-venue-day scrape failures are isolated (collected in `errors`) so one dead
 * page never sinks the run.
 */
export async function reconcileWatchedVenueDays(
  opts: { persist?: boolean; maxPages?: number; windowDays?: number } = {}
): Promise<ReconcileSummary> {
  const persist = opts.persist ?? false;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;

  const pending = await computePendingSet({ windowDays: opts.windowDays });
  const venueIndex = await loadCourtsideVenueIndex();
  const pendingCourtside = pending.venueDays.filter((vd) => venueIndex.has(vd.venueSlug));

  const lastChecked = await loadReconcileState();
  const targets = selectReconcileTargets(pendingCourtside, lastChecked, maxPages);

  const run = await scrapeAndReconcileVenueDays(targets, venueIndex, persist);

  return {
    windowDays: pending.windowDays,
    pendingVenueDays: pendingCourtside.length,
    scrapedVenueDays: targets.length,
    maxPages,
    ...run,
    persist,
  };
}

// ============================================================================
// Clock 3 — daily full sweep
// ============================================================================

export interface SweepSummary {
  windowDays: number;
  /** every Courtside venue-day scraped (all active courtside venues × window). */
  venueDays: number;
  slotsScraped: number;
  upserted: number;
  transitions: number;
  errors: { venueSlug: string; date: string; error: string }[];
  changes: SlotChange[];
  persist: boolean;
}

/**
 * The periodic full sweep — the workhorse of the post-reconcile design. Scrapes
 * EVERY active Courtside venue-day across the window (not just watched-pending
 * ones), site-wins upserts, and returns transitions for `notifyUsers`.
 *
 * It is the ONLY false-negative discovery mechanism: the feed can't announce a
 * slot it wrongly shows as booked, and confirm-on-notify only fires on feed
 * transitions, so a slot the feed hides (booked in the feed, free on the site)
 * has no event to trigger a targeted check — only a blind re-scrape of
 * apparently-booked slots finds it. The sweep is bidirectional: it also corrects
 * feed false-positives on the dashboard (available→booked).
 *
 * Its cost is FIXED at (Courtside venues × window) venue-days per run, INDEPENDENT
 * of watcher count — at the default 8-day window and 7 Tower Hamlets venues that's
 * ~56 venue-days/run. The single knob is `SWEEP_INTERVAL_HOURS`: sweep interval =
 * worst-case false-negative notification latency, traded against fixed bandwidth.
 *
 * `persist` defaults FALSE (same cutover gate as the other writers).
 */
export async function fullSweep(
  opts: { persist?: boolean; windowDays?: number } = {}
): Promise<SweepSummary> {
  const persist = opts.persist ?? false;
  const windowDays = opts.windowDays ?? parseInt(process.env.SCRAPE_DAYS || "8", 10);
  const dates = nextDates(windowDays);

  const venueIndex = await loadCourtsideVenueIndex();
  const targets: { venueSlug: string; date: string }[] = [];
  for (const venueSlug of venueIndex.keys()) {
    for (const date of dates) targets.push({ venueSlug, date });
  }

  const run = await scrapeAndReconcileVenueDays(targets, venueIndex, persist);

  return {
    windowDays,
    venueDays: targets.length,
    ...run,
    persist,
  };
}

// ============================================================================
// Confirm-on-notify — verify a watched feed flip against the live site before
// firing the notification (suppresses feed false-positives at per-transition cost)
// ============================================================================

/** How many distinct venue-days a single confirm pass may scrape. A safety valve
 * against a feed dump flipping many watched venue-days available in one tick;
 * over-cap transitions pass through unconfirmed rather than being dropped. */
const CONFIRM_MAX_VENUE_DAYS = parseInt(process.env.CONFIRM_MAX_VENUE_DAYS || "20", 10);

const confirmTimeKey = (venue: string, date: string, time: string) =>
  `${venue}|${date}|${timeKeyPart(time)}`;
const confirmFullKey = (c: SlotChange) =>
  `${c.venue}|${c.date}|${timeKeyPart(c.time)}|${c.court}`;

export interface ConfirmSummary {
  /** feed transitions handed in. */
  input: number;
  /** of those, the watched Courtside subset eligible for a confirmation scrape. */
  toConfirm: number;
  /** distinct venue-days actually scraped to confirm (≤ maxVenueDays). */
  scrapedVenueDays: number;
  /** watched feed transitions the live site contradicted (false positives, dropped). */
  suppressed: number;
  /** bonus booked/closed→available transitions the confirm scrape discovered on
   * those venue-days (feed false-negatives), folded into `changes`. */
  discovered: number;
  /** the notify-safe transition list: every input change except suppressed
   * false-positives, plus deduped discoveries. Hand this to `notifyUsers`. */
  changes: SlotChange[];
  errors: { venueSlug: string; date: string; error: string }[];
  persist: boolean;
}

/**
 * Confirm-on-notify. Given the feed (Clock 1) booked/closed→available transitions,
 * scrape the live site for the venue-days of the *watched, Courtside* ones and
 * return only the transitions worth notifying on.
 *
 * The feed hides ~5% of truth in BOTH directions. This closes the false-POSITIVE
 * direction for notifications: when the feed says a watched slot went available
 * but the site says it's actually booked, we drop the alert (and the site-wins
 * upsert corrects the dashboard). The complementary false-NEGATIVE direction — the
 * feed still showing a free slot as booked — has no feed event to trigger a check
 * and is the job of the periodic `fullSweep`, not this function.
 *
 * Only *watched* + *Courtside* feed flips are scraped: unwatched ones notify
 * nobody, and non-Courtside (ClubSpark) is already first-party truth. Cost is
 * therefore per real watched transition, not per watcher.
 *
 * Fails SAFE: a venue-day whose scrape errors (e.g. the residential proxy is off
 * and Courtside 404s from a datacenter IP) or that falls over `maxVenueDays`
 * cannot be confirmed, so its transitions pass through unsuppressed rather than
 * being wrongly dropped. With the proxy off this degrades to today's behaviour
 * (feed flips notify directly).
 *
 * `persist` mirrors the caller (site-wins upsert of the scraped venue-days).
 */
export async function confirmFeedChanges(
  feedChanges: SlotChange[],
  opts: { persist?: boolean; windowDays?: number; maxVenueDays?: number } = {}
): Promise<ConfirmSummary> {
  const persist = opts.persist ?? false;
  const maxVenueDays = opts.maxVenueDays ?? CONFIRM_MAX_VENUE_DAYS;

  const passthrough = (extra: Partial<ConfirmSummary> = {}): ConfirmSummary => ({
    input: feedChanges.length,
    toConfirm: 0,
    scrapedVenueDays: 0,
    suppressed: 0,
    discovered: 0,
    changes: feedChanges,
    errors: [],
    persist,
    ...extra,
  });

  if (feedChanges.length === 0) return passthrough();

  const venueIndex = await loadCourtsideVenueIndex();
  const candidates = await activeWatchCandidates({ windowDays: opts.windowDays });

  const toConfirm = feedChanges.filter(
    (c) => venueIndex.has(c.venue) && candidates.has(confirmTimeKey(c.venue, c.date, c.time))
  );
  if (toConfirm.length === 0) return passthrough();

  // One scrape per distinct venue-day, capped. Preserve first-seen order so the
  // cap keeps the earliest-reported flips.
  const vdOrder: string[] = [];
  const vdSeen = new Set<string>();
  for (const c of toConfirm) {
    const vd = `${c.venue}|${c.date}`;
    if (!vdSeen.has(vd)) {
      vdSeen.add(vd);
      vdOrder.push(vd);
    }
  }
  const targets = vdOrder.slice(0, Math.max(0, maxVenueDays)).map((vd) => {
    const [venueSlug, date] = vd.split("|");
    return { venueSlug, date };
  });
  const scrapedVD = new Set(targets.map((t) => `${t.venueSlug}|${t.date}`));

  const run = await scrapeAndReconcileVenueDays(targets, venueIndex, persist);
  const failedVD = new Set(run.errors.map((e) => `${e.venueSlug}|${e.date}`));

  // Suppress a watched flip ONLY when its venue-day scraped successfully AND the
  // site shows that (venue,date,time) with no available court. Un-scraped
  // (over-cap) or failed venue-days can't confirm → never suppress.
  const suppressedTimes = new Set<string>();
  for (const c of toConfirm) {
    const vd = `${c.venue}|${c.date}`;
    if (!scrapedVD.has(vd) || failedVD.has(vd)) continue;
    const tk = confirmTimeKey(c.venue, c.date, c.time);
    if (!run.availableSet.has(tk)) suppressedTimes.add(tk);
  }

  const kept = feedChanges.filter((c) => !suppressedTimes.has(confirmTimeKey(c.venue, c.date, c.time)));
  const suppressed = feedChanges.length - kept.length;

  // Fold in false-negatives the scrape caught on those venue-days, deduped
  // against kept transitions by full slot key so notifyUsers doesn't double-fire.
  const keptKeys = new Set(kept.map(confirmFullKey));
  const discovered = run.changes.filter((c) => !keptKeys.has(confirmFullKey(c)));

  return {
    input: feedChanges.length,
    toConfirm: toConfirm.length,
    scrapedVenueDays: targets.length,
    suppressed,
    discovered: discovered.length,
    changes: [...kept, ...discovered],
    errors: run.errors,
    persist,
  };
}
