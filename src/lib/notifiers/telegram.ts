import { SlotChange } from "../differ";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export async function sendTelegramMessage(chatId: string, message: string) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn("TELEGRAM_BOT_TOKEN not set, skipping Telegram notification");
    return;
  }

  const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "HTML",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Telegram API error: ${error}`);
  }

  return response.json();
}

export function formatSlotChangesForTelegram(changes: SlotChange[]): string {
  if (changes.length === 0) return "";

  const lines = ["🎾 <b>Tennis courts now available!</b>\n"];

  // Group by venue and date
  const grouped: Record<string, SlotChange[]> = {};
  for (const change of changes) {
    const key = `${change.venueName}|${change.date}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(change);
  }

  for (const [key, slots] of Object.entries(grouped)) {
    const [venueName, date] = key.split("|");
    const formattedDate = new Date(date).toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });

    lines.push(`📍 <b>${venueName}</b> - ${formattedDate}`);

    for (const slot of slots) {
      const priceStr = slot.price ? ` (${slot.price})` : "";
      lines.push(`  • ${slot.time} - ${slot.court}${priceStr}`);
    }
    lines.push("");
  }

  lines.push("🔗 Book online to reserve your slot");

  return lines.join("\n");
}
