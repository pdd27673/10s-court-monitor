import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, watches, venues } from "@/lib/schema";
import { eq } from "drizzle-orm";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const adminUser = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
    if (!adminUser[0] || !adminUser[0].isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    // Get user watches
    const userWatches = await db
      .select({
        id: watches.id,
        venueId: watches.venueId,
        weekdayTimes: watches.weekdayTimes,
        weekendTimes: watches.weekendTimes,
        active: watches.active,
        venueSlug: venues.slug,
        venueName: venues.name,
      })
      .from(watches)
      .leftJoin(venues, eq(watches.venueId, venues.id))
      .where(eq(watches.userId, userId));

    const formattedWatches = userWatches.map((w) => ({
      id: w.id,
      venueSlug: w.venueSlug,
      venueName: w.venueName,
      weekdayTimes: w.weekdayTimes ? JSON.parse(w.weekdayTimes) : [],
      weekendTimes: w.weekendTimes ? JSON.parse(w.weekendTimes) : [],
      active: Boolean(w.active),
    }));

    return NextResponse.json({ watches: formattedWatches });
  } catch (error) {
    console.error("Error fetching user watches:", error);
    return NextResponse.json({ error: "Failed to fetch watches" }, { status: 500 });
  }
}
