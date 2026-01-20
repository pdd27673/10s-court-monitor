import * as cheerio from "cheerio";

export interface ScrapedSlot {
  venue: string;
  date: string;
  time: string;
  court: string;
  status: "available" | "booked" | "closed";
  price?: string;
}

export const VENUES = [
  { slug: "bethnal-green-gardens", name: "Bethnal Green Gardens" },
  { slug: "king-edward-memorial-park", name: "King Edward Memorial Park" },
  { slug: "poplar-rec-ground", name: "Poplar Rec Ground" },
  { slug: "ropemakers-field", name: "Ropemakers Field" },
  { slug: "st-johns-park", name: "St Johns Park" },
  { slug: "victoria-park", name: "Victoria Park" },
  { slug: "wapping-gardens", name: "Wapping Gardens" },
];

export async function scrapeVenue(
  venueSlug: string,
  date: string
): Promise<ScrapedSlot[]> {
  const url = `https://tennistowerhamlets.com/book/courts/${venueSlug}/${date}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; TennisNotifier/1.0)",
      Accept: "text/html",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const slots: ScrapedSlot[] = [];

  // Parse the availability table
  $("table tr").each((_, row) => {
    const timeEl = $(row).find("th.time");
    const time = timeEl.text().trim();
    if (!time) return;

    // Each court is in a label.court element
    $(row)
      .find("label.court")
      .each((_, courtLabel) => {
        const checkbox = $(courtLabel).find('input[type="checkbox"]');
        const button = $(courtLabel).find("span.button");
        const priceSpan = $(courtLabel).find("span.price");

        // Extract court name (e.g., "Court 1", "Court 2")
        const buttonText = button.clone().children().remove().end().text().trim();
        const court = buttonText || "Unknown";

        // Determine status from button class
        let status: "available" | "booked" | "closed";
        let price: string | undefined;

        if (button.hasClass("available")) {
          status = "available";
          price = priceSpan.text().trim();
        } else if (button.hasClass("booked")) {
          status = "booked";
        } else {
          // maintenance or other = closed
          status = "closed";
        }

        slots.push({
          venue: venueSlug,
          date,
          time,
          court,
          status,
          price,
        });
      });
  });

  return slots;
}

export async function scrapeAllVenues(date: string): Promise<ScrapedSlot[]> {
  const allSlots: ScrapedSlot[] = [];

  for (const venue of VENUES) {
    try {
      const slots = await scrapeVenue(venue.slug, date);
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
