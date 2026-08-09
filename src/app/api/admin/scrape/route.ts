import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { runFeedIngest } from "@/lib/ingest/run";

/**
 * Admin "refresh now" trigger. Runs the exact same pipeline as the cron/worker
 * (`runFeedIngest`) but in `force` mode — bypassing the per-clock throttles so
 * every availability stage runs immediately. Kept in one place so admin can't
 * drift from the scheduled path.
 */

// Prevent overlapping manual runs within this process.
let isJobRunning = false;

export async function POST() {
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

    if (isJobRunning) {
      return NextResponse.json({ error: "Ingest job already running" }, { status: 409 });
    }

    // Run the full pipeline unthrottled in the background (don't await).
    isJobRunning = true;
    runFeedIngest({ force: true })
      .catch((error) => console.error("Manual ingest failed:", error))
      .finally(() => {
        isJobRunning = false;
      });

    return NextResponse.json({ success: true, message: "Ingest started" });
  } catch (error) {
    console.error("Error starting ingest:", error);
    return NextResponse.json({ error: "Failed to start ingest" }, { status: 500 });
  }
}
