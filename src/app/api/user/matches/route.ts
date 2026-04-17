import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, notificationLog, slots, venues } from "@/lib/schema";
import { eq, desc, and } from "drizzle-orm";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, session.user.email.toLowerCase()))
      .limit(1);

    if (!user[0]) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Get recent notification logs for this user, ordered by most recent
    const recentLogs = await db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.userId, user[0].id))
      .orderBy(desc(notificationLog.sentAt))
      .limit(100);

    // Deduplicate by slotKey (keep most recent sentAt per slot)
    const seenKeys = new Set<string>();
    const uniqueLogs: typeof recentLogs = [];
    for (const log of recentLogs) {
      if (!seenKeys.has(log.slotKey)) {
        seenKeys.add(log.slotKey);
        uniqueLogs.push(log);
        if (uniqueLogs.length >= 20) break;
      }
    }

    if (uniqueLogs.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    // Load all venues for lookup
    const allVenues = await db.select().from(venues);
    const venueBySlug = Object.fromEntries(allVenues.map((v) => [v.slug, v]));

    const today = new Date().toISOString().split("T")[0];

    // Enrich each log entry with current slot status
    const matches = await Promise.all(
      uniqueLogs.map(async (log) => {
        const parts = log.slotKey.split(":");
        if (parts.length < 4) return null;
        const [venueSlug, date, time, ...courtParts] = parts;
        const court = courtParts.join(":"); // court names can contain colons

        const venue = venueBySlug[venueSlug];
        if (!venue) return null;

        const isExpired = date < today;

        let currentStatus: string = "unknown";

        if (!isExpired) {
          const slot = await db
            .select()
            .from(slots)
            .where(
              and(
                eq(slots.venueId, venue.id),
                eq(slots.date, date),
                eq(slots.time, time),
                eq(slots.court, court)
              )
            )
            .limit(1);

          currentStatus = slot[0]?.status ?? "unknown";
        } else {
          currentStatus = "expired";
        }

        return {
          slotKey: log.slotKey,
          sentAt: log.sentAt,
          venueSlug,
          venueName: venue.name,
          date,
          time,
          court,
          currentStatus,
          isExpired,
        };
      })
    );

    return NextResponse.json({
      matches: matches.filter(Boolean),
    });
  } catch (error) {
    console.error("Error fetching user matches:", error);
    return NextResponse.json(
      { error: "Failed to fetch matches" },
      { status: 500 }
    );
  }
}
