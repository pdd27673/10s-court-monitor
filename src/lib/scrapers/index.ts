import { Venue } from "../constants";
import { ScrapedSlot } from "./types";
import { scrapeCourtside } from "./courtside";

export type { ScrapedSlot } from "./types";
export { scrapeClubSpark } from "./clubspark";

// Only used for Courtside venues; ClubSpark is scraped per-venue via scrapeClubSpark
export async function scrapeVenue(
  venue: Venue,
  date: string
): Promise<ScrapedSlot[]> {
  return scrapeCourtside(venue.slug, date);
}
