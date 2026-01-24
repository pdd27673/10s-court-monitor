import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { watches, venues } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";

// GET /api/watches - List user's watches
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const allWatches = await db.query.watches.findMany({
    where: eq(watches.userId, userId),
  });

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
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = parseInt(session.user.id);
  const body = await request.json();
  const { venueSlug, weekdayTimes, weekendTimes } = body;

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

  // Enrich with venue info and filter response (same format as GET endpoint)
  let venue = null;
  if (watch.venueId) {
    venue = await db.query.venues.findFirst({
      where: eq(venues.id, watch.venueId),
    });
  }

  return NextResponse.json({
    watch: {
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
    },
  });
}
