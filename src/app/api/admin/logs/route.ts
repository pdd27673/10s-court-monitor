import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, notificationLog } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await db.select().from(users).where(eq(users.email, session.user.email.toLowerCase())).limit(1);
    if (!user[0] || !user[0].isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get recent notification logs as system logs
    const logs = await db
      .select({
        id: notificationLog.id,
        timestamp: notificationLog.sentAt,
        level: notificationLog.slotKey, // Repurpose slotKey as message type
        message: notificationLog.slotKey,
      })
      .from(notificationLog)
      .orderBy(desc(notificationLog.sentAt))
      .limit(100);

    // Format logs to include proper levels
    const formattedLogs = logs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp,
      level: "info",
      message: `Notification sent for slot: ${log.message}`,
    }));

    return NextResponse.json({ logs: formattedLogs });
  } catch (error) {
    console.error("Error fetching logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
