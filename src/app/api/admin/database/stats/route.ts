import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, watches, venues, slots, notificationChannels, notificationLog, registrationRequests } from "@/lib/schema";
import { eq, count } from "drizzle-orm";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await db.select().from(users).where(eq(users.email, session.user.email)).limit(1);
    if (!user[0] || !user[0].isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get counts for all tables
    const [usersCount] = await db.select({ count: count() }).from(users);
    const [watchesCount] = await db.select({ count: count() }).from(watches);
    const [venuesCount] = await db.select({ count: count() }).from(venues);
    const [slotsCount] = await db.select({ count: count() }).from(slots);
    const [channelsCount] = await db.select({ count: count() }).from(notificationChannels);
    const [notificationLogCount] = await db.select({ count: count() }).from(notificationLog);
    const [requestsCount] = await db.select({ count: count() }).from(registrationRequests);

    const stats = {
      tables: {
        users: usersCount.count,
        watches: watchesCount.count,
        venues: venuesCount.count,
        slots: slotsCount.count,
        notificationChannels: channelsCount.count,
        notificationLog: notificationLogCount.count,
        registrationRequests: requestsCount.count,
      },
    };

    return NextResponse.json({ stats });
  } catch (error) {
    console.error("Error fetching database stats:", error);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
