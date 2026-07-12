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
import { venues, courts, feedState } from "../../schema";
import { and, eq } from "drizzle-orm";
import { walkToHead, FEED_FACILITY_USES, type RpdeItem } from "./client";
import { parseFacilityUse, isGreaterLondon, type ParsedVenue } from "./parse";

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
