import { scrapeVenue, getNextNDays } from "../src/lib/scraper";

async function main() {
  const dates = getNextNDays(7);
  console.log("Testing scraper for dates:", dates);

  for (const date of dates) {
    console.log(`\n--- Scraping ropemakers-field for ${date} ---`);
    const rfSlots = await scrapeVenue("ropemakers-field", date);
    // const slots = await scrapeVenue("victoria-park", date);

    // Group by time for readability
    const byTime: Record<string, typeof rfSlots> = {};
    for (const slot of rfSlots) {
      if (!byTime[slot.time]) byTime[slot.time] = [];
      byTime[slot.time].push(slot);
    }

    for (const [time, timeSlots] of Object.entries(byTime)) {
      const statuses = timeSlots
        .map((s) => `${s.court}: ${s.status}${s.price ? ` (${s.price})` : ""}`)
        .join(", ");
      console.log(`${time}: ${statuses}`);
    }
  }
}

main().catch(console.error);
