import * as cheerio from "cheerio";
import UserAgent from "user-agents";
import { proxyManager } from "../proxy-manager";
import { ScrapedSlot } from "./types";

export async function scrapeCourtside(
  venueSlug: string,
  date: string
): Promise<ScrapedSlot[]> {
  const url = `https://tennistowerhamlets.com/book/courts/${venueSlug}/${date}`;

  // Generate random desktop user agent
  const userAgent = new UserAgent({ deviceCategory: "desktop" });

  // Get rotating proxy agent (new residential IP per request)
  const agent = proxyManager.getAgent();

  const fetchOptions: RequestInit & { agent?: unknown } = {
    agent,
    headers: {
      "User-Agent": userAgent.toString(),
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9,en-US;q=0.8",
      "Accept-Encoding": "gzip, deflate, br",
      DNT: "1",
      Connection: "keep-alive",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Cache-Control": "max-age=0",
    },
  };

  console.log(
    `🔍 Fetching ${venueSlug} for ${date} ${agent ? "via rotating proxy" : "direct"}`
  );

  const response = await fetch(url, fetchOptions as RequestInit);

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${response.statusText} for ${url}`
    );
  }

  const html = await response.text();

  // Verify we got actual HTML (not a block page)
  if (
    html.includes("Access Denied") ||
    html.includes("403 Forbidden") ||
    html.length < 100
  ) {
    throw new Error(`Blocked or empty response for ${venueSlug}`);
  }

  console.log(`✅ Successfully fetched ${venueSlug} (${html.length} bytes)`);

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
        const button = $(courtLabel).find("span.button");
        const priceSpan = $(courtLabel).find("span.price");

        // Extract court name (e.g., "Court 1", "Court 2")
        const buttonText = button
          .clone()
          .children()
          .remove()
          .end()
          .text()
          .trim();
        const court = buttonText || "Unknown";

        // Determine status from button class
        let status: "available" | "booked" | "closed" | "coaching";
        let price: string | undefined;

        if (button.hasClass("available")) {
          status = "available";
          price = priceSpan.text().trim();
        } else if (button.hasClass("booked")) {
          status = "booked";
        } else if (button.hasClass("coaching") || button.hasClass("class")) {
          // Coaching or class sessions
          status = "coaching";
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
