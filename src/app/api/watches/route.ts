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
        preferredTimes: watch.preferredTimes
          ? JSON.parse(watch.preferredTimes)
          : null,
        weekdaysOnly: Boolean(watch.weekdaysOnly),
        weekendsOnly: Boolean(watch.weekendsOnly),
        active: Boolean(watch.active),
      };
    })
  );

  return NextResponse.json({ watches: enriched });
}

// POST /api/watches - Create a new watch
export async function POST(request: Request) {
  const body = await request.json();
  const { userId, venueSlug, preferredTimes, weekdaysOnly, weekendsOnly } =
    body;

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
      preferredTimes: preferredTimes ? JSON.stringify(preferredTimes) : null,
      weekdaysOnly: weekdaysOnly ? 1 : 0,
      weekendsOnly: weekendsOnly ? 1 : 0,
      active: 1,
    })
    .returning();

  return NextResponse.json({ watch });
}
