import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { users, watches, venues, slots, notificationChannels, notificationLog, registrationRequests } from "@/lib/schema";
import { count } from "drizzle-orm";

export async function GET() {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

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
