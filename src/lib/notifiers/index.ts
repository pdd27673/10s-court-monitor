import { db } from "../db";
import { notificationChannels, notificationLog, watches } from "../schema";
import { SlotChange } from "../differ";
import { sendTelegramMessage, formatSlotChangesForTelegram } from "./telegram";
import { sendEmail, formatSlotChangesForEmail, sendScrapeFailureAlert, sendScrapeSummary } from "./email";
import { anyToMinutes, DAY_NAMES, watchPreferredTimes } from "../time";
import { eq, and } from "drizzle-orm";

export { sendScrapeFailureAlert, sendScrapeSummary };

// Check if a slot matches a user's watch preferences
function matchesWatch(
  change: SlotChange,
  watch: {
    venueId: number | null;
    dayTimes: string | null;
    weekdayTimes: string | null; // Legacy field
    weekendTimes: string | null; // Legacy field
  },
  venueIdMap: Record<string, number>
): boolean {
  // Check venue match (null = all venues)
  if (watch.venueId !== null) {
    const changeVenueId = venueIdMap[change.venue];
    if (changeVenueId !== watch.venueId) return false;
  }

  // Check day of week and time preferences
  const date = new Date(change.date);
  const dayName = DAY_NAMES[date.getDay()]; // 0 = Sunday … 6 = Saturday

  // Shared with the reconcile/pending planner so matching and targeting never
  // drift; dayTimes-first with legacy weekday/weekend fallback, [] on bad JSON.
  const preferredTimes = watchPreferredTimes(watch, dayName);

  // If no times configured for this specific day, skip
  if (preferredTimes.length === 0) return false;

  // Compare on minute-of-day, not label strings — so a watch stored as "19:00"
  // matches a slot labelled "7pm" (and vice versa) through the dayTimes migration.
  const changeMinutes = anyToMinutes(change.time);
  if (changeMinutes === null) return false;
  if (!preferredTimes.some((t) => anyToMinutes(t) === changeMinutes)) {
    return false;
  }

  return true;
}

/** Stable dedup key for a slot change. Time is normalized to minute-of-day so the
 * SAME court-hour reported once as "7pm" and later as "19:00" maps to ONE key
 * (watch matching uses the same `anyToMinutes` normalization); falls back to the
 * lowercased label if unparseable. Backs both the per-tick value-dedup and the
 * `notification_log` dedup so neither can be fooled by the time-format migration. */
function slotKeyOf(c: SlotChange): string {
  const mins = anyToMinutes(c.time);
  const timePart = mins == null ? c.time.toLowerCase().trim() : String(mins);
  return `${c.venue}:${c.date}:${timePart}:${c.court}`;
}

// Send notifications for slot changes — one bundled notification per user per channel
export async function notifyUsers(changes: SlotChange[]) {
  if (changes.length === 0) return;

  // Get all active watches with their users and channels
  const activeWatches = await db.query.watches.findMany({
    where: eq(watches.active, 1),
  });

  // Build venue ID map
  const allVenues = await db.query.venues.findMany();
  const venueIdMap: Record<string, number> = {};
  for (const v of allVenues) {
    venueIdMap[v.slug] = v.id;
  }

  // Collect all matching slot changes per user (across ALL their watches),
  // deduplicated by stable slot key. A Map keyed by slotKey collapses the same
  // court-hour whether it's matched by several watches or emitted by several clocks
  // in one tick (the old Set<SlotChange> only deduped identical object references).
  const userChanges = new Map<number, Map<string, SlotChange>>();

  for (const watch of activeWatches) {
    if (!watch.userId) continue;

    const matchingChanges = changes.filter((c) =>
      matchesWatch(c, watch, venueIdMap)
    );

    if (matchingChanges.length === 0) continue;

    let bucket = userChanges.get(watch.userId);
    if (!bucket) {
      bucket = new Map();
      userChanges.set(watch.userId, bucket);
    }
    for (const change of matchingChanges) {
      bucket.set(slotKeyOf(change), change);
    }
  }

  // For each user, send ONE notification per channel with all their matched slots bundled
  for (const [userId, changesMap] of userChanges) {
    const allMatchingChanges = [...changesMap.values()];

    // Get this user's active notification channels
    const channels = await db.query.notificationChannels.findMany({
      where: and(
        eq(notificationChannels.userId, userId),
        eq(notificationChannels.active, 1)
      ),
    });

    for (const channel of channels) {
      // Filter out slots already notified via this channel (dedup)
      const notifiedSlots: SlotChange[] = [];

      for (const change of allMatchingChanges) {
        const slotKey = slotKeyOf(change);

        const existing = await db.query.notificationLog.findFirst({
          where: and(
            eq(notificationLog.channelId, channel.id),
            eq(notificationLog.slotKey, slotKey)
          ),
        });

        if (!existing) {
          notifiedSlots.push(change);
        }
      }

      if (notifiedSlots.length === 0) continue;

      try {
        let notificationSent = false;

        if (channel.type === "telegram") {
          const message = formatSlotChangesForTelegram(notifiedSlots);
          await sendTelegramMessage(channel.destination, message);
          notificationSent = true;
        } else if (channel.type === "email") {
          const { subject, html } = formatSlotChangesForEmail(notifiedSlots);
          await sendEmail(channel.destination, subject, html);
          notificationSent = true;
        } else {
          // Unsupported channel type (e.g., whatsapp)
          console.error(
            `Unsupported notification channel type: ${channel.type} for user ${userId}. ` +
            `Channel ID: ${channel.id}. Notification not sent.`
          );
          continue;
        }

        // Only log notifications if they were actually sent
        if (notificationSent) {
          for (const change of notifiedSlots) {
            const slotKey = slotKeyOf(change);
            await db.insert(notificationLog).values({
              userId,
              channelId: channel.id,
              slotKey,
            });
          }

          console.log(
            `Notified user ${userId} via ${channel.type}: ${notifiedSlots.length} slot(s) bundled`
          );
        }
      } catch (error) {
        console.error(
          `Failed to notify user ${userId} via ${channel.type}:`,
          error
        );
        // Don't log as sent if there was an error
      }
    }
  }
}
