import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { ensureVenuesExist } from "@/lib/differ";
import { notifyUsers } from "@/lib/notifiers";
import { ingestFacilities, pollSlots } from "@/lib/ingest/openactive/ingest";
import { fullSweep } from "@/lib/ingest/reconcile";
import { pollClubSpark } from "@/lib/ingest/clubspark/ingest";
import type { SlotChange } from "@/lib/differ";

/**
 * Admin "refresh now" trigger. Runs the feed-primary ingestion on demand,
 * unthrottled: refresh venues/courts from the facility feed, delta-poll the
 * slots feed (Clock 1), then a full sweep (Clock 3) as the correctness floor.
 * Transitions from both are unioned into one notifyUsers call.
 */
export async function POST() {
  try {
    const gate = await requireAdmin();
    if ("error" in gate) return gate.error;

    // Run ingestion in the background
    (async () => {
      try {
        await ensureVenuesExist();
        await ingestFacilities();

        const changes: SlotChange[] = [];
        const poll = await pollSlots({ persist: true });
        changes.push(...poll.changes);
        const clubspark = await pollClubSpark({ persist: true });
        changes.push(...clubspark.changes);
        const sweep = await fullSweep({ persist: true });
        changes.push(...sweep.changes);

        if (changes.length > 0) {
          await notifyUsers(changes);
        }

        console.log(
          `Manual ingest completed: poll ${poll.slotsUpserted} upserts / ${poll.transitions} transitions, ` +
            `clubspark ${clubspark.slotsUpserted} upserts / ${clubspark.transitions} transitions, ` +
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
