import { db } from "../db";
import { notificationChannels, notificationLog, watches } from "../schema";
import { SlotChange } from "../differ";
import { sendTelegramMessage, formatSlotChangesForTelegram } from "./telegram";
import { sendEmail, formatSlotChangesForEmail, sendScrapeFailureAlert, sendScrapeSummary } from "./email";
import { anyToMinutes } from "../time";
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
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  // Map day of week to day name
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = dayNames[dayOfWeek];

  let preferredTimes: string[] = [];

  // Try new dayTimes format first
  if (watch.dayTimes) {
    try {
      const dayTimes = JSON.parse(watch.dayTimes);
      preferredTimes = dayTimes[dayName] || [];
    } catch {
      // If JSON parse fails, skip this watch
      return false;
    }
  } else {
    // Fall back to legacy weekday/weekend format
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const timesJson = isWeekend ? watch.weekendTimes : watch.weekdayTimes;

    // If no times configured for this day type, skip
    if (!timesJson) return false;

    try {
      preferredTimes = JSON.parse(timesJson);
    } catch {
      // If JSON parse fails, skip this watch
      return false;
    }
  }

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

  // Collect all matching slot changes per user (across ALL their watches).
  // Using a Map<userId, Set<SlotChange>> so duplicate slots (matched by >1 watch) are deduplicated.
  const userChanges = new Map<number, Set<SlotChange>>();

  for (const watch of activeWatches) {
    if (!watch.userId) continue;

    const matchingChanges = changes.filter((c) =>
      matchesWatch(c, watch, venueIdMap)
    );

    if (matchingChanges.length === 0) continue;

    if (!userChanges.has(watch.userId)) {
      userChanges.set(watch.userId, new Set());
    }
    for (const change of matchingChanges) {
      userChanges.get(watch.userId)!.add(change);
    }
  }

  // For each user, send ONE notification per channel with all their matched slots bundled
  for (const [userId, changesSet] of userChanges) {
    const allMatchingChanges = [...changesSet];

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
        const slotKey = `${change.venue}:${change.date}:${change.time}:${change.court}`;

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
            const slotKey = `${change.venue}:${change.date}:${change.time}:${change.court}`;
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
