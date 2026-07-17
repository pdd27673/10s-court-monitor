import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { users, venues, slots, watches, notificationChannels, notificationLog, registrationRequests } from "@/lib/schema";
import { eq, count, desc } from "drizzle-orm";

export async function GET() {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

    // Get all statistics
    const [userCount] = await db.select({ count: count() }).from(users);
    const [allowedUserCount] = await db.select({ count: count() }).from(users).where(eq(users.isAllowed, 1));
    const [venueCount] = await db.select({ count: count() }).from(venues);
    const [slotCount] = await db.select({ count: count() }).from(slots);
    const [watchCount] = await db.select({ count: count() }).from(watches);
    const [activeWatchCount] = await db.select({ count: count() }).from(watches).where(eq(watches.active, 1));
    const [channelCount] = await db.select({ count: count() }).from(notificationChannels);
    const [logCount] = await db.select({ count: count() }).from(notificationLog);
    const [pendingRequestCount] = await db.select({ count: count() }).from(registrationRequests).where(eq(registrationRequests.status, "pending"));

    // Get recent activity
    const recentNotifications = await db
      .select()
      .from(notificationLog)
      .orderBy(desc(notificationLog.sentAt))
      .limit(10);

    return NextResponse.json({
      stats: {
        totalUsers: userCount.count,
        allowedUsers: allowedUserCount.count,
        totalVenues: venueCount.count,
        totalSlots: slotCount.count,
        totalWatches: watchCount.count,
        activeWatches: activeWatchCount.count,
        totalChannels: channelCount.count,
        totalNotifications: logCount.count,
        pendingRequests: pendingRequestCount.count,
      },
      recentNotifications,
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return NextResponse.json({ error: "Failed to fetch statistics" }, { status: 500 });
  }
}
