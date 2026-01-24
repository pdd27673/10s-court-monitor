import { db } from "../db";
import { notificationChannels, notificationLog, watches } from "../schema";
import { SlotChange } from "../differ";
import { sendTelegramMessage, formatSlotChangesForTelegram } from "./telegram";
import { sendEmail, formatSlotChangesForEmail } from "./email";
import { eq, and } from "drizzle-orm";

// Check if a slot matches a user's watch preferences
function matchesWatch(
  change: SlotChange,
  watch: {
    venueId: number | null;
    weekdayTimes: string | null;
    weekendTimes: string | null;
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
  const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

  // Get the appropriate time list based on day type
  const timesJson = isWeekend ? watch.weekendTimes : watch.weekdayTimes;

  // If no times configured for this day type, skip
  if (!timesJson) return false;

  try {
    const preferredTimes: string[] = JSON.parse(timesJson);
    // Direct match on am/pm times (e.g., "5pm", "6pm")
    const changeTime = change.time.toLowerCase().trim();
    if (!preferredTimes.some((t) => t.toLowerCase().trim() === changeTime)) {
      return false;
    }
  } catch {
    // If JSON parse fails, skip this watch
    return false;
  }

  return true;
}

// Send notifications for slot changes
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

  // For each watch, find matching changes and notify
  for (const watch of activeWatches) {
    const matchingChanges = changes.filter((c) =>
      matchesWatch(c, watch, venueIdMap)
    );

    if (matchingChanges.length === 0) continue;

    // Get notification channels for this user
    const channels = await db.query.notificationChannels.findMany({
      where: and(
        eq(notificationChannels.userId, watch.userId!),
        eq(notificationChannels.active, 1)
      ),
    });

    for (const channel of channels) {
      // Check if we already notified for these slots (prevent duplicates)
      const notifiedSlots: SlotChange[] = [];

      for (const change of matchingChanges) {
        const slotKey = `${change.venue}:${change.date}:${change.time}:${change.court}`;

        // Check if already notified
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
        // Send notification based on channel type
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
            `Unsupported notification channel type: ${channel.type} for user ${watch.userId}. ` +
            `Channel ID: ${channel.id}. Notification not sent.`
          );
          // Don't log as sent - skip this channel
          continue;
        }

        // Only log notifications if they were actually sent
        if (notificationSent) {
          for (const change of notifiedSlots) {
            const slotKey = `${change.venue}:${change.date}:${change.time}:${change.court}`;
            await db.insert(notificationLog).values({
              userId: watch.userId,
              channelId: channel.id,
              slotKey,
            });
          }

          console.log(
            `Notified user ${watch.userId} via ${channel.type}: ${notifiedSlots.length} slots`
          );
        }
      } catch (error) {
        console.error(
          `Failed to notify user ${watch.userId} via ${channel.type}:`,
          error
        );
        // Don't log as sent if there was an error
      }
    }
  }
}
