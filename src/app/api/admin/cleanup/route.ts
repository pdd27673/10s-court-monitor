import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, slots, notificationLog } from "@/lib/schema";
import { lt, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";

export async function POST(request: Request) {
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

    const body = await request.json();
    const days = body.days || 7;

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoff = cutoffDate.toISOString().split("T")[0];

    // Delete old data
    const deletedSlots = await db.delete(slots).where(lt(slots.date, cutoff)).returning();
    const deletedLogs = await db.delete(notificationLog).where(lt(notificationLog.sentAt, cutoff)).returning();

    // Vacuum database
    db.run(sql`VACUUM`);

    return NextResponse.json({
      success: true,
      deletedSlots: deletedSlots.length,
      deletedLogs: deletedLogs.length,
    });
  } catch (error) {
    console.error("Error running cleanup:", error);
    return NextResponse.json({ error: "Failed to run cleanup" }, { status: 500 });
  }
}
