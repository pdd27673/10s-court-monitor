/**
 * DB ingest for the OpenActive feeds.
 *
 * `ingestFacilities` walks facility-uses and upserts London venues + their
 * courts, and persists the feed cursor. It is SAFE to run alongside the existing
 * scrapers: it only enriches venue metadata (geo/address/amenities/external_id)
 * and fills the new `courts` table — it does not touch the `slots` table, so the
 * scraper's availability data is untouched until the Phase 3 cutover.
 *
 * Existing venues are matched by slug (parse maps known Tower Hamlets facilities
 * to their existing slugs), so no duplicates are created; curated fields
 * (name, slug, operator, booking_url_template) are preserved.
 */
import { db } from "../../db";
import { venues, courts, slots, feedState } from "../../schema";
import { and, eq } from "drizzle-orm";
import { walkToHead, FEED_FACILITY_USES, FEED_SLOTS, type RpdeItem } from "./client";
import type { SlotChange } from "../../differ";
import {
  parseFacilityUse,
  parseSlot,
  isGreaterLondon,
  hourLabel,
  localDate,
  courtNumberFromName,
  facilityIdFromRef,
  feedSlotStatus,
  isNewlyAvailable,
  type ParsedVenue,
  type ParsedSlot,
} from "./parse";

/** The RPDE slots feed name, as stored in `feed_state.feed`. */
const SLOT_FEED = "individual-facility-use-slots";

/**
 * Why an updated slot didn't resolve to one of our courts. The slots feed is
 * Premier Tennis *national*, but we only seed London venues, so most deltas are
 * for courts we deliberately don't track. Splitting the count keeps a benign
 * national-feed miss ("foreign") distinct from a real seeding gap
 * ("unmappedCourt": a venue we DO track whose specific court @id isn't in
 * `courts`) — the latter is the only one worth an alert.
 */
export interface UnresolvedBreakdown {
  /** court's parent facility isn't one we track — other operator/region (expected). */
  foreign: number;
  /** parent facility IS tracked but this court @id isn't seeded (real gap → check facility ingest). */
  unmappedCourt: number;
  /** couldn't derive an hour label from the slot's startDate. */
  noTime: number;
  /** slot payload was missing @id / facilityUse / startDate. */
  badData: number;
}

const newBreakdown = (): UnresolvedBreakdown => ({ foreign: 0, unmappedCourt: 0, noTime: 0, badData: 0 });

/** The set of parent facility ids we have at least one seeded court for, derived
 * from the court index (`facilityIdFromRef` of each court's external_id). Lets an
 * unresolved slot be classed as a tracked-venue gap vs national-feed noise. */
function trackedFacilityIds(courtIndex: Map<string, CourtRef>): Set<string> {
  const s = new Set<string>();
  for (const key of courtIndex.keys()) {
    const fid = facilityIdFromRef(key);
    if (fid) s.add(fid);
  }
  return s;
}

/** Bucket a court-not-found slot: parent facility we track (court missing → real
 * gap) vs a facility we don't track at all (benign national-feed noise). */
function unresolvedReason(courtExternalId: string, tracked: Set<string>): "unmappedCourt" | "foreign" {
  const fid = facilityIdFromRef(courtExternalId);
  return fid && tracked.has(fid) ? "unmappedCourt" : "foreign";
}

export interface IngestSummary {
  pages: number;
  itemsSeen: number;
  londonVenues: number;
  venuesInserted: number;
  venuesUpdated: number;
  courtsUpserted: number;
  cursor: string;
  dryRun: boolean;
}

async function upsertVenue(v: ParsedVenue, dryRun: boolean): Promise<{ id: number | null; inserted: boolean }> {
  // Enrichment only — never overwrite curated name/slug/operator/booking template.
  const enrich = {
    externalId: v.externalId,
    sourceType: "courtside",
    address: v.address,
    postcode: v.postcode,
    amenities: v.amenities ?? undefined,
    lat: v.lat ?? undefined,
    lng: v.lng ?? undefined,
    active: 1,
  };
  if (dryRun) {
    const existing = await db.select({ id: venues.id }).from(venues).where(eq(venues.slug, v.slug)).limit(1);
    return { id: existing[0]?.id ?? null, inserted: existing.length === 0 };
  }
  const updated = await db.update(venues).set(enrich).where(eq(venues.slug, v.slug)).returning({ id: venues.id });
  if (updated.length > 0) return { id: updated[0].id, inserted: false };
  const inserted = await db
    .insert(venues)
    .values({ slug: v.slug, name: v.name, ...enrich })
    .returning({ id: venues.id });
  return { id: inserted[0]?.id ?? null, inserted: true };
}

async function upsertCourts(venueId: number, v: ParsedVenue, dryRun: boolean): Promise<number> {
  let n = 0;
  for (const c of v.courts) {
    if (dryRun) { n++; continue; }
    const updated = await db
      .update(courts)
      .set({ name: c.name })
      .where(and(eq(courts.venueId, venueId), eq(courts.externalId, c.externalId)))
      .returning({ id: courts.id });
    if (updated.length === 0) {
      await db.insert(courts).values({ venueId, externalId: c.externalId, name: c.name });
    }
    n++;
  }
  return n;
}

export async function ingestFacilities(opts: { startCursor?: string; dryRun?: boolean; paceMs?: number } = {}): Promise<IngestSummary> {
  const dryRun = opts.dryRun ?? false;

  // Collect the latest state per facility across the walk (updated wins; deleted drops).
  const latest = new Map<string, RpdeItem<Record<string, unknown>>>();
  const walk = await walkToHead<Record<string, unknown>>(
    opts.startCursor ?? FEED_FACILITY_USES,
    (items) => {
      for (const it of items) {
        if (it.state === "deleted") latest.delete(String(it.id));
        else latest.set(String(it.id), it);
      }
    },
    { paceMs: opts.paceMs ?? 350, label: "facility-uses" }
  );

  let londonVenues = 0;
  let venuesInserted = 0;
  let venuesUpdated = 0;
  let courtsUpserted = 0;

  for (const it of latest.values()) {
    const v = parseFacilityUse(it.data ?? {});
    if (!v || !isGreaterLondon(v.lat, v.lng)) continue;
    londonVenues++;
    const { id, inserted } = await upsertVenue(v, dryRun);
    if (inserted) venuesInserted++;
    else venuesUpdated++;
    if (id != null) courtsUpserted += await upsertCourts(id, v, dryRun);
  }

  if (!dryRun) {
    await db
      .insert(feedState)
      .values({ source: "openactive", feed: "facility-uses", nextCursor: walk.cursor, lastPolledAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [feedState.source, feedState.feed],
        set: { nextCursor: walk.cursor, lastPolledAt: new Date().toISOString() },
      });
  }

  return {
    pages: walk.pages,
    itemsSeen: walk.items,
    londonVenues,
    venuesInserted,
    venuesUpdated,
    courtsUpserted,
    cursor: walk.cursor,
    dryRun,
  };
}

// ============================================================================
// Slot ingestion
// ============================================================================

export interface SlotIngestSummary {
  pages: number;
  updated: number; // updated slot items seen across the walk
  deleted: number; // deleted slot items seen
  resolved: number; // updated slots whose court mapped to a known London court
  unresolved: number; // updated slots we couldn't place (court not in DB / not London)
  unresolvedBy: UnresolvedBreakdown; // why they didn't resolve (foreign vs real gap)
  slotsUpserted: number; // rows written (0 unless persist)
  cursor: string;
  persist: boolean;
}

interface CourtRef {
  courtId: number;
  venueId: number;
  venueSlug: string;
  venueName: string;
  courtName: string | null;
  courtNumber: number | null;
}

/** Load every known court keyed by its OpenActive `external_id`
 * (individual-facility-use @id) — the join key a slot's `facilityUse` points at.
 * Joins `venues` so the poller can build `SlotChange`s (which need venue slug +
 * name) without a second lookup. */
async function loadCourtIndex(): Promise<Map<string, CourtRef>> {
  const rows = await db
    .select({
      id: courts.id,
      venueId: courts.venueId,
      externalId: courts.externalId,
      name: courts.name,
      venueSlug: venues.slug,
      venueName: venues.name,
    })
    .from(courts)
    .innerJoin(venues, eq(courts.venueId, venues.id));
  const idx = new Map<string, CourtRef>();
  for (const r of rows) {
    if (!r.externalId) continue;
    idx.set(r.externalId, {
      courtId: r.id,
      venueId: r.venueId,
      venueSlug: r.venueSlug,
      venueName: r.venueName,
      courtName: r.name,
      courtNumber: courtNumberFromName(r.name),
    });
  }
  return idx;
}

/** Build the `slots` upsert values for one resolved feed slot. Shared by the
 * bulk backfill (`ingestSlots`) and the delta poller (`pollSlots`) so both write
 * identical rows (same court label, same status vocabulary). */
function slotRowValues(court: CourtRef, s: ParsedSlot, date: string, time: string) {
  const status = feedSlotStatus(s.remainingUses);
  const courtLabel = court.courtName ?? `Court ${court.courtNumber ?? "?"}`;
  return {
    status,
    courtLabel,
    values: {
      venueId: court.venueId,
      courtId: court.courtId,
      date,
      time,
      court: courtLabel,
      status,
      price: s.price != null ? String(s.price) : null,
      startsAt: new Date(s.startsAt),
      endsAt: s.endsAt ? new Date(s.endsAt) : null,
      remainingUses: s.remainingUses,
      maxUses: s.maxUses,
      updatedAt: new Date().toISOString(),
    },
  };
}

type SlotRowValues = ReturnType<typeof slotRowValues>["values"];

/** Upsert one feed slot row, keyed by the legacy (venue,date,time,court) unique. */
async function upsertSlotRow(values: SlotRowValues): Promise<void> {
  await db
    .insert(slots)
    .values(values)
    .onConflictDoUpdate({
      target: [slots.venueId, slots.date, slots.time, slots.court],
      set: {
        status: values.status,
        price: values.price,
        courtId: values.courtId,
        startsAt: values.startsAt,
        endsAt: values.endsAt,
        remainingUses: values.remainingUses,
        maxUses: values.maxUses,
        updatedAt: values.updatedAt,
      },
    });
}

/**
 * Walk the `individual-facility-use-slots` feed and (optionally) persist slots
 * into the `slots` table, resolving each slot to a court via the `courts` table.
 *
 * `persist` defaults to FALSE. In Phase 2 the HTML scraper still owns the `slots`
 * table (it upserts by `venue_id,date,time,court` and prunes rows it didn't
 * scrape), so writing feed slots concurrently would fight the scraper. Run this
 * read-only to validate resolution; the parity script (`scripts/parity-openactive.ts`)
 * is the gate. Flip `persist` on at the Phase 3 cutover once the scraper is gone.
 *
 * Requires `courts` to be populated first (run `ingestFacilities()`); slots whose
 * court isn't in the index are counted as `unresolved` and skipped.
 */
export async function ingestSlots(
  opts: { startCursor?: string; persist?: boolean; paceMs?: number; maxPages?: number } = {}
): Promise<SlotIngestSummary> {
  const persist = opts.persist ?? false;
  const courtIndex = await loadCourtIndex();
  const tracked = trackedFacilityIds(courtIndex);

  // Collect the latest state per slot across the walk (updated wins; deleted drops).
  const latest = new Map<string, RpdeItem<Record<string, unknown>>>();
  let deleted = 0;
  const walk = await walkToHead<Record<string, unknown>>(
    opts.startCursor ?? FEED_SLOTS,
    (items) => {
      for (const it of items) {
        if (it.state === "deleted") {
          deleted++;
          latest.delete(String(it.id));
        } else {
          latest.set(String(it.id), it);
        }
      }
    },
    { paceMs: opts.paceMs ?? 350, maxPages: opts.maxPages ?? 5000, label: "slots backfill" }
  );

  let updated = 0;
  let resolved = 0;
  let unresolved = 0;
  const unresolvedBy = newBreakdown();
  let slotsUpserted = 0;

  for (const it of latest.values()) {
    updated++;
    const s = parseSlot(it.data ?? {});
    if (!s) { unresolved++; unresolvedBy.badData++; continue; }
    const court = courtIndex.get(s.courtExternalId);
    if (!court) { unresolved++; unresolvedBy[unresolvedReason(s.courtExternalId, tracked)]++; continue; }
    const date = localDate(s.startsAt);
    const time = hourLabel(s.startsAt);
    if (!time) { unresolved++; unresolvedBy.noTime++; continue; }
    resolved++;
    if (!persist) continue;

    const { values } = slotRowValues(court, s, date, time);
    await upsertSlotRow(values);
    slotsUpserted++;
  }

  if (persist) {
    await db
      .insert(feedState)
      .values({ source: "openactive", feed: SLOT_FEED, nextCursor: walk.cursor, lastPolledAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [feedState.source, feedState.feed],
        set: { nextCursor: walk.cursor, lastPolledAt: new Date().toISOString() },
      });
  }

  return {
    pages: walk.pages,
    updated,
    deleted,
    resolved,
    unresolved,
    unresolvedBy,
    slotsUpserted,
    cursor: walk.cursor,
    persist,
  };
}

// ============================================================================
// Clock 1 — feed head-poll (delta) with transition detection
// ============================================================================

export interface SlotPollSummary {
  pages: number; // pages walked this poll (1 when already at head, no deltas)
  updated: number; // updated slot items seen across the walk
  deleted: number; // deleted slot items seen (see note in pollSlots)
  resolved: number; // updated slots that mapped to a known London court
  unresolved: number; // updated slots we couldn't place
  unresolvedBy: UnresolvedBreakdown; // why they didn't resolve (foreign vs real gap)
  slotsUpserted: number; // rows written (0 unless persist)
  transitions: number; // booked/closed → available flips detected
  cursor: string; // head cursor after this poll
  startedFromHead: boolean; // false = full backfill (no saved cursor yet)
  persist: boolean;
  changes: SlotChange[]; // transitions, ready to hand to notifyUsers()
  byVenue: Record<string, number>; // resolved slots per venue slug (for logging)
}

/**
 * Clock 1 of the hybrid ingestion. Delta-polls the slots feed from the saved
 * head cursor (`feed_state`), applies changes to `slots`, and collects
 * booked/closed→available transitions as `SlotChange`s for the caller to notify:
 *
 *   const { changes } = await pollSlots({ persist: true });
 *   if (changes.length) await notifyUsers(changes);
 *
 * The FIRST run (no saved cursor) walks from page 1 — a full backfill — and by
 * the transition rule (`isNewlyAvailable`) notifies nothing, since every prior
 * status is null. Subsequent runs resume from the head and fetch only deltas.
 *
 * `persist` defaults FALSE: a read-only preview that detects would-be changes,
 * writes nothing, and does NOT advance the cursor. Flip it on only at the Phase 3
 * cutover — AND only after `slots` has been reset to feed-owned rows. The feed
 * writes court labels as "Court N" whereas the retiring HTML scraper wrote
 * "Tennis court N"; those are different values under the (venue,date,time,court)
 * unique key, so running both writers at once would create duplicate rows. The
 * cutover procedure is: retire the scraper, truncate `slots`, run
 * `ingestSlots({ persist: true })` once to backfill, then start `pollSlots`.
 *
 * Requires `courts` populated first (run `ingestFacilities()`); slots whose court
 * isn't in the index are counted `unresolved` and skipped.
 *
 * NOTE on deletes: an RPDE "deleted" item carries only an id (no data), and the
 * `slots` table isn't keyed by the feed slot id, so a delete can't be mapped back
 * to a row here. Deletes are counted for observability but not applied; stale
 * feed-dropped rows are swept by the daily full sweep (Clock 3) and age-based
 * cleanup. (Storing the slot @id on the row would let us prune precisely later.)
 */
export async function pollSlots(
  opts: { persist?: boolean; paceMs?: number; maxPages?: number } = {}
): Promise<SlotPollSummary> {
  const persist = opts.persist ?? false;
  const courtIndex = await loadCourtIndex();
  const tracked = trackedFacilityIds(courtIndex);

  // Resume from the saved head cursor; first run (no cursor) backfills from page 1.
  const [state] = await db
    .select({ nextCursor: feedState.nextCursor })
    .from(feedState)
    .where(and(eq(feedState.source, "openactive"), eq(feedState.feed, SLOT_FEED)))
    .limit(1);
  const startedFromHead = Boolean(state?.nextCursor);
  const startUrl = state?.nextCursor || FEED_SLOTS;

  // Collect the latest state per slot across the walk (updated wins; deleted drops).
  const latest = new Map<string, RpdeItem<Record<string, unknown>>>();
  let deleted = 0;
  const walk = await walkToHead<Record<string, unknown>>(
    startUrl,
    (items) => {
      for (const it of items) {
        if (it.state === "deleted") {
          deleted++;
          latest.delete(String(it.id));
        } else {
          latest.set(String(it.id), it);
        }
      }
    },
    { paceMs: opts.paceMs ?? 350, maxPages: opts.maxPages ?? 5000, label: startedFromHead ? "slots head-poll" : "slots backfill" }
  );

  const changes: SlotChange[] = [];
  const byVenue: Record<string, number> = {};
  let updated = 0;
  let resolved = 0;
  let unresolved = 0;
  const unresolvedBy = newBreakdown();
  let slotsUpserted = 0;
  let transitions = 0;

  for (const it of latest.values()) {
    updated++;
    const s = parseSlot(it.data ?? {});
    if (!s) { unresolved++; unresolvedBy.badData++; continue; }
    const court = courtIndex.get(s.courtExternalId);
    if (!court) { unresolved++; unresolvedBy[unresolvedReason(s.courtExternalId, tracked)]++; continue; }
    const date = localDate(s.startsAt);
    const time = hourLabel(s.startsAt);
    if (!time) { unresolved++; unresolvedBy.noTime++; continue; }
    resolved++;
    byVenue[court.venueSlug] = (byVenue[court.venueSlug] ?? 0) + 1;

    const { status: newStatus, courtLabel, values } = slotRowValues(court, s, date, time);

    // Prior status for transition detection (feed owns the row post-cutover).
    const existing = await db.query.slots.findFirst({
      where: and(
        eq(slots.venueId, court.venueId),
        eq(slots.date, date),
        eq(slots.time, time),
        eq(slots.court, courtLabel)
      ),
    });
    const oldStatus = existing?.status ?? null;

    if (isNewlyAvailable(oldStatus, newStatus)) {
      transitions++;
      changes.push({
        venue: court.venueSlug,
        venueName: court.venueName,
        date,
        time,
        court: courtLabel,
        oldStatus,
        newStatus,
        price: values.price ?? undefined,
      });
    }

    if (persist) {
      await upsertSlotRow(values);
      slotsUpserted++;
    }
  }

  if (persist) {
    await db
      .insert(feedState)
      .values({ source: "openactive", feed: SLOT_FEED, nextCursor: walk.cursor, lastPolledAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: [feedState.source, feedState.feed],
        set: { nextCursor: walk.cursor, lastPolledAt: new Date().toISOString() },
      });
  }

  return {
    pages: walk.pages,
    updated,
    deleted,
    resolved,
    unresolved,
    unresolvedBy,
    slotsUpserted,
    transitions,
    cursor: walk.cursor,
    startedFromHead,
    persist,
    changes,
    byVenue,
  };
}
