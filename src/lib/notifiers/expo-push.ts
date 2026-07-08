import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { SlotChange } from "../differ";

// Off-the-shelf Expo push client. Handles batching + receipts.
// Access token is optional (only needed for enhanced security / higher limits).
const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
});

export type ExpoPushResult =
  | { ok: true }
  | { ok: false; deviceNotRegistered: boolean; error: string };

/**
 * Send a single push message to one Expo push token.
 * Returns a structured result so the caller can deactivate dead devices
 * (Expo returns "DeviceNotRegistered" once a user uninstalls / disables push).
 */
export async function sendExpoPush(
  pushToken: string,
  payload: { title: string; body: string; data?: Record<string, unknown> }
): Promise<ExpoPushResult> {
  if (!Expo.isExpoPushToken(pushToken)) {
    return {
      ok: false,
      deviceNotRegistered: false,
      error: `Invalid Expo push token: ${pushToken}`,
    };
  }

  const message: ExpoPushMessage = {
    to: pushToken,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
    priority: "high",
  };

  let tickets: ExpoPushTicket[];
  try {
    // One message, but the SDK still wants a chunked array.
    const chunks = expo.chunkPushNotifications([message]);
    tickets = [];
    for (const chunk of chunks) {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
    }
  } catch (error) {
    return {
      ok: false,
      deviceNotRegistered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const ticket = tickets[0];
  if (ticket && ticket.status === "error") {
    const deviceNotRegistered =
      ticket.details?.error === "DeviceNotRegistered";
    return {
      ok: false,
      deviceNotRegistered,
      error: ticket.message ?? "Unknown Expo push error",
    };
  }

  return { ok: true };
}

/**
 * Build the notification title/body for a batch of newly-available slots.
 * Mirrors formatSlotChangesForTelegram but returns a title + short body
 * suited to a lock-screen push.
 */
export function formatSlotChangesForExpoPush(changes: SlotChange[]): {
  title: string;
  body: string;
} {
  if (changes.length === 0) {
    return { title: "Court available", body: "" };
  }

  // Group by venue + date for a compact body.
  const grouped: Record<string, SlotChange[]> = {};
  for (const change of changes) {
    const key = `${change.venueName}|${change.date}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(change);
  }

  const parts: string[] = [];
  for (const [key, slots] of Object.entries(grouped)) {
    const [venueName, date] = key.split("|");
    const formattedDate = new Date(date).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const times = slots.map((s) => s.time).join(", ");
    parts.push(`${venueName} (${formattedDate}): ${times}`);
  }

  const total = changes.length;
  const title =
    total === 1
      ? "🎾 A court just opened up!"
      : `🎾 ${total} courts just opened up!`;

  return { title, body: parts.join(" · ") };
}
