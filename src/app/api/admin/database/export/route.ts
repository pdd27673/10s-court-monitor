import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, watches, venues, slots, notificationChannels, notificationLog, registrationRequests } from "@/lib/schema";
import { eq } from "drizzle-orm";

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

    // Export all tables
    const allUsers = await db.select().from(users);
    const allWatches = await db.select().from(watches);
    const allVenues = await db.select().from(venues);
    const allSlots = await db.select().from(slots);
    const allChannels = await db.select().from(notificationChannels);
    const allLogs = await db.select().from(notificationLog);
    const allRequests = await db.select().from(registrationRequests);

    const exportData = {
      exportedAt: new Date().toISOString(),
      version: "1.0",
      data: {
        users: allUsers,
        watches: allWatches,
        venues: allVenues,
        slots: allSlots,
        notificationChannels: allChannels,
        notificationLog: allLogs,
        registrationRequests: allRequests,
      },
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="database-backup-${new Date().toISOString().split('T')[0]}.json"`,
      },
    });
  } catch (error) {
    console.error("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}
