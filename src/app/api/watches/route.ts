import { NextResponse } from "next/server";
import type { DayTimes, Watch, WatchResponse, WatchesResponse } from "@pdd27673/10s-contract";
import { db } from "@/lib/db";
import { watches, venues } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { getAuthedUserId } from "@/lib/mobile-auth";

// GET /api/watches - List user's watches
export async function GET(request: Request) {
  const userId = await getAuthedUserId(request);
  if (userId === null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

      // Support both new dayTimes and legacy weekday/weekend fields
      let dayTimes: DayTimes | null = null;
      if (watch.dayTimes) {
        dayTimes = JSON.parse(watch.dayTimes) as DayTimes;
      } else if (watch.weekdayTimes || watch.weekendTimes) {
        // Convert legacy format to new format
        const weekday = watch.weekdayTimes ? JSON.parse(watch.weekdayTimes) : [];
        const weekend = watch.weekendTimes ? JSON.parse(watch.weekendTimes) : [];
        dayTimes = {
          monday: weekday,
          tuesday: weekday,
          wednesday: weekday,
          thursday: weekday,
          friday: weekday,
          saturday: weekend,
          sunday: weekend,
        };
      }

      const item: Watch = {
        id: watch.id,
        userId: watch.userId,
        venue: venue ? { slug: venue.slug, name: venue.name } : null,
        dayTimes,
        active: Boolean(watch.active),
      };
      return item;
    })
  );

  const response: WatchesResponse = { watches: enriched };
  return NextResponse.json(response);
}

// POST /api/watches - Create a new watch
export async function POST(request: Request) {
  const userId = await getAuthedUserId(request);
  if (userId === null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { venueSlug, dayTimes } = body;

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
      dayTimes: dayTimes ? JSON.stringify(dayTimes) : null,
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

  const response: WatchResponse = {
    watch: {
      id: watch.id,
      userId: watch.userId,
      venue: venue ? { slug: venue.slug, name: venue.name } : null,
      dayTimes: watch.dayTimes ? (JSON.parse(watch.dayTimes) as DayTimes) : null,
      active: Boolean(watch.active),
    },
  };
  return NextResponse.json(response);
}
