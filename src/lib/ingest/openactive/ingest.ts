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
import {
  parseFacilityUse,
  parseSlot,
  isGreaterLondon,
  hourLabel,
  localDate,
  courtNumberFromName,
  type ParsedVenue,
} from "./parse";

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
    { paceMs: opts.paceMs ?? 350 }
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
  slotsUpserted: number; // rows written (0 unless persist)
  cursor: string;
  persist: boolean;
}

interface CourtRef {
  courtId: number;
  venueId: number;
  courtName: string | null;
  courtNumber: number | null;
}

/** Load every known court keyed by its OpenActive `external_id`
 * (individual-facility-use @id) — the join key a slot's `facilityUse` points at. */
async function loadCourtIndex(): Promise<Map<string, CourtRef>> {
  const rows = await db
    .select({ id: courts.id, venueId: courts.venueId, externalId: courts.externalId, name: courts.name })
    .from(courts);
  const idx = new Map<string, CourtRef>();
  for (const r of rows) {
    if (!r.externalId) continue;
    idx.set(r.externalId, {
      courtId: r.id,
      venueId: r.venueId,
      courtName: r.name,
      courtNumber: courtNumberFromName(r.name),
    });
  }
  return idx;
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
    { paceMs: opts.paceMs ?? 350, maxPages: opts.maxPages ?? 5000 }
  );

  let updated = 0;
  let resolved = 0;
  let unresolved = 0;
  let slotsUpserted = 0;

  for (const it of latest.values()) {
    updated++;
    const s = parseSlot(it.data ?? {});
    if (!s) { unresolved++; continue; }
    const court = courtIndex.get(s.courtExternalId);
    const date = localDate(s.startsAt);
    const time = hourLabel(s.startsAt);
    if (!court || !time) { unresolved++; continue; }
    resolved++;
    if (!persist) continue;

    const status = s.remainingUses != null && s.remainingUses > 0 ? "available" : "booked";
    const courtLabel = court.courtName ?? `Court ${court.courtNumber ?? "?"}`;
    const values = {
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
    };
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
    slotsUpserted++;
  }

  if (persist) {
    await db
      .insert(feedState)
      .values({ source: "openactive", feed: "individual-facility-use-slots", nextCursor: walk.cursor, lastPolledAt: new Date().toISOString() })
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
    slotsUpserted,
    cursor: walk.cursor,
    persist,
  };
}
