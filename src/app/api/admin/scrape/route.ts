import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/schema";
import { eq } from "drizzle-orm";
import { ensureVenuesExist } from "@/lib/differ";
import { notifyUsers } from "@/lib/notifiers";
import { ingestFacilities, pollSlots } from "@/lib/ingest/openactive/ingest";
import { fullSweep } from "@/lib/ingest/reconcile";
import type { SlotChange } from "@/lib/differ";

/**
 * Admin "refresh now" trigger. Runs the feed-primary ingestion on demand,
 * unthrottled: refresh venues/courts from the facility feed, delta-poll the
 * slots feed (Clock 1), then a full sweep (Clock 3) as the correctness floor.
 * Transitions from both are unioned into one notifyUsers call.
 */
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

    // Run ingestion in the background
    (async () => {
      try {
        await ensureVenuesExist();
        await ingestFacilities();

        const changes: SlotChange[] = [];
        const poll = await pollSlots({ persist: true });
        changes.push(...poll.changes);
        const sweep = await fullSweep({ persist: true });
        changes.push(...sweep.changes);

        if (changes.length > 0) {
          await notifyUsers(changes);
        }

        console.log(
          `Manual ingest completed: poll ${poll.slotsUpserted} upserts / ${poll.transitions} transitions, ` +
            `sweep ${sweep.upserted} upserts / ${sweep.transitions} transitions`
        );
      } catch (error) {
        console.error("Manual ingest failed:", error);
      }
    })();

    return NextResponse.json({ success: true, message: "Ingest started" });
  } catch (error) {
    console.error("Error starting ingest:", error);
    return NextResponse.json({ error: "Failed to start ingest" }, { status: 500 });
  }
}
