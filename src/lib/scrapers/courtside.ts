import * as cheerio from "cheerio";
import UserAgent from "user-agents";
import { proxyManager } from "../proxy-manager";
import { ScrapedSlot } from "./types";

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 2000; // 2 seconds base, exponential backoff

// Generate browser-like headers
function getHeaders(userAgent: string, referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9,en-US;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    DNT: "1",
    Connection: "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": referer ? "same-origin" : "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
  };

  if (referer) {
    headers["Referer"] = referer;
  }

  return headers;
}

async function fetchWithRetry(
  url: string,
  venueSlug: string,
  date: string
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    // Generate fresh user agent for each attempt
    const userAgent = new UserAgent({ deviceCategory: "desktop" }).toString();

    // Create a sticky session (same IP for warmup + actual request)
    const session = proxyManager.createStickySession();
    const agent = session?.agent || null;

    // First request: visit homepage to look like a real user and get cookies
    const homepageUrl = "https://tennistowerhamlets.com/";

    try {
      if (attempt === 1) {
        console.log(
          `🔍 Fetching ${venueSlug} for ${date} ${agent ? "via sticky session" : "direct"}`
        );
      } else {
        console.log(
          `🔄 Retry ${attempt}/${MAX_RETRIES} for ${venueSlug} ${date} (new session/IP)`
        );
      }

      // Warm-up request to homepage using the same sticky session
      const warmupResponse = await fetch(homepageUrl, {
        agent,
        headers: getHeaders(userAgent),
      } as RequestInit);

      // Small delay to simulate human browsing
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));

      // Extract any cookies from warmup response
      const cookies = warmupResponse.headers.get("set-cookie") || "";

      // Now fetch the actual page with referer (using SAME agent = same IP)
      const fetchOptions: RequestInit & { agent?: unknown } = {
        agent,
        headers: {
          ...getHeaders(userAgent, homepageUrl),
          ...(cookies && { Cookie: cookies.split(";")[0] }),
        },
      };

      const response = await fetch(url, fetchOptions as RequestInit);

      if (response.status === 404) {
        // 404 might be a soft block - retry with new session/IP
        throw new Error(`HTTP 404 - possible block, retrying...`);
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      // Verify we got actual HTML (not a block page)
      if (
        html.includes("Access Denied") ||
        html.includes("403 Forbidden") ||
        html.includes("blocked") ||
        html.length < 100
      ) {
        throw new Error(`Blocked or empty response`);
      }

      console.log(`✅ Successfully fetched ${venueSlug} (${html.length} bytes)`);
      return html;
    } catch (error) {
      lastError = error as Error;
      console.warn(
        `⚠️ Attempt ${attempt} failed for ${venueSlug}: ${lastError.message}`
      );

      if (attempt < MAX_RETRIES) {
        // Exponential backoff: 2s, 4s, 8s
        const delay = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
        console.log(`⏳ Waiting ${delay / 1000}s before retry...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw new Error(
    `Failed after ${MAX_RETRIES} attempts for ${url}: ${lastError?.message}`
  );
}

export async function scrapeCourtside(
  venueSlug: string,
  date: string
): Promise<ScrapedSlot[]> {
  const url = `https://tennistowerhamlets.com/book/courts/${venueSlug}/${date}`;

  const html = await fetchWithRetry(url, venueSlug, date);

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
