import { NextResponse } from "next/server";
import { sendTelegramMessage } from "@/lib/notifiers/telegram";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// POST /api/telegram/webhook - Handle incoming Telegram bot messages
export async function POST(request: Request) {
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: "Telegram bot not configured" }, { status: 500 });
  }

  try {
    const update = await request.json();

    // Handle message updates
    if (update.message) {
      const chatId = update.message.chat.id;
      const messageText = update.message.text || "";
      const firstName = update.message.chat.first_name || "there";

      // Respond with chat ID
      const responseMessage = `👋 Hello ${firstName}!\n\n` +
        `Your Telegram Chat ID is:\n` +
        `<b>${chatId}</b>\n\n` +
        `Copy this number and use it when setting up notifications in the dashboard.\n\n` +
        `🔗 Visit your dashboard to configure alerts: ${process.env.NEXT_PUBLIC_APP_URL || "https://your-app.com"}/dashboard?tab=settings`;

      await sendTelegramMessage(String(chatId), responseMessage);

      return NextResponse.json({ ok: true });
    }

    // Handle other update types (e.g., edited messages, channel posts)
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
