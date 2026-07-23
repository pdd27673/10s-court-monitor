/**
 * One place to write the `feed_state` table. It carries two kinds of rows under
 * the `(source, feed)` unique key:
 *   • RPDE cursors  — `source='openactive'`, `next_cursor` = the head to resume from.
 *   • clock stamps  — `source='clock'|'reconcile'`, `last_polled_at` = when a
 *                     throttled clock / reconciled venue-day last ran.
 *
 * `upsertFeedState` is the shared insert-or-update so the five call sites (the
 * three OpenActive cursor writers, `stampClock`, `markReconciled`) don't each
 * re-spell the `onConflictDoUpdate`. `lastPolledAt` defaults to now; `nextCursor`
 * is only written (and only overwritten on conflict) when provided, so a clock
 * stamp never clobbers a cursor and vice-versa.
 */
import { db } from "../db";
import { feedState } from "../schema";

export async function upsertFeedState(
  source: string,
  feed: string,
  fields: { nextCursor?: string; lastPolledAt?: string } = {}
): Promise<void> {
  const lastPolledAt = fields.lastPolledAt ?? new Date().toISOString();
  const values: typeof feedState.$inferInsert = { source, feed, lastPolledAt };
  const set: Partial<typeof feedState.$inferInsert> = { lastPolledAt };
  if (fields.nextCursor !== undefined) {
    values.nextCursor = fields.nextCursor;
    set.nextCursor = fields.nextCursor;
  }
  await db
    .insert(feedState)
    .values(values)
    .onConflictDoUpdate({ target: [feedState.source, feedState.feed], set });
}
