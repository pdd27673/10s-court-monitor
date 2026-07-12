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
 * HTML budget. The site-wins fetch+upsert+notify half lands with the Phase 3
 * cutover (it must write into the feed-owned `slots` table with canonical court
 * labels). Run `scripts/reconcile-preview.ts` to size the budget against live
 * watches today.
 */
import { db } from "../db";
import { slots, venues, watches } from "../schema";
import { and, eq, inArray } from "drizzle-orm";

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
