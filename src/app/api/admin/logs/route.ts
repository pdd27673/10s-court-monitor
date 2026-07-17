import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { notificationLog } from "@/lib/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

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
