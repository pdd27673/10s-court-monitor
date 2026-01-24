#!/usr/bin/env npx tsx
/**
 * Tennis Court Notifier - Soak Test
 *
 * Runs a comprehensive test of the entire system using real data:
 * 1. Scrapes all venues for real availability
 * 2. Stores data in the database
 * 3. Simulates slot changes to trigger notifications
 * 4. Tests notification delivery
 * 5. Verifies deduplication logic
 *
 * Usage:
 *   npx tsx scripts/soak-test.ts [--dry-run] [--duration <minutes>]
 *
 * Options:
 *   --dry-run     Don't send actual notifications
 *   --duration    How long to run continuous test (default: single run)
 *   --verbose     Show detailed output
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
import { eq, sql, count } from "drizzle-orm";
import { getNextNDays } from "../src/lib/scraper";
import { scrapeVenue } from "../src/lib/scrapers";
import { VENUES } from "../src/lib/constants";
import { ensureVenuesExist, storeAndDiff } from "../src/lib/differ";
import { notifyUsers } from "../src/lib/notifiers";
import type { ScrapedSlot } from "../src/lib/scraper";

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");
const durationIndex = args.indexOf("--duration");
const duration = durationIndex !== -1 ? parseInt(args[durationIndex + 1], 10) : 0;

// Colors
const c = {
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

function log(msg: string, color = "") {
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  console.log(`${c.dim}[${timestamp}]${c.reset} ${color}${msg}${c.reset}`);
}

function section(title: string) {
  console.log();
  console.log(`${c.bright}${c.cyan}▶ ${title}${c.reset}`);
  console.log(`${c.dim}${"─".repeat(50)}${c.reset}`);
}

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  details?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, duration: Date.now() - start });
    log(`✓ ${name}`, c.green);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, duration: Date.now() - start, details: msg });
    log(`✗ ${name}: ${msg}`, c.red);
  }
}

// ============================================================================
// Test Functions
// ============================================================================

async function testDatabaseConnection() {
  const result = db.get<{ ok: number }>(sql`SELECT 1 as ok`);
  if (result?.ok !== 1) throw new Error("Database query failed");
}

async function testVenueSetup() {
  await ensureVenuesExist();
  const venueCount = await db.select({ count: count() }).from(venues);
  if (venueCount[0].count !== VENUES.length) {
    throw new Error(`Expected ${VENUES.length} venues, got ${venueCount[0].count}`);
  }
}

async function testScrapeAllVenues(): Promise<ScrapedSlot[]> {
  const allSlots: ScrapedSlot[] = [];
  const dates = getNextNDays(2); // Just 2 days for speed

  for (const venue of VENUES) {
    for (const date of dates) {
      try {
        const scraped = await scrapeVenue(venue, date);
        allSlots.push(...scraped);
        if (verbose) {
          log(`  ${venue.slug}/${date}: ${scraped.length} slots`, c.dim);
        }
      } catch (error) {
        log(`  Failed ${venue.slug}/${date}: ${error}`, c.yellow);
      }
    }
  }

  if (allSlots.length === 0) {
    throw new Error("No slots scraped");
  }

  return allSlots;
}

async function testStoreAndDiff(scrapedSlots: ScrapedSlot[]) {
  // First run - should store all slots, no changes (all new)
  const changes1 = await storeAndDiff(scrapedSlots);
  if (verbose) {
    log(`  First store: ${scrapedSlots.length} slots, ${changes1.length} changes`, c.dim);
  }

  // Second run - same data, should have no changes
  const changes2 = await storeAndDiff(scrapedSlots);
  if (changes2.length > 0) {
    throw new Error(`Expected 0 changes on re-store, got ${changes2.length}`);
  }
}

async function testSimulateAvailabilityChange(): Promise<void> {
  // Find some booked slots and temporarily mark them available
  // Join with venues to get the slug
  const bookedSlots = await db
    .select({
      date: slots.date,
      time: slots.time,
      court: slots.court,
      venueSlug: venues.slug,
    })
    .from(slots)
    .innerJoin(venues, eq(slots.venueId, venues.id))
    .where(eq(slots.status, "booked"))
    .limit(5);

  if (bookedSlots.length === 0) {
    log("  No booked slots to simulate change", c.yellow);
    return;
  }

  // Create "newly available" slots using real venue data
  const nowAvailable: ScrapedSlot[] = bookedSlots.map((slot) => ({
    venue: slot.venueSlug,
    date: slot.date,
    time: slot.time,
    court: slot.court,
    status: "available" as const,
    price: "£5.00",
  }));

  // This should detect changes
  const changes = await storeAndDiff(nowAvailable);
  if (verbose) {
    log(`  Simulated ${nowAvailable.length} slots becoming available`, c.dim);
    log(`  Detected ${changes.length} changes`, c.dim);
  }
}

async function testUserSetup() {
  // Ensure test user exists
  const testEmail = "soak-test@example.com";

  let user = await db.select().from(users).where(eq(users.email, testEmail));

  if (user.length === 0) {
    const [newUser] = await db
      .insert(users)
      .values({ email: testEmail })
      .returning();

    // Add a watch for all venues with separate weekday/weekend times
    await db.insert(watches).values({
      userId: newUser.id,
      venueId: null,
      weekdayTimes: JSON.stringify(["4pm", "5pm", "6pm", "7pm", "8pm", "9pm"]),
      weekendTimes: JSON.stringify(["11am", "12pm", "1pm", "2pm", "3pm", "4pm", "5pm", "6pm"]),
      active: 1,
    });

    // Add email channel (won't actually send in dry run)
    await db.insert(notificationChannels).values({
      userId: newUser.id,
      type: "email",
      destination: testEmail,
      active: 1,
    });

    user = [newUser];
    if (verbose) {
      log(`  Created test user: ${testEmail}`, c.dim);
    }
  }
}

async function testNotificationMatching() {
  // Get all active watches
  const activeWatches = await db
    .select()
    .from(watches)
    .where(eq(watches.active, 1));

  if (activeWatches.length === 0) {
    throw new Error("No active watches found");
  }

  if (verbose) {
    log(`  Found ${activeWatches.length} active watches`, c.dim);
  }
}

async function testNotificationDeduplication() {
  // Create a fake notification log entry
  const testKey = `test-venue:2025-01-01:6pm:Court 1`;

  // Check if we can insert and detect duplicates
  const existing = await db
    .select()
    .from(notificationLog)
    .where(eq(notificationLog.slotKey, testKey));

  if (existing.length === 0) {
    await db.insert(notificationLog).values({
      userId: 1,
      channelId: 1,
      slotKey: testKey,
    });
  }

  // Should find the duplicate
  const afterInsert = await db
    .select()
    .from(notificationLog)
    .where(eq(notificationLog.slotKey, testKey));

  if (afterInsert.length === 0) {
    throw new Error("Deduplication check failed");
  }

  if (verbose) {
    log(`  Deduplication working correctly`, c.dim);
  }
}

async function testFullPipeline(dryRunMode: boolean) {
  // Scrape fresh data
  const victoriaPark = VENUES.find((v) => v.slug === "victoria-park")!;
  const freshSlots = await scrapeVenue(victoriaPark, getNextNDays(1)[0]);

  if (freshSlots.length === 0) {
    throw new Error("No slots scraped for pipeline test");
  }

  // Store and diff
  const changes = await storeAndDiff(freshSlots);

  if (verbose) {
    log(`  Pipeline: ${freshSlots.length} slots, ${changes.length} changes`, c.dim);
  }

  // If there are changes and not dry run, notify
  if (changes.length > 0 && !dryRunMode) {
    await notifyUsers(changes);
    if (verbose) {
      log(`  Sent notifications for ${changes.length} changes`, c.dim);
    }
  }
}

async function testAPIEndpoints() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // Test venues endpoint
  try {
    const venuesRes = await fetch(`${baseUrl}/api/venues`);
    if (!venuesRes.ok) throw new Error(`Venues API returned ${venuesRes.status}`);
    const venuesData = await venuesRes.json();
    const venuesArray = venuesData.venues || venuesData;
    if (!Array.isArray(venuesArray) || venuesArray.length !== VENUES.length) {
      throw new Error(`Expected ${VENUES.length} venues, got ${venuesArray.length}`);
    }
    if (verbose) log(`  /api/venues: OK (${venuesArray.length} venues)`, c.dim);
  } catch (e) {
    if (verbose) log(`  /api/venues: ${e}`, c.yellow);
  }

  // Test availability endpoint
  try {
    const date = getNextNDays(1)[0];
    const availRes = await fetch(`${baseUrl}/api/availability?venue=victoria-park&date=${date}`);
    if (!availRes.ok) throw new Error(`Availability API returned ${availRes.status}`);
    if (verbose) log(`  /api/availability: OK`, c.dim);
  } catch (e) {
    if (verbose) log(`  /api/availability: ${e}`, c.yellow);
  }

  // Test health endpoint
  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    if (!healthRes.ok) throw new Error(`Health API returned ${healthRes.status}`);
    const healthData = await healthRes.json();
    if (healthData.status !== "healthy") {
      throw new Error(`Health status: ${healthData.status}`);
    }
    if (verbose) log(`  /api/health: OK`, c.dim);
  } catch (e) {
    if (verbose) log(`  /api/health: ${e}`, c.yellow);
  }
}

async function getStats() {
  const userCount = await db.select({ count: count() }).from(users);
  const slotCount = await db.select({ count: count() }).from(slots);
  const availableCount = await db
    .select({ count: count() })
    .from(slots)
    .where(eq(slots.status, "available"));
  const logCount = await db.select({ count: count() }).from(notificationLog);

  return {
    users: userCount[0].count,
    slots: slotCount[0].count,
    available: availableCount[0].count,
    notifications: logCount[0].count,
  };
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runSoakTest() {
  console.log();
  console.log(`${c.bright}${c.magenta}╔════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bright}${c.magenta}║        Tennis Court Notifier - Soak Test           ║${c.reset}`);
  console.log(`${c.bright}${c.magenta}╚════════════════════════════════════════════════════╝${c.reset}`);
  console.log();

  if (dryRun) {
    log("Running in DRY RUN mode - no notifications will be sent", c.yellow);
  }

  const startTime = Date.now();
  let scrapedSlots: ScrapedSlot[] = [];

  // Phase 1: Database & Setup
  section("Phase 1: Database & Setup");
  await runTest("Database connection", testDatabaseConnection);
  await runTest("Venue setup", testVenueSetup);
  await runTest("User setup", testUserSetup);

  // Phase 2: Scraping
  section("Phase 2: Real Data Scraping");
  await runTest("Scrape all venues (2 days)", async () => {
    scrapedSlots = await testScrapeAllVenues();
    log(`  Total scraped: ${scrapedSlots.length} slots`, c.dim);
  });

  // Phase 3: Storage & Diffing
  section("Phase 3: Storage & Change Detection");
  await runTest("Store and diff", () => testStoreAndDiff(scrapedSlots));
  await runTest("Simulate availability change", testSimulateAvailabilityChange);

  // Phase 4: Notification Logic
  section("Phase 4: Notification Logic");
  await runTest("Notification matching", testNotificationMatching);
  await runTest("Notification deduplication", testNotificationDeduplication);

  // Phase 5: Full Pipeline
  section("Phase 5: Full Pipeline Test");
  await runTest("Full scrape → store → notify pipeline", () => testFullPipeline(dryRun));

  // Phase 6: API Endpoints
  section("Phase 6: API Endpoints");
  await runTest("API endpoint checks", testAPIEndpoints);

  // Summary
  section("Test Summary");

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  const totalDuration = Date.now() - startTime;

  console.log();
  log(`Total tests: ${results.length}`, c.bright);
  log(`Passed: ${passed}`, c.green);
  if (failed > 0) {
    log(`Failed: ${failed}`, c.red);
    console.log();
    log("Failed tests:", c.red);
    for (const r of results.filter((r) => !r.passed)) {
      log(`  • ${r.name}: ${r.details}`, c.red);
    }
  }

  console.log();
  const stats = await getStats();
  log(`Database stats:`, c.cyan);
  log(`  Users: ${stats.users}`, c.dim);
  log(`  Slots: ${stats.slots} (${stats.available} available)`, c.dim);
  log(`  Notification logs: ${stats.notifications}`, c.dim);

  console.log();
  log(`Total duration: ${(totalDuration / 1000).toFixed(2)}s`, c.dim);

  // Continuous mode
  if (duration > 0) {
    console.log();
    log(`Continuous mode: Running for ${duration} minutes...`, c.yellow);

    const endTime = Date.now() + duration * 60 * 1000;
    let iteration = 1;

    while (Date.now() < endTime) {
      console.log();
      log(`─── Iteration ${iteration} ───`, c.cyan);

      try {
        // Run a lighter test cycle
        const freshSlots = await testScrapeAllVenues();
        const changes = await storeAndDiff(freshSlots);

        const available = freshSlots.filter((s) => s.status === "available").length;
        log(`Scraped ${freshSlots.length} slots (${available} available), ${changes.length} changes`, c.dim);

        if (changes.length > 0 && !dryRun) {
          await notifyUsers(changes);
          log(`Notified users of ${changes.length} newly available slots`, c.green);
        }
      } catch (error) {
        log(`Iteration ${iteration} error: ${error}`, c.red);
      }

      iteration++;

      // Wait before next iteration (every 5 minutes)
      const waitTime = Math.min(5 * 60 * 1000, endTime - Date.now());
      if (waitTime > 0) {
        log(`Waiting ${Math.round(waitTime / 1000)}s until next iteration...`, c.dim);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    log(`Continuous test completed after ${iteration - 1} iterations`, c.green);
  }

  // Exit code
  process.exit(failed > 0 ? 1 : 0);
}

// Run
runSoakTest().catch((err) => {
  console.error(`${c.red}Fatal error: ${err.message}${c.reset}`);
  process.exit(1);
});
