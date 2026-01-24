import { getNextNDays } from "../src/lib/scraper";
import { scrapeVenue } from "../src/lib/scrapers";
import { VENUES } from "../src/lib/constants";

async function main() {
  const dates = getNextNDays(2); // Test next 2 days
  console.log("Testing scraper for dates:", dates);

  // Test both a Courtside venue and a ClubSpark venue
  const testVenues = [
    VENUES.find((v) => v.slug === "ropemakers-field")!,
    VENUES.find((v) => v.slug === "stratford-park")!,
  ];

  for (const venue of testVenues) {
    console.log(`\n=== Testing ${venue.name} (${venue.type}) ===`);

    for (const date of dates) {
      console.log(`\n--- ${venue.name} on ${date} ---`);
      
      try {
        const slots = await scrapeVenue(venue, date);
        console.log(`Found ${slots.length} slots`);

        // Group by time for readability
        const byTime: Record<string, typeof slots> = {};
        for (const slot of slots) {
          if (!byTime[slot.time]) byTime[slot.time] = [];
          byTime[slot.time].push(slot);
        }

        // Show first 3 time slots as sample
        const times = Object.keys(byTime).sort().slice(0, 3);
        for (const time of times) {
          const timeSlots = byTime[time];
          const statuses = timeSlots
            .map((s) => `${s.court}: ${s.status}${s.price ? ` (${s.price})` : ""}`)
            .join(", ");
          console.log(`${time}: ${statuses}`);
        }
        if (Object.keys(byTime).length > 3) {
          console.log(`... and ${Object.keys(byTime).length - 3} more time slots`);
        }
      } catch (error) {
        console.error(`Error scraping ${venue.slug}:`, error);
      }
    }
  }
}

main().catch(console.error);
