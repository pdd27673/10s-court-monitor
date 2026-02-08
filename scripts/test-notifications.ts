#!/usr/bin/env npx tsx
/**
 * Test notification matching with new individual day system
 */

import { db } from "../src/lib/db";
import { watches, venues as venuesTable, notificationChannels } from "../src/lib/schema";
import { eq } from "drizzle-orm";
import { VENUES } from "../src/lib/constants";
import { scrapeVenue } from "../src/lib/scrapers";
import { getNextNDays } from "../src/lib/scraper";
import { SlotChange } from "../src/lib/differ";

// Simulate the matching logic from notifiers/index.ts
function matchesWatch(
  change: SlotChange,
  watch: {
    venueId: number | null;
    dayTimes: string | null;
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
      return false;
    }
  } else {
    // Fall back to legacy weekday/weekend format
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const timesJson = isWeekend ? watch.weekendTimes : watch.weekdayTimes;
    
    if (!timesJson) return false;
    
    try {
      preferredTimes = JSON.parse(timesJson);
    } catch {
      return false;
    }
  }

  // If no times configured for this specific day, skip
  if (preferredTimes.length === 0) return false;

  // Direct match on am/pm times (e.g., "5pm", "6pm")
  const changeTime = change.time.toLowerCase().trim();
  if (!preferredTimes.some((t) => t.toLowerCase().trim() === changeTime)) {
    return false;
  }

  return true;
}

async function testNotifications() {
  console.log("🧪 Testing Notification Matching with Individual Days\n");
  
  // Get active watches
  const activeWatches = await db.query.watches.findMany({
    where: eq(watches.active, 1),
  });
  
  console.log(`Found ${activeWatches.length} active watch(es)\n`);
  
  if (activeWatches.length === 0) {
    console.log("No active watches to test. Create some watches first.");
    return;
  }
  
  // Build venue ID map
  const allVenues = await db.query.venues.findMany();
  const venueIdMap: Record<string, number> = {};
  for (const v of allVenues) {
    venueIdMap[v.slug] = v.id;
  }
  
  // Display watch configurations
  for (const watch of activeWatches) {
    console.log(`📋 Watch #${watch.id}:`);
    
    let venueName = "All Venues";
    if (watch.venueId) {
      const venue = allVenues.find(v => v.id === watch.venueId);
      venueName = venue?.name || `Venue ID ${watch.venueId}`;
    }
    console.log(`   Venue: ${venueName}`);
    
    if (watch.dayTimes) {
      const dayTimes = JSON.parse(watch.dayTimes);
      console.log("   Individual Days:");
      for (const [day, times] of Object.entries(dayTimes) as [string, string[]][]) {
        if (times.length > 0) {
          console.log(`     ${day}: ${times.join(", ")}`);
        }
      }
    } else if (watch.weekdayTimes || watch.weekendTimes) {
      console.log("   Legacy format:");
      if (watch.weekdayTimes) {
        console.log(`     Weekdays: ${JSON.parse(watch.weekdayTimes).join(", ")}`);
      }
      if (watch.weekendTimes) {
        console.log(`     Weekends: ${JSON.parse(watch.weekendTimes).join(", ")}`);
      }
    }
    console.log();
  }
  
  // Create some test slot changes (simulating available slots found by scraper)
  const today = new Date();
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayName = dayNames[today.getDay()];
  const todayDate = today.toISOString().split('T')[0];
  
  const testChanges: SlotChange[] = [
    {
      type: 'added',
      venue: 'stratford-park',
      date: todayDate,
      time: '10am',
      court: 'Court 1',
      oldStatus: 'booked',
      newStatus: 'available',
      price: '£10.00'
    },
    {
      type: 'added',
      venue: 'stratford-park',
      date: todayDate,
      time: '11am',
      court: 'Court 2',
      oldStatus: 'booked',
      newStatus: 'available',
      price: '£10.00'
    },
    {
      type: 'added',
      venue: 'stratford-park',
      date: todayDate,
      time: '6pm',
      court: 'Court 3',
      oldStatus: 'booked',
      newStatus: 'available',
      price: '£6.00'
    },
    {
      type: 'added',
      venue: 'ropemakers-field',
      date: todayDate,
      time: '7pm',
      court: 'Court 1',
      oldStatus: 'booked',
      newStatus: 'available',
      price: '£8.00'
    },
  ];
  
  console.log(`🔔 Testing with sample slot changes for TODAY (${todayName}, ${todayDate}):\n`);
  
  for (const change of testChanges) {
    const venueName = VENUES.find(v => v.slug === change.venue)?.name || change.venue;
    console.log(`   ✅ ${venueName} - ${change.time} ${change.court} became available`);
  }
  console.log();
  
  // Test matching
  console.log("🎯 Matching Results:\n");
  
  for (const watch of activeWatches) {
    const matchingChanges = testChanges.filter(c => matchesWatch(c, watch, venueIdMap));
    
    let venueName = "All Venues";
    if (watch.venueId) {
      const venue = allVenues.find(v => v.id === watch.venueId);
      venueName = venue?.name || `Venue ID ${watch.venueId}`;
    }
    
    console.log(`Watch #${watch.id} (${venueName}):`);
    if (matchingChanges.length > 0) {
      console.log(`   ✅ WOULD NOTIFY - ${matchingChanges.length} matching slot(s):`);
      for (const match of matchingChanges) {
        const matchVenueName = VENUES.find(v => v.slug === match.venue)?.name || match.venue;
        console.log(`      • ${matchVenueName} - ${match.time} ${match.court}`);
      }
    } else {
      console.log(`   ⏭️  No matching slots for today (${todayName})`);
      
      // Show what day/times would match
      if (watch.dayTimes) {
        const dayTimes = JSON.parse(watch.dayTimes);
        const dayName = dayNames[today.getDay()].toLowerCase();
        const todayTimes = dayTimes[dayName] || [];
        if (todayTimes.length > 0) {
          console.log(`      (Watching for: ${todayTimes.join(", ")} today)`);
        } else {
          console.log(`      (No times configured for ${todayName}s)`);
        }
      }
    }
    console.log();
  }
  
  console.log("\n✅ Notification matching test complete!");
  console.log("\nKey Feature: Individual day selection means:");
  console.log("  - Users only get alerts for days they care about");
  console.log("  - No more unwanted notifications for other weekdays/weekends");
  console.log("  - More precise control over when to be notified");
}

testNotifications().catch(console.error);
