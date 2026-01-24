import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { slots, venues } from "@/lib/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const venueSlug = searchParams.get("venue");
  const date = searchParams.get("date");

  if (!venueSlug || !date) {
    return NextResponse.json(
      { error: "Missing venue or date parameter" },
      { status: 400 }
    );
  }

  // Get venue ID
  const venue = await db.query.venues.findFirst({
    where: eq(venues.slug, venueSlug),
  });

  if (!venue) {
    return NextResponse.json({ error: "Venue not found" }, { status: 404 });
  }

  // Get slots for this venue and date
  const availableSlots = await db.query.slots.findMany({
    where: and(eq(slots.venueId, venue.id), eq(slots.date, date)),
  });

  // Get the most recent updatedAt timestamp
  const mostRecentSlot = await db.query.slots.findFirst({
    where: eq(slots.venueId, venue.id),
    orderBy: desc(slots.updatedAt),
  });

  return NextResponse.json({
    venue: {
      slug: venue.slug,
      name: venue.name,
    },
    date,
    slots: availableSlots.map((s) => ({
      time: s.time,
      court: s.court,
      status: s.status,
      price: s.price,
    })),
    lastUpdated: mostRecentSlot?.updatedAt || null,
  });
}
