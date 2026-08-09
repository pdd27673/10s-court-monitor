/**
 * Shared slot-write helper: the transition-detection half that every writer
 * (feed head-poll, ClubSpark poll, Courtside reconcile/sweep) had copy-pasted.
 *
 * Each writer still owns its own UPSERT — they persist different column subsets
 * (the feed writes starts_at/remaining_uses/max_uses; the scrapers write only
 * status/price/court_id/start_minute and must not clobber feed metadata). What
 * was identical across all three is the "read the prior stored status, decide if
 * this is a booked/closed→available flip, and build the SlotChange to notify on"
 * step. That lives here so the transition rule has one definition.
 */
import { db } from "../db";
import { slots } from "../schema";
import { and, eq } from "drizzle-orm";
import { isNewlyAvailable } from "./openactive/parse";
import type { SlotChange } from "../differ";

/**
 * Look up the current stored status for `(venueId, date, time, court)` and, when
 * the incoming `status` is a newly-available flip from it, return the `SlotChange`
 * to notify on (else `change: null`). Never writes — the caller upserts.
 */
export async function detectSlotTransition(
  venueId: number,
  s: { date: string; time: string; court: string; status: string; price?: string },
  meta: { venue: string; venueName: string }
): Promise<{ oldStatus: string | null; change: SlotChange | null }> {
  const existing = await db.query.slots.findFirst({
    where: and(
      eq(slots.venueId, venueId),
      eq(slots.date, s.date),
      eq(slots.time, s.time),
      eq(slots.court, s.court)
    ),
  });
  const oldStatus = existing?.status ?? null;
  if (!isNewlyAvailable(oldStatus, s.status)) return { oldStatus, change: null };
  return {
    oldStatus,
    change: {
      venue: meta.venue,
      venueName: meta.venueName,
      date: s.date,
      time: s.time,
      court: s.court,
      oldStatus,
      newStatus: s.status,
      price: s.price,
    },
  };
}
