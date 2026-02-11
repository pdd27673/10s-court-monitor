import * as cheerio from "cheerio";
import UserAgent from "user-agents";
import { proxyManager, proxyFetch } from "../proxy-manager";
import { ScrapedSlot } from "./types";

const MAX_RETRIES = 2;
const RETRY_DELAY = 1000;

function getHeaders(userAgent: string): Record<string, string> {
  return {
    "User-Agent": userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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
    Referer: "https://www.google.com/",
  };
}

async function fetchWithRetry(
  url: string,
  venueSlug: string,
  date: string
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const userAgent = new UserAgent({ deviceCategory: "desktop" }).toString();
    const agent = proxyManager.getAgent();

    try {
      console.log(`📍 Courtside ${venueSlug} | ${date} | ${agent ? "proxy" : "DIRECT"} | attempt ${attempt}`);

      const response = await proxyFetch(url, {
        agent,
        headers: getHeaders(userAgent),
        timeout: 15000,
      });

      const html = response.body;

      // Check for blocking
      if (response.status === 404) {
        const isBlocked = html.includes("blocked") || html.includes("denied") || html.includes("captcha");
        throw new Error(isBlocked ? "IP blocked (404)" : "HTTP 404");
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (html.includes("Access Denied") || html.includes("403 Forbidden") || html.length < 100) {
        throw new Error("Blocked or empty response");
      }

      return html;
    } catch (error) {
      lastError = error as Error;
      console.log(`   ❌ ${venueSlug}: ${lastError.message}`);

      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
      }
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

export async function scrapeCourtside(
  venueSlug: string,
  date: string
): Promise<ScrapedSlot[]> {
  const url = `https://tennistowerhamlets.com/book/courts/${venueSlug}/${date}`;

  const html = await fetchWithRetry(url, venueSlug, date);

  const $ = cheerio.load(html);
  const slots: ScrapedSlot[] = [];

  $("table tr").each((_, row) => {
    const timeEl = $(row).find("th.time");
    const time = timeEl.text().trim();
    if (!time) return;

    $(row)
      .find("label.court")
      .each((_, courtLabel) => {
        const button = $(courtLabel).find("span.button");
        const priceSpan = $(courtLabel).find("span.price");

        const buttonText = button
          .clone()
          .children()
          .remove()
          .end()
          .text()
          .trim();
        const court = buttonText || "Unknown";

        let status: "available" | "booked" | "closed" | "coaching";
        let price: string | undefined;

        if (button.hasClass("available")) {
          status = "available";
          price = priceSpan.text().trim();
        } else if (button.hasClass("booked")) {
          status = "booked";
        } else if (button.hasClass("coaching") || button.hasClass("class")) {
          status = "coaching";
        } else {
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
