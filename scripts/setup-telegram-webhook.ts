#!/usr/bin/env npx tsx
/**
 * Setup Telegram Webhook
 * 
 * This script configures your Telegram bot to send updates to your webhook endpoint.
 * 
 * Usage:
 *   npx tsx scripts/setup-telegram-webhook.ts
 * 
 * Requirements:
 *   - TELEGRAM_BOT_TOKEN must be set in environment
 *   - NEXT_PUBLIC_APP_URL must be set to your deployed app URL
 *   - The webhook endpoint must be publicly accessible
 */

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL;

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ ERROR: TELEGRAM_BOT_TOKEN is not set in environment");
  process.exit(1);
}

if (!APP_URL) {
  console.error("❌ ERROR: NEXT_PUBLIC_APP_URL or AUTH_URL is not set");
  console.error("   Set it to your deployed app URL (e.g., https://your-app.railway.app)");
  process.exit(1);
}

const webhookUrl = `${APP_URL}/api/telegram/webhook`;
const telegramApi = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN!}`;

async function setupWebhook() {
  console.log("🔧 Checking Telegram webhook status...");
  console.log(`   Bot Token: ${TELEGRAM_BOT_TOKEN!.substring(0, 10)}...`);
  console.log(`   Target URL: ${webhookUrl}`);
  console.log();

  try {
    // First, check current webhook status
    const infoResponse = await fetch(`${telegramApi}/getWebhookInfo`);
    const info = await infoResponse.json();
    
    if (!info.ok) {
      console.error("❌ Failed to get webhook info:", info);
      process.exit(1);
    }

    const currentUrl = info.result.url || "";
    const isAlreadySet = currentUrl === webhookUrl;

    if (isAlreadySet) {
      console.log("✅ Webhook is already set correctly!");
      console.log(`   Current URL: ${currentUrl}`);
      console.log(`   Pending updates: ${info.result.pending_update_count || 0}`);
      
      if (info.result.last_error_date) {
        console.log(`   ⚠️  Last error: ${info.result.last_error_message}`);
        console.log(`   Error date: ${new Date(info.result.last_error_date * 1000).toISOString()}`);
      } else {
        console.log(`   ✅ No errors - webhook is working!`);
      }
      
      console.log();
      console.log("🎉 Your bot is ready! No changes needed.");
      return;
    }

    if (currentUrl) {
      console.log(`⚠️  Webhook is currently set to a different URL:`);
      console.log(`   Current: ${currentUrl}`);
      console.log(`   Updating to: ${webhookUrl}`);
      console.log();
    } else {
      console.log("📝 No webhook set yet. Setting it up now...");
      console.log();
    }

    // Set webhook
    const response = await fetch(`${telegramApi}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        drop_pending_updates: true, // Clear any pending updates
      }),
    });

    const result = await response.json();

    if (result.ok) {
      console.log("✅ Webhook set successfully!");
      console.log();
      
      // Get updated webhook info to verify
      const updatedInfoResponse = await fetch(`${telegramApi}/getWebhookInfo`);
      const updatedInfo = await updatedInfoResponse.json();
      
      if (updatedInfo.ok) {
        console.log("📋 Webhook Info:");
        console.log(`   URL: ${updatedInfo.result.url}`);
        console.log(`   Pending updates: ${updatedInfo.result.pending_update_count || 0}`);
        if (updatedInfo.result.last_error_date) {
          console.log(`   ⚠️  Last error: ${updatedInfo.result.last_error_message}`);
        }
      }
      
      console.log();
      console.log("🎉 Your bot is now ready!");
      console.log("   Users can message @MvgMonitorBot and it will respond with their Chat ID.");
    } else {
      console.error("❌ Failed to set webhook:");
      console.error(result);
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Error setting webhook:", error);
    process.exit(1);
  }
}

setupWebhook();
