/**
 * Clock 2 — watch-targeted reconcile (planning half).
 *
 * The OpenActive feed hides ~5% of genuinely-bookable court-hours because the
 * operator doesn't reliably re-emit a slot when a booking is cancelled (see
 * `scripts/feed-vs-site-audit.ts` and docs/REARCHITECTURE-PLAN.md). The feed
 * cannot detect its own staleness, so the only fix is to cross-check against the
 * live booking site — but scraping every venue-day defeats the point of the feed.
 *
 * This module computes the *pending set*: the minimal list of venue-days worth
 * scraping, being exactly those where some user is watching a (venue, date, time)
 * that our DB currently shows as NOT available. Those are the only places a
 * stale-feed false-negative could cost a missed notification. Everything else the
 * feed already covers, so we don't scrape it.
 *
 * `computePendingSet` is read-only — it decides WHAT to reconcile and reports the
 * HTML budget. `reconcileWatchedVenueDays` (below) is the acting half: it scrapes
 * a BOUNDED, round-robin subset of the pending venue-days, writes the site's truth
 * into the feed-owned `slots` table with canonical court labels ("site wins"), and
 * returns the booked/closed→available transitions to notify on. `persist` defaults
 * FALSE (same cutover gate as `pollSlots`), so it belongs with the Phase 3 cutover.
 * Run `scripts/reconcile-preview.ts` to size the budget and
 * `scripts/reconcile-run-preview.ts` to preview an actual (read-only) run.
 */
import { db } from "../db";
import { slots, venues, watches, courts, feedState } from "../schema";
import { and, eq, inArray } from "drizzle-orm";
import { scrapeCourtside } from "../scrapers/courtside";
import { courtNumberFromName, isNewlyAvailable } from "./openactive/parse";
import { VENUES } from "../constants";
import type { SlotChange } from "../differ";

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** A watch's preferred times for a given day name, honouring the new `dayTimes`
 * JSON and falling back to the legacy weekday/weekend fields. Mirrors the
 * extraction in `notifiers/index.ts:matchesWatch` so the reconcile targets the
 * exact slots that would notify. */
export function watchPreferredTimes(
  watch: { dayTimes: string | null; weekdayTimes: string | null; weekendTimes: string | null },
  dayName: string
): string[] {
  if (watch.dayTimes) {
    try {
      const parsed = JSON.parse(watch.dayTimes) as Record<string, string[]>;
      return parsed[dayName] ?? [];
    } catch {
      return [];
    }
  }
  const isWeekend = dayName === "saturday" || dayName === "sunday";
  const legacy = isWeekend ? watch.weekendTimes : watch.weekdayTimes;
  if (!legacy) return [];
  try {
    return JSON.parse(legacy) as string[];
  } catch {
    return [];
  }
}

/** The next `n` local dates ("YYYY-MM-DD"), starting today. */
export function nextDates(n: number, from = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
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
  const candidates = new Set<string>();
  for (const w of activeWatches) {
    const venuesForWatch = w.venueId == null ? activeVenueSlugs : [slugById.get(w.venueId)].filter(Boolean) as string[];
    for (const date of dates) {
      const dayName = DAY_NAMES[new Date(date).getDay()];
      const times = watchPreferredTimes(w, dayName);
      for (const slug of venuesForWatch) {
        for (const time of times) {
          candidates.add(`${slug}|${date}|${time.toLowerCase().trim()}`);
        }
      }
    }
  }

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
        availableAt.add(`${slugById.get(r.venueId)}|${r.date}|${r.time.toLowerCase().trim()}`);
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
// Clock 2b — site-wins reconcile: fetch → upsert → notify (bounded round-robin)
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
  const feed = `${venueSlug}|${date}`;
  const now = new Date().toISOString();
  await db
    .insert(feedState)
    .values({ source: RECONCILE_SOURCE, feed, lastPolledAt: now })
    .onConflictDoUpdate({ target: [feedState.source, feedState.feed], set: { lastPolledAt: now } });
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
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [slots.venueId, slots.date, slots.time, slots.court],
      set: {
        status: s.status,
        price: s.price ?? null,
        courtId: canon.courtId ?? undefined,
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
      const canon = canonicalCourtLabel(s.court, venue.courts);
      if (!canon) continue;

      const existing = await db.query.slots.findFirst({
        where: and(
          eq(slots.venueId, venue.id),
          eq(slots.date, s.date),
          eq(slots.time, s.time),
          eq(slots.court, canon.court)
        ),
      });
      const oldStatus = existing?.status ?? null;

      if (isNewlyAvailable(oldStatus, s.status)) {
        transitions++;
        changes.push({
          venue: vd.venueSlug,
          venueName: venue.name,
          date: s.date,
          time: s.time,
          court: canon.court,
          oldStatus,
          newStatus: s.status,
          price: s.price,
        });
      }

      if (persist) {
        await upsertReconciledSlot(venue.id, s, canon);
        upserted++;
      }
    }

    if (persist) await markReconciled(vd.venueSlug, vd.date);
  }

  return { slotsScraped, upserted, transitions, errors, changes };
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
 * Clock 2b of the hybrid ingestion — the correctness backstop for the feed's ~5%
 * stale misses (see docs/REARCHITECTURE-PLAN.md → "Feed reliability"). It:
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
 * Clock 3 of the hybrid ingestion — the daily full sweep. Scrapes EVERY active
 * Courtside venue-day across the window (not just watched-pending ones), site-wins
 * upserts, and returns transitions for `notifyUsers`. It is the dashboard
 * correctness floor and the feed-drop safety net: it catches stale-feed misses on
 * unwatched slots (no notification owed, but the dashboard should be right) and,
 * by stamping each venue-day's reconcile cursor, re-baselines Clock 2 so the
 * bounded reconcile doesn't redundantly re-scrape what the sweep just checked.
 *
 * `persist` defaults FALSE (same cutover gate as the other clocks). At the default
 * 8-day window and the 7 Tower Hamlets venues that's ~56 venue-days/run, meant to
 * run once per 24h — the cheapest of the three clocks.
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
