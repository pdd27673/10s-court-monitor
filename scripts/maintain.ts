#!/usr/bin/env npx tsx
/**
 * Tennis Court Notifier - Maintenance Utility
 *
 * A smart CLI tool for managing the project.
 *
 * Usage:
 *   npx tsx scripts/maintain.ts <command> [options]
 *
 * Commands:
 *   status          Show system health and stats
 *   users           List all users with their watches and channels
 *   add-user        Add a new user with watch and notification channel
 *   cleanup         Clean up old data (slots, logs)
 *   test-notify     Send a test notification to a user
 *   scrape          Run a manual scrape
 *   db-stats        Show database statistics
 *   export          Export data to JSON
 *   reset-logs      Clear notification logs (allows re-notification)
 */

import { db } from "../src/lib/db";
import {
  users,
  venues,
  slots,
  watches,
  notificationChannels,
  notificationLog,
} from "../src/lib/schema";
import { eq, lt, sql, count, desc } from "drizzle-orm";
import { scrapeVenue, getNextNDays } from "../src/lib/scraper";
import { VENUES } from "../src/lib/constants";
import { sendEmail } from "../src/lib/notifiers/email";
import { sendTelegramMessage } from "../src/lib/notifiers/telegram";

const args = process.argv.slice(2);
const command = args[0];

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message: string, color?: keyof typeof colors) {
  const c = color ? colors[color] : "";
  console.log(`${c}${message}${colors.reset}`);
}

function header(title: string) {
  console.log();
  log(`═══ ${title} ═══`, "bright");
  console.log();
}

async function showStatus() {
  header("System Status");

  // Database check
  try {
    const result = db.get<{ ok: number }>(sql`SELECT 1 as ok`);
    log(`✓ Database: Connected`, "green");
  } catch (e) {
    log(`✗ Database: Error - ${e}`, "red");
  }

  // Count records
  const userCount = await db.select({ count: count() }).from(users);
  const venueCount = await db.select({ count: count() }).from(venues);
  const slotCount = await db.select({ count: count() }).from(slots);
  const watchCount = await db.select({ count: count() }).from(watches);
  const channelCount = await db.select({ count: count() }).from(notificationChannels);
  const logCount = await db.select({ count: count() }).from(notificationLog);

  console.log();
  log("Record Counts:", "cyan");
  console.log(`  Users:          ${userCount[0].count}`);
  console.log(`  Venues:         ${venueCount[0].count}`);
  console.log(`  Slots:          ${slotCount[0].count}`);
  console.log(`  Watches:        ${watchCount[0].count}`);
  console.log(`  Channels:       ${channelCount[0].count}`);
  console.log(`  Notifications:  ${logCount[0].count}`);

  // Check env vars
  console.log();
  log("Environment:", "cyan");
  console.log(`  TELEGRAM_BOT_TOKEN: ${process.env.TELEGRAM_BOT_TOKEN ? "✓ Set" : "✗ Not set"}`);
  console.log(`  GMAIL_USER:         ${process.env.GMAIL_USER ? "✓ Set" : "✗ Not set"}`);
  console.log(`  GMAIL_APP_PASSWORD: ${process.env.GMAIL_APP_PASSWORD ? "✓ Set" : "✗ Not set"}`);
  console.log(`  CRON_SECRET:        ${process.env.CRON_SECRET ? "✓ Set" : "✗ Not set"}`);

  // Recent activity
  const recentLogs = await db
    .select()
    .from(notificationLog)
    .orderBy(desc(notificationLog.sentAt))
    .limit(5);

  if (recentLogs.length > 0) {
    console.log();
    log("Recent Notifications:", "cyan");
    for (const entry of recentLogs) {
      console.log(`  ${entry.sentAt} - ${entry.slotKey}`);
    }
  }
}

async function listUsers() {
  header("Users");

  const allUsers = await db.select().from(users);

  for (const user of allUsers) {
    log(`User #${user.id}: ${user.email}`, "bright");
    console.log(`  Created: ${user.createdAt}`);

    // Get watches
    const userWatches = await db
      .select()
      .from(watches)
      .where(eq(watches.userId, user.id));

    if (userWatches.length > 0) {
      console.log(`  Watches:`);
      for (const watch of userWatches) {
        const venue = watch.venueId
          ? (await db.select().from(venues).where(eq(venues.id, watch.venueId)))[0]?.name
          : "All venues";
        const times = watch.preferredTimes ? JSON.parse(watch.preferredTimes).join(", ") : "Any time";
        const days = watch.weekdaysOnly ? "Weekdays" : watch.weekendsOnly ? "Weekends" : "All days";
        const status = watch.active ? "Active" : "Paused";
        console.log(`    - ${venue} | ${times} | ${days} | ${status}`);
      }
    }

    // Get channels
    const userChannels = await db
      .select()
      .from(notificationChannels)
      .where(eq(notificationChannels.userId, user.id));

    if (userChannels.length > 0) {
      console.log(`  Channels:`);
      for (const channel of userChannels) {
        const status = channel.active ? "Active" : "Inactive";
        console.log(`    - ${channel.type}: ${channel.destination} (${status})`);
      }
    }

    console.log();
  }

  if (allUsers.length === 0) {
    log("No users found. Run: npx tsx scripts/maintain.ts add-user", "yellow");
  }
}

async function addUser() {
  header("Add New User");

  const email = args[1];
  if (!email) {
    log("Usage: npx tsx scripts/maintain.ts add-user <email> [telegram-chat-id]", "yellow");
    process.exit(1);
  }

  const telegramChatId = args[2];

  // Create user
  const [user] = await db
    .insert(users)
    .values({ email })
    .onConflictDoNothing()
    .returning();

  if (!user) {
    log(`User ${email} already exists`, "yellow");
    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      log(`Existing user ID: ${existing[0].id}`, "dim");
    }
    return;
  }

  log(`✓ Created user: ${email} (ID: ${user.id})`, "green");

  // Create default watch (evening weekday slots)
  const [watch] = await db
    .insert(watches)
    .values({
      userId: user.id,
      venueId: null,
      preferredTimes: JSON.stringify(["5pm", "6pm", "7pm", "8pm"]),
      weekdaysOnly: 1,
      weekendsOnly: 0,
      active: 1,
    })
    .returning();

  log(`✓ Created watch for evening weekday slots (ID: ${watch.id})`, "green");

  // Create email channel
  await db.insert(notificationChannels).values({
    userId: user.id,
    type: "email",
    destination: email,
    active: 1,
  });

  log(`✓ Created email channel: ${email}`, "green");

  // Create telegram channel if provided
  if (telegramChatId) {
    await db.insert(notificationChannels).values({
      userId: user.id,
      type: "telegram",
      destination: telegramChatId,
      active: 1,
    });
    log(`✓ Created telegram channel: ${telegramChatId}`, "green");
  }

  console.log();
  log("User setup complete!", "bright");
}

async function cleanup() {
  header("Cleanup Old Data");

  const daysToKeep = parseInt(args[1] || "14", 10);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  const cutoff = cutoffDate.toISOString().split("T")[0];

  log(`Removing data older than ${daysToKeep} days (before ${cutoff})`, "dim");

  // Delete old slots
  const oldSlots = await db.delete(slots).where(lt(slots.date, cutoff)).returning();
  log(`✓ Deleted ${oldSlots.length} old slots`, "green");

  // Delete old notification logs
  const oldLogs = await db.delete(notificationLog).where(lt(notificationLog.sentAt, cutoff)).returning();
  log(`✓ Deleted ${oldLogs.length} old notification logs`, "green");

  // Vacuum database
  db.run(sql`VACUUM`);
  log(`✓ Database vacuumed`, "green");
}

async function testNotify() {
  header("Test Notification");

  const userId = parseInt(args[1], 10);
  if (!userId) {
    log("Usage: npx tsx scripts/maintain.ts test-notify <user-id>", "yellow");
    process.exit(1);
  }

  const user = await db.select().from(users).where(eq(users.id, userId));
  if (user.length === 0) {
    log(`User #${userId} not found`, "red");
    process.exit(1);
  }

  const channels = await db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.userId, userId));

  if (channels.length === 0) {
    log(`No notification channels for user #${userId}`, "red");
    process.exit(1);
  }

  for (const channel of channels) {
    if (!channel.active) {
      log(`Skipping inactive ${channel.type} channel`, "dim");
      continue;
    }

    try {
      if (channel.type === "email") {
        await sendEmail(
          channel.destination,
          "Test Notification - Tennis Court Notifier",
          `<h2>Test Notification</h2>
          <p>This is a test notification from Tennis Court Notifier.</p>
          <p>If you received this, your email notifications are working!</p>
          <p>Sent at: ${new Date().toISOString()}</p>`
        );
        log(`✓ Sent test email to ${channel.destination}`, "green");
      } else if (channel.type === "telegram") {
        await sendTelegramMessage(
          channel.destination,
          `<b>Test Notification</b>\n\nThis is a test notification from Tennis Court Notifier.\n\nIf you received this, your Telegram notifications are working!\n\n<i>Sent at: ${new Date().toISOString()}</i>`
        );
        log(`✓ Sent test telegram to ${channel.destination}`, "green");
      }
    } catch (error) {
      log(`✗ Failed to send ${channel.type}: ${error}`, "red");
    }
  }
}

async function runScrape() {
  header("Manual Scrape");

  const venueSlug = args[1];
  const date = args[2] || getNextNDays(1)[0];

  if (venueSlug) {
    // Scrape single venue
    log(`Scraping ${venueSlug} for ${date}...`, "dim");
    const slots = await scrapeVenue(venueSlug, date);
    log(`✓ Found ${slots.length} slots`, "green");

    const available = slots.filter((s) => s.status === "available");
    if (available.length > 0) {
      console.log();
      log("Available slots:", "cyan");
      for (const slot of available) {
        console.log(`  ${slot.time} - ${slot.court} (${slot.price})`);
      }
    }
  } else {
    // Scrape all venues
    log(`Scraping all venues for next 7 days...`, "dim");
    let totalSlots = 0;
    let totalAvailable = 0;

    for (const venue of VENUES) {
      for (const d of getNextNDays(7)) {
        try {
          const slots = await scrapeVenue(venue.slug, d);
          totalSlots += slots.length;
          totalAvailable += slots.filter((s) => s.status === "available").length;
          process.stdout.write(".");
        } catch (e) {
          process.stdout.write("x");
        }
      }
    }

    console.log();
    log(`✓ Scraped ${totalSlots} slots (${totalAvailable} available)`, "green");
  }
}

async function dbStats() {
  header("Database Statistics");

  // Table sizes
  const tables = ["users", "venues", "slots", "watches", "notification_channels", "notification_log"];

  for (const table of tables) {
    const result = db.get<{ count: number }>(sql.raw(`SELECT COUNT(*) as count FROM ${table}`));
    console.log(`  ${table.padEnd(25)} ${result?.count ?? 0} rows`);
  }

  // Slots by status
  console.log();
  log("Slots by Status:", "cyan");
  const slotStats = await db
    .select({
      status: slots.status,
      count: count(),
    })
    .from(slots)
    .groupBy(slots.status);

  for (const stat of slotStats) {
    console.log(`  ${stat.status.padEnd(15)} ${stat.count}`);
  }

  // Slots by venue
  console.log();
  log("Slots by Venue:", "cyan");
  const venueStats = await db
    .select({
      name: venues.name,
      count: count(),
    })
    .from(slots)
    .innerJoin(venues, eq(slots.venueId, venues.id))
    .groupBy(venues.name);

  for (const stat of venueStats) {
    console.log(`  ${stat.name.padEnd(30)} ${stat.count}`);
  }

  // Database file size
  const fs = await import("fs");
  const dbPath = "data/tennis.db";
  if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log();
    log(`Database size: ${sizeMB} MB`, "cyan");
  }
}

async function exportData() {
  header("Export Data");

  const exportType = args[1] || "all";
  const outputFile = args[2] || `export-${Date.now()}.json`;

  const data: Record<string, unknown> = {};

  if (exportType === "all" || exportType === "users") {
    data.users = await db.select().from(users);
  }
  if (exportType === "all" || exportType === "venues") {
    data.venues = await db.select().from(venues);
  }
  if (exportType === "all" || exportType === "slots") {
    data.slots = await db.select().from(slots);
  }
  if (exportType === "all" || exportType === "watches") {
    data.watches = await db.select().from(watches);
  }
  if (exportType === "all" || exportType === "channels") {
    data.channels = await db.select().from(notificationChannels);
  }
  if (exportType === "all" || exportType === "logs") {
    data.logs = await db.select().from(notificationLog);
  }

  const fs = await import("fs");
  fs.writeFileSync(outputFile, JSON.stringify(data, null, 2));

  log(`✓ Exported to ${outputFile}`, "green");
}

async function resetLogs() {
  header("Reset Notification Logs");

  const userId = args[1] ? parseInt(args[1], 10) : null;

  if (userId) {
    const deleted = await db
      .delete(notificationLog)
      .where(eq(notificationLog.userId, userId))
      .returning();
    log(`✓ Cleared ${deleted.length} notification logs for user #${userId}`, "green");
  } else {
    const deleted = await db.delete(notificationLog).returning();
    log(`✓ Cleared ${deleted.length} notification logs`, "green");
  }

  log("Users will be re-notified for any matching available slots.", "dim");
}

function showHelp() {
  console.log(`
${colors.bright}Tennis Court Notifier - Maintenance Utility${colors.reset}

${colors.cyan}Usage:${colors.reset}
  npx tsx scripts/maintain.ts <command> [options]

${colors.cyan}Commands:${colors.reset}
  status                      Show system health and statistics
  users                       List all users with watches and channels
  add-user <email> [chat-id]  Add a new user with default watch
  cleanup [days]              Remove data older than N days (default: 14)
  test-notify <user-id>       Send test notification to a user
  scrape [venue] [date]       Run manual scrape (all venues if not specified)
  db-stats                    Show detailed database statistics
  export [type] [file]        Export data to JSON (types: all, users, slots, etc.)
  reset-logs [user-id]        Clear notification logs (allow re-notification)

${colors.cyan}Examples:${colors.reset}
  npx tsx scripts/maintain.ts status
  npx tsx scripts/maintain.ts add-user john@example.com 123456789
  npx tsx scripts/maintain.ts cleanup 7
  npx tsx scripts/maintain.ts test-notify 1
  npx tsx scripts/maintain.ts scrape victoria-park 2025-01-22
  npx tsx scripts/maintain.ts export slots slots-backup.json
`);
}

// Main
async function main() {
  switch (command) {
    case "status":
      await showStatus();
      break;
    case "users":
      await listUsers();
      break;
    case "add-user":
      await addUser();
      break;
    case "cleanup":
      await cleanup();
      break;
    case "test-notify":
      await testNotify();
      break;
    case "scrape":
      await runScrape();
      break;
    case "db-stats":
      await dbStats();
      break;
    case "export":
      await exportData();
      break;
    case "reset-logs":
      await resetLogs();
      break;
    case "help":
    case "--help":
    case "-h":
    default:
      showHelp();
  }
}

main().catch((err) => {
  log(`Error: ${err.message}`, "red");
  process.exit(1);
});
