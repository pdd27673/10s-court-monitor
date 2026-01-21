import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { watches, venues } from "@/lib/schema";
import { eq } from "drizzle-orm";

// GET /api/watches - List all watches (for now, no auth)
export async function GET() {
  const allWatches = await db.query.watches.findMany();

  // Enrich with venue info
  const enriched = await Promise.all(
    allWatches.map(async (watch) => {
      let venue = null;
      if (watch.venueId) {
        venue = await db.query.venues.findFirst({
          where: eq(venues.id, watch.venueId),
        });
      }

      return {
        id: watch.id,
        userId: watch.userId,
        venue: venue ? { slug: venue.slug, name: venue.name } : null,
        weekdayTimes: watch.weekdayTimes
          ? JSON.parse(watch.weekdayTimes)
          : null,
        weekendTimes: watch.weekendTimes
          ? JSON.parse(watch.weekendTimes)
          : null,
        active: Boolean(watch.active),
      };
    })
  );

  return NextResponse.json({ watches: enriched });
}

// POST /api/watches - Create a new watch
export async function POST(request: Request) {
  const body = await request.json();
  const { userId, venueSlug, weekdayTimes, weekendTimes } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  // Get venue ID if provided
  let venueId = null;
  if (venueSlug) {
    const venue = await db.query.venues.findFirst({
      where: eq(venues.slug, venueSlug),
    });
    if (venue) venueId = venue.id;
  }

  const [watch] = await db
    .insert(watches)
    .values({
      userId,
      venueId,
      weekdayTimes: weekdayTimes ? JSON.stringify(weekdayTimes) : null,
      weekendTimes: weekendTimes ? JSON.stringify(weekendTimes) : null,
      active: 1,
    })
    .returning();

  return NextResponse.json({ watch });
}
