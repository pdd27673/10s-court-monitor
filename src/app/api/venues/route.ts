import { NextResponse } from "next/server";
import type { Venue, VenueType, VenuesResponse } from "@pdd27673/10s-contract";
import { db } from "@/lib/db";
import { venues as venuesTable } from "@/lib/schema";
import { VENUES } from "@/lib/constants";

// GET /api/venues — the venue catalogue, sourced from the DB (feed-enriched) since
// contract 0.2.0. Resolves the old code-vs-DB split where this returned the static
// scraper config. clubsparkId/clubsparkHost aren't stored in the DB, so they're
// merged in from the static config by slug (used for booking deep-links). Falls
// back to the static config if the DB has no venues (e.g. a fresh, unseeded env).
export async function GET() {
  const configBySlug = new Map(VENUES.map((v) => [v.slug, v]));

  const rows = await db.select().from(venuesTable).orderBy(venuesTable.name);

  if (rows.length === 0) {
    return NextResponse.json({ venues: [...VENUES] } satisfies VenuesResponse);
  }

  const venues: Venue[] = rows.map((r) => {
    const cfg = configBySlug.get(r.slug);
    const type = (r.sourceType ?? cfg?.type ?? "courtside") as VenueType;
    const amenities = Array.isArray(r.amenities) ? (r.amenities as string[]) : null;
    return {
      slug: r.slug,
      name: r.name,
      type,
      // Booking deep-link identifiers live only in the static config.
      clubsparkId: cfg?.clubsparkId,
      clubsparkHost: cfg?.clubsparkHost,
      // 0.2.0 enriched metadata + geo (nullable until the feed populates them).
      operator: r.operator,
      address: r.address,
      postcode: r.postcode,
      amenities,
      bookingUrl: r.bookingUrlTemplate,
      active: r.active !== 0,
      lat: r.lat,
      lng: r.lng,
    };
  });

  return NextResponse.json({ venues } satisfies VenuesResponse);
}
