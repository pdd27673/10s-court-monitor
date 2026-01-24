import * as cheerio from "cheerio";
import { ScrapedSlot } from "./types";

export async function scrapeCourtside(
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
