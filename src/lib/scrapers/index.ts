import { Venue } from "../constants";
import { ScrapedSlot } from "./types";
import { scrapeCourtside } from "./courtside";
import { scrapeClubSpark } from "./clubspark";

export type { ScrapedSlot } from "./types";

export async function scrapeVenue(
  venue: Venue,
  date: string
): Promise<ScrapedSlot[]> {
  switch (venue.type) {
    case "clubspark":
      return scrapeClubSpark(venue, date);
    case "courtside":
    default:
      return scrapeCourtside(venue.slug, date);
  }
}
