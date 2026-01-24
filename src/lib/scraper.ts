import { VENUES } from "./constants";
import { scrapeVenue, ScrapedSlot } from "./scrapers";

export type { ScrapedSlot } from "./scrapers";

export async function scrapeAllVenues(date: string): Promise<ScrapedSlot[]> {
  const allSlots: ScrapedSlot[] = [];

  for (const venue of VENUES) {
    try {
      const slots = await scrapeVenue(venue, date);
      allSlots.push(...slots);
    } catch (error) {
      console.error(`Error scraping ${venue.slug}:`, error);
    }
  }

  return allSlots;
}

export function getNextNDays(n: number): string[] {
  const dates: string[] = [];
  const today = new Date();

  for (let i = 0; i < n; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    dates.push(date.toISOString().split("T")[0]);
  }

  return dates;
}
