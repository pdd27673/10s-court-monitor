import * as cheerio from "cheerio";
import UserAgent from "user-agents";
import { proxyManager, proxyFetch } from "../proxy-manager";
import { ScrapedSlot } from "./types";

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 2000;

function getHeaders(userAgent: string, referer?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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
    const userAgent = new UserAgent({ deviceCategory: "desktop" }).toString();
    // Use regular rotating proxy (sticky sessions have auth issues)
    const agent = proxyManager.getAgent();

    const homepageUrl = "https://tennistowerhamlets.com/";

    try {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`📍 ${venueSlug} | ${date} | Attempt ${attempt}/${MAX_RETRIES}`);
      console.log(`   Agent: ${agent ? "via proxy" : "DIRECT (no proxy!)"}`);
      console.log(`   UA: ${userAgent.slice(0, 60)}...`);

      // Warmup request
      console.log(`\n   [1/2] Warmup: ${homepageUrl}`);
      const warmupStart = Date.now();
      const warmupResponse = await proxyFetch(homepageUrl, {
        agent,
        headers: getHeaders(userAgent),
        timeout: 15000,
      });
      const warmupMs = Date.now() - warmupStart;

      console.log(`         Status: ${warmupResponse.status} ${warmupResponse.statusText} (${warmupMs}ms)`);
      console.log(`         Size: ${warmupResponse.body.length} bytes`);

      if (!warmupResponse.ok) {
        console.log(`         ❌ Warmup failed!`);
        throw new Error(`Warmup failed: ${warmupResponse.status}`);
      }

      // Human-like delay
      const delay = 500 + Math.random() * 1000;
      console.log(`         Waiting ${Math.round(delay)}ms...`);
      await new Promise((r) => setTimeout(r, delay));

      // Get cookies
      const cookies = warmupResponse.headers.get("set-cookie") || "";
      if (cookies) {
        console.log(`         Cookies: ${cookies.slice(0, 50)}...`);
      }

      // Main request
      console.log(`\n   [2/2] Target: ${url}`);
      const fetchStart = Date.now();
      const response = await proxyFetch(url, {
        agent,
        headers: {
          ...getHeaders(userAgent, homepageUrl),
          ...(cookies && { Cookie: cookies.split(";")[0] }),
        },
        timeout: 20000,
      });
      const fetchMs = Date.now() - fetchStart;

      console.log(`         Status: ${response.status} ${response.statusText} (${fetchMs}ms)`);
      console.log(`         Size: ${response.body.length} bytes`);
      console.log(`         Content-Type: ${response.headers.get("content-type") || "unknown"}`);
      console.log(`         Server: ${response.headers.get("server") || "unknown"}`);

      const cfRay = response.headers.get("cf-ray");
      if (cfRay) {
        console.log(`         CF-Ray: ${cfRay} (Cloudflare)`);
      }

      const html = response.body;

      // Check for blocking
      if (response.status === 404) {
        console.log(`\n         ⚠️ 404 Response - analyzing...`);
        console.log(`         Preview: ${html.slice(0, 200).replace(/\n/g, " ")}`);

        if (html.includes("blocked") || html.includes("denied") || html.includes("captcha")) {
          console.log(`         🚫 BLOCK PAGE detected!`);
        } else if (html.includes("Page not found") || html.includes("Not Found")) {
          console.log(`         📄 Genuine 404 page`);
        }
        throw new Error(`HTTP 404 - possible block`);
      }

      if (!response.ok) {
        console.log(`         ❌ Error response: ${html.slice(0, 200)}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (html.includes("Access Denied") || html.includes("403 Forbidden") || html.includes("blocked") || html.length < 100) {
        console.log(`         🚫 BLOCKED! Body: ${html.slice(0, 200)}`);
        throw new Error(`Blocked or empty response`);
      }

      const courtCount = (html.match(/label\.court|class="court"/g) || []).length;
      console.log(`\n   ✅ SUCCESS: ${html.length} bytes, ~${courtCount} court elements`);

      return html;
    } catch (error) {
      lastError = error as Error;
      console.log(`\n   ❌ FAILED: ${lastError.message}`);

      if (attempt < MAX_RETRIES) {
        const backoff = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
        console.log(`   ⏳ Retrying in ${backoff / 1000}s...`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts for ${url}: ${lastError?.message}`);
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
