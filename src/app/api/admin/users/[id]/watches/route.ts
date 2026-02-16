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
    const adminUser = await db.select().from(users).where(eq(users.email, session.user.email.toLowerCase())).limit(1);
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
        dayTimes: watches.dayTimes,
        weekdayTimes: watches.weekdayTimes,
        weekendTimes: watches.weekendTimes,
        active: watches.active,
        venueSlug: venues.slug,
        venueName: venues.name,
      })
      .from(watches)
      .leftJoin(venues, eq(watches.venueId, venues.id))
      .where(eq(watches.userId, userId));

    const formattedWatches = userWatches.map((w) => {
      // Support both new dayTimes and legacy weekday/weekend fields
      let dayTimes = null;
      if (w.dayTimes) {
        dayTimes = JSON.parse(w.dayTimes);
      } else if (w.weekdayTimes || w.weekendTimes) {
        // Convert legacy format to new format
        const weekday = w.weekdayTimes ? JSON.parse(w.weekdayTimes) : [];
        const weekend = w.weekendTimes ? JSON.parse(w.weekendTimes) : [];
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

      return {
        id: w.id,
        venueSlug: w.venueSlug,
        venueName: w.venueName,
        dayTimes,
        active: Boolean(w.active),
      };
    });

    return NextResponse.json({ watches: formattedWatches });
  } catch (error) {
    console.error("Error fetching user watches:", error);
    return NextResponse.json({ error: "Failed to fetch watches" }, { status: 500 });
  }
}
