import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { slots, venues } from "@/lib/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const venueParam = searchParams.get("venue");
  const date = searchParams.get("date");

  if (!venueParam || !date) {
    return NextResponse.json(
      { error: "Missing venue or date parameter" },
      { status: 400 }
    );
  }

  // Support both single venue and comma-separated multiple venues
  const venueSlugs = venueParam.split(",").map((s) => s.trim()).filter(Boolean);

  if (venueSlugs.length === 0) {
    return NextResponse.json(
      { error: "At least one venue must be specified" },
      { status: 400 }
    );
  }

  // Get all venues using standard query builder for inArray support
  const venueRecords = await db
    .select()
    .from(venues)
    .where(inArray(venues.slug, venueSlugs));

  if (venueRecords.length === 0) {
    return NextResponse.json({ error: "No venues found" }, { status: 404 });
  }

  // Check if all requested venues were found
  const foundSlugs = venueRecords.map((v) => v.slug);
  const missingSlugs = venueSlugs.filter((slug) => !foundSlugs.includes(slug));
  if (missingSlugs.length > 0) {
    return NextResponse.json(
      { error: `Venues not found: ${missingSlugs.join(", ")}` },
      { status: 404 }
    );
  }

  const venueIds = venueRecords.map((v) => v.id);

  // Get slots for all venues and date using standard query builder
  const availableSlots = await db
    .select()
    .from(slots)
    .where(and(inArray(slots.venueId, venueIds), eq(slots.date, date)));

  // Get the most recent updatedAt timestamp across all venues
  const mostRecentSlots = await db
    .select()
    .from(slots)
    .where(inArray(slots.venueId, venueIds))
    .orderBy(desc(slots.updatedAt))
    .limit(1);

  const mostRecentSlot = mostRecentSlots[0] || null;

  // Create a map of venue ID to venue info for quick lookup
  const venueMap = new Map(venueRecords.map((v) => [v.id, v]));

  return NextResponse.json({
    venues: venueRecords.map((v) => ({
      slug: v.slug,
      name: v.name,
    })),
    date,
    slots: availableSlots.map((s) => {
      const venue = venueMap.get(s.venueId!);
      return {
        venueSlug: venue?.slug || "",
        venueName: venue?.name || "",
        time: s.time,
        court: s.court,
        status: s.status,
        price: s.price,
      };
    }),
    lastUpdated: mostRecentSlot?.updatedAt || null,
  });
}
