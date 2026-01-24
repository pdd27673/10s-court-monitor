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
 *   add-user        Add a new user (interactive or with args)
 *   edit-user       Edit an existing user's preferences (interactive)
 *   allow-user      Add email to allowlist (can log into dashboard)
 *   delete-user     Delete a user and all their data
 *   cleanup         Clean up old data (slots, logs)
 *   test-notify     Send a test notification to a user
 *   scrape          Run a manual scrape
 *   db-stats        Show database statistics
 *   export          Export data to JSON
 *   reset-logs      Clear notification logs (allows re-notification)
 */

import * as readline from "readline";
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
import { getNextNDays } from "../src/lib/scraper";
import { scrapeVenue } from "../src/lib/scrapers";
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
  magenta: "\x1b[35m",
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

// ============================================
// Interactive prompt helpers
// ============================================

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${colors.cyan}${question}${colors.reset} `, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function askYesNo(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = await ask(rl, `${question} ${hint}`);
  if (answer === "") return defaultYes;
  return answer.toLowerCase().startsWith("y");
}

async function askChoice<T extends string>(
  rl: readline.Interface,
  question: string,
  choices: { value: T; label: string }[]
): Promise<T> {
  console.log(`\n${colors.cyan}${question}${colors.reset}`);
  choices.forEach((c, i) => console.log(`  ${colors.bright}${i + 1}.${colors.reset} ${c.label}`));

  while (true) {
    const answer = await ask(rl, `Enter choice (1-${choices.length}):`);
    const num = parseInt(answer, 10);
    if (num >= 1 && num <= choices.length) {
      return choices[num - 1].value;
    }
    log("Invalid choice, try again.", "yellow");
  }
}

async function askMultiChoice<T extends string>(
  rl: readline.Interface,
  question: string,
  choices: { value: T; label: string }[]
): Promise<T[]> {
  console.log(`\n${colors.cyan}${question}${colors.reset}`);
  choices.forEach((c, i) => console.log(`  ${colors.bright}${i + 1}.${colors.reset} ${c.label}`));
  console.log(`  ${colors.dim}Enter numbers separated by commas, or 'all' for all${colors.reset}`);

  while (true) {
    const answer = await ask(rl, `Enter choices:`);
    if (answer.toLowerCase() === "all") {
      return choices.map((c) => c.value);
    }

    const nums = answer.split(",").map((s) => parseInt(s.trim(), 10));
    if (nums.every((n) => n >= 1 && n <= choices.length)) {
      return nums.map((n) => choices[n - 1].value);
    }
    log("Invalid choice, try again.", "yellow");
  }
}

// Available time slots
const TIME_SLOTS = [
  "7am", "8am", "9am", "10am", "11am", "12pm",
  "1pm", "2pm", "3pm", "4pm", "5pm", "6pm",
  "7pm", "8pm", "9pm", "10pm",
];

// ============================================
// Commands
// ============================================

async function showStatus() {
  header("System Status");

  // Database check
  try {
    db.get<{ ok: number }>(sql`SELECT 1 as ok`);
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
  console.log(`  AUTH_SECRET:        ${process.env.AUTH_SECRET ? "✓ Set" : "✗ Not set"}`);

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
    const allowedStatus = user.isAllowed ? `${colors.green}✓ Allowed${colors.reset}` : `${colors.red}✗ Not allowed${colors.reset}`;
    log(`User #${user.id}: ${user.email} ${user.name ? `(${user.name})` : ""} - ${allowedStatus}`, "bright");
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
        const weekdayTimes = watch.weekdayTimes ? JSON.parse(watch.weekdayTimes).join(", ") : "None";
        const weekendTimes = watch.weekendTimes ? JSON.parse(watch.weekendTimes).join(", ") : "None";
        const status = watch.active ? "Active" : "Paused";
        console.log(`    - ${venue} | ${status}`);
        console.log(`      Weekdays: ${weekdayTimes}`);
        console.log(`      Weekends: ${weekendTimes}`);
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

async function addUserInteractive() {
  header("Add New User (Interactive)");

  const rl = createPrompt();

  try {
    // Basic info
    const email = await ask(rl, "Email address:");
    if (!email || !email.includes("@")) {
      log("Invalid email address", "red");
      return;
    }

    const name = await ask(rl, "Name (optional):");
    const allowLogin = await askYesNo(rl, "Allow dashboard login?", true);

    // Check if user exists
    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      log(`User ${email} already exists (ID: ${existing[0].id})`, "yellow");
      const update = await askYesNo(rl, "Update existing user?", false);
      if (!update) return;

      await db
        .update(users)
        .set({ name: name || null, isAllowed: allowLogin ? 1 : 0 })
        .where(eq(users.email, email));
      log(`✓ Updated user ${email}`, "green");
      rl.close();
      return;
    }

    // Create user
    const [user] = await db
      .insert(users)
      .values({
        email,
        name: name || null,
        isAllowed: allowLogin ? 1 : 0,
      })
      .returning();

    log(`✓ Created user: ${email} (ID: ${user.id})`, "green");

    // Notification channels
    console.log();
    log("Notification Channels", "cyan");

    const useEmail = await askYesNo(rl, "Enable email notifications?", true);
    if (useEmail) {
      const emailDest = await ask(rl, `Email address for notifications [${email}]:`);
      await db.insert(notificationChannels).values({
        userId: user.id,
        type: "email",
        destination: emailDest || email,
        active: 1,
      });
      log(`✓ Added email channel`, "green");
    }

    const useTelegram = await askYesNo(rl, "Enable Telegram notifications?", true);
    if (useTelegram) {
      console.log(`${colors.dim}To get your Telegram chat ID:`);
      console.log(`  1. Message the bot on Telegram`);
      console.log(`  2. Visit: https://api.telegram.org/bot<TOKEN>/getUpdates`);
      console.log(`  3. Find your chat.id in the response${colors.reset}`);

      const chatId = await ask(rl, "Telegram chat ID:");
      if (chatId) {
        await db.insert(notificationChannels).values({
          userId: user.id,
          type: "telegram",
          destination: chatId,
          active: 1,
        });
        log(`✓ Added Telegram channel`, "green");
      }
    }

    // Watch preferences
    console.log();
    log("Watch Preferences", "cyan");
    console.log(`${colors.dim}Configure which slots you want to be notified about${colors.reset}`);

    // Venues
    const venueChoices = [
      { value: "all" as const, label: "All venues" },
      ...VENUES.map((v) => ({ value: v.slug, label: v.name })),
    ];

    const selectedVenues = await askMultiChoice(rl, "Which venues?", venueChoices);
    const watchAllVenues = selectedVenues.includes("all");
    const venueIds = watchAllVenues
      ? [null]
      : await Promise.all(
          selectedVenues
            .filter((s) => s !== "all")
            .map(async (slug) => {
              const v = await db.select().from(venues).where(eq(venues.slug, slug));
              return v[0]?.id ?? null;
            })
        );

    // Times - separate for weekdays and weekends
    const timeChoices = TIME_SLOTS.map((t) => ({ value: t, label: t }));

    console.log(`\n${colors.dim}Popular weekday choices: 4pm-9pm (after work)${colors.reset}`);
    const weekdayTimes = await askMultiChoice(rl, "Weekday time slots (Mon-Fri)?", timeChoices);

    console.log(`\n${colors.dim}Popular weekend choices: 11am-6pm${colors.reset}`);
    const weekendTimes = await askMultiChoice(rl, "Weekend time slots (Sat-Sun)?", timeChoices);

    // Create watches
    for (const venueId of venueIds) {
      await db.insert(watches).values({
        userId: user.id,
        venueId,
        weekdayTimes: weekdayTimes.length > 0 ? JSON.stringify(weekdayTimes) : null,
        weekendTimes: weekendTimes.length > 0 ? JSON.stringify(weekendTimes) : null,
        active: 1,
      });
    }

    log(`✓ Created ${venueIds.length} watch(es)`, "green");

    console.log();
    log("User setup complete!", "bright");
    console.log(`${colors.dim}User can ${allowLogin ? "now log in at /login" : "NOT log in (not on allowlist)"}${colors.reset}`);
  } finally {
    rl.close();
  }
}

async function addUserQuick() {
  // Quick mode with args: add-user <email> [telegram-chat-id]
  const email = args[1];
  if (!email) {
    log("Usage: npx tsx scripts/maintain.ts add-user <email> [telegram-chat-id]", "yellow");
    log("       Or run without args for interactive mode", "dim");
    process.exit(1);
  }

  const telegramChatId = args[2];

  // Create user
  const [user] = await db
    .insert(users)
    .values({ email, isAllowed: 1 })
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

  // Create default watch (evening weekday slots, midday weekend slots)
  const [watch] = await db
    .insert(watches)
    .values({
      userId: user.id,
      venueId: null,
      weekdayTimes: JSON.stringify(["4pm", "5pm", "6pm", "7pm", "8pm", "9pm"]),
      weekendTimes: JSON.stringify(["11am", "12pm", "1pm", "2pm", "3pm", "4pm", "5pm", "6pm"]),
      active: 1,
    })
    .returning();

  log(`✓ Created watch with default times (ID: ${watch.id})`, "green");
  log(`  Weekdays: 4pm-9pm`, "dim");
  log(`  Weekends: 11am-6pm`, "dim");

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

async function addUser() {
  header("Add New User");

  // If no args, use interactive mode
  if (args.length === 1) {
    await addUserInteractive();
  } else {
    await addUserQuick();
  }
}

async function editUser() {
  header("Edit User");

  const rl = createPrompt();

  try {
    // List users for selection
    const allUsers = await db.select().from(users);
    if (allUsers.length === 0) {
      log("No users found", "yellow");
      return;
    }

    console.log("Select a user to edit:\n");
    allUsers.forEach((u, i) => {
      const allowed = u.isAllowed ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
      console.log(`  ${colors.bright}${i + 1}.${colors.reset} ${u.email} ${u.name ? `(${u.name})` : ""} ${allowed}`);
    });

    const userIndex = parseInt(await ask(rl, `\nSelect user (1-${allUsers.length}):`), 10) - 1;
    if (userIndex < 0 || userIndex >= allUsers.length) {
      log("Invalid selection", "red");
      return;
    }

    const user = allUsers[userIndex];
    log(`\nEditing: ${user.email}`, "bright");

    // What to edit?
    const action = await askChoice(rl, "What would you like to edit?", [
      { value: "profile", label: "Profile (name, allowlist status)" },
      { value: "watches", label: "Watch preferences (venues, times, days)" },
      { value: "channels", label: "Notification channels (email, telegram)" },
      { value: "delete", label: "Delete user" },
    ]);

    if (action === "profile") {
      const newName = await ask(rl, `Name [${user.name || ""}]:`);
      const newAllowed = await askYesNo(rl, "Allow dashboard login?", !!user.isAllowed);

      await db
        .update(users)
        .set({
          name: newName || user.name,
          isAllowed: newAllowed ? 1 : 0,
        })
        .where(eq(users.id, user.id));

      log("✓ Profile updated", "green");
    } else if (action === "watches") {
      // Delete existing watches
      await db.delete(watches).where(eq(watches.userId, user.id));

      // Venues
      const venueChoices = [
        { value: "all" as const, label: "All venues" },
        ...VENUES.map((v) => ({ value: v.slug, label: v.name })),
      ];

      const selectedVenues = await askMultiChoice(rl, "Which venues?", venueChoices);
      const watchAllVenues = selectedVenues.includes("all");
      const venueIds = watchAllVenues
        ? [null]
        : await Promise.all(
            selectedVenues
              .filter((s) => s !== "all")
              .map(async (slug) => {
                const v = await db.select().from(venues).where(eq(venues.slug, slug));
                return v[0]?.id ?? null;
              })
          );

      // Times - separate for weekdays and weekends
      const timeChoices = TIME_SLOTS.map((t) => ({ value: t, label: t }));

      console.log(`\n${colors.dim}Popular weekday choices: 4pm-9pm (after work)${colors.reset}`);
      const weekdayTimes = await askMultiChoice(rl, "Weekday time slots (Mon-Fri)?", timeChoices);

      console.log(`\n${colors.dim}Popular weekend choices: 11am-6pm${colors.reset}`);
      const weekendTimes = await askMultiChoice(rl, "Weekend time slots (Sat-Sun)?", timeChoices);

      // Create watches
      for (const venueId of venueIds) {
        await db.insert(watches).values({
          userId: user.id,
          venueId,
          weekdayTimes: weekdayTimes.length > 0 ? JSON.stringify(weekdayTimes) : null,
          weekendTimes: weekendTimes.length > 0 ? JSON.stringify(weekendTimes) : null,
          active: 1,
        });
      }

      log(`✓ Created ${venueIds.length} watch(es)`, "green");
    } else if (action === "channels") {
      // Delete existing channels
      await db.delete(notificationChannels).where(eq(notificationChannels.userId, user.id));

      const useEmail = await askYesNo(rl, "Enable email notifications?", true);
      if (useEmail) {
        const emailDest = await ask(rl, `Email address [${user.email}]:`);
        await db.insert(notificationChannels).values({
          userId: user.id,
          type: "email",
          destination: emailDest || user.email,
          active: 1,
        });
        log(`✓ Added email channel`, "green");
      }

      const useTelegram = await askYesNo(rl, "Enable Telegram notifications?", false);
      if (useTelegram) {
        const chatId = await ask(rl, "Telegram chat ID:");
        if (chatId) {
          await db.insert(notificationChannels).values({
            userId: user.id,
            type: "telegram",
            destination: chatId,
            active: 1,
          });
          log(`✓ Added Telegram channel`, "green");
        }
      }
    } else if (action === "delete") {
      const confirm = await askYesNo(rl, `Are you sure you want to delete ${user.email}?`, false);
      if (confirm) {
        // Delete related data first
        await db.delete(notificationLog).where(eq(notificationLog.userId, user.id));
        await db.delete(notificationChannels).where(eq(notificationChannels.userId, user.id));
        await db.delete(watches).where(eq(watches.userId, user.id));
        await db.delete(users).where(eq(users.id, user.id));
        log(`✓ Deleted user ${user.email}`, "green");
      } else {
        log("Cancelled", "dim");
      }
    }
  } finally {
    rl.close();
  }
}

async function allowUser() {
  header("Allow User");

  const email = args[1];
  if (!email) {
    log("Usage: npx tsx scripts/maintain.ts allow-user <email>", "yellow");
    process.exit(1);
  }

  // Check if user exists
  const existing = await db.select().from(users).where(eq(users.email, email));

  if (existing.length > 0) {
    // Update existing user
    await db.update(users).set({ isAllowed: 1 }).where(eq(users.email, email));
    log(`✓ User ${email} is now allowed to log in`, "green");
  } else {
    // Create new user with allowlist
    const [user] = await db
      .insert(users)
      .values({ email, isAllowed: 1 })
      .returning();
    log(`✓ Created user ${email} (ID: ${user.id}) with login access`, "green");
    log(`Run 'npx tsx scripts/maintain.ts edit-user' to configure watches and channels`, "dim");
  }
}

async function deleteUser() {
  header("Delete User");

  const emailOrId = args[1];
  if (!emailOrId) {
    log("Usage: npx tsx scripts/maintain.ts delete-user <email-or-id>", "yellow");
    process.exit(1);
  }

  // Find user by email or ID
  let user;
  const numId = parseInt(emailOrId, 10);
  if (!isNaN(numId)) {
    const result = await db.select().from(users).where(eq(users.id, numId));
    user = result[0];
  } else {
    const result = await db.select().from(users).where(eq(users.email, emailOrId));
    user = result[0];
  }

  if (!user) {
    log(`User not found: ${emailOrId}`, "red");
    process.exit(1);
  }

  log(`Found user: ${user.email} (ID: ${user.id})`, "dim");

  // Delete related data first
  const deletedLogs = await db.delete(notificationLog).where(eq(notificationLog.userId, user.id)).returning();
  const deletedChannels = await db.delete(notificationChannels).where(eq(notificationChannels.userId, user.id)).returning();
  const deletedWatches = await db.delete(watches).where(eq(watches.userId, user.id)).returning();
  await db.delete(users).where(eq(users.id, user.id));

  log(`✓ Deleted user ${user.email}`, "green");
  log(`  Removed ${deletedWatches.length} watch(es)`, "dim");
  log(`  Removed ${deletedChannels.length} notification channel(s)`, "dim");
  log(`  Removed ${deletedLogs.length} notification log(s)`, "dim");
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
    const venue = VENUES.find((v) => v.slug === venueSlug);
    if (!venue) {
      log(`Venue not found: ${venueSlug}`, "red");
      log(`Available venues: ${VENUES.map((v) => v.slug).join(", ")}`, "dim");
      return;
    }

    log(`Scraping ${venue.name} for ${date}...`, "dim");
    const scrapedSlots = await scrapeVenue(venue, date);
    log(`✓ Found ${scrapedSlots.length} slots`, "green");

    const available = scrapedSlots.filter((s) => s.status === "available");
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
          const scrapedSlots = await scrapeVenue(venue, d);
          totalSlots += scrapedSlots.length;
          totalAvailable += scrapedSlots.filter((s) => s.status === "available").length;
          process.stdout.write(".");
        } catch {
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
  const tables = ["users", "venues", "slots", "watches", "notification_channels", "notification_log", "sessions", "verification_tokens"];

  for (const table of tables) {
    try {
      const result = db.get<{ count: number }>(sql.raw(`SELECT COUNT(*) as count FROM ${table}`));
      console.log(`  ${table.padEnd(25)} ${result?.count ?? 0} rows`);
    } catch {
      console.log(`  ${table.padEnd(25)} (table not found)`);
    }
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
  add-user                    Add a new user (interactive mode)
  add-user <email> [chat-id]  Add a new user (quick mode)
  edit-user                   Edit an existing user's preferences
  allow-user <email>          Add email to allowlist for dashboard login
  delete-user <email-or-id>   Delete a user and all their data
  cleanup [days]              Remove data older than N days (default: 14)
  test-notify <user-id>       Send test notification to a user
  scrape [venue] [date]       Run manual scrape (all venues if not specified)
  db-stats                    Show detailed database statistics
  export [type] [file]        Export data to JSON (types: all, users, slots, etc.)
  reset-logs [user-id]        Clear notification logs (allow re-notification)

${colors.cyan}Examples:${colors.reset}
  npx tsx scripts/maintain.ts status
  npx tsx scripts/maintain.ts add-user                  # Interactive
  npx tsx scripts/maintain.ts add-user john@example.com 123456789
  npx tsx scripts/maintain.ts edit-user                 # Interactive
  npx tsx scripts/maintain.ts allow-user jane@example.com
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
    case "edit-user":
      await editUser();
      break;
    case "allow-user":
      await allowUser();
      break;
    case "delete-user":
      await deleteUser();
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
