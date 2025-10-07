import { Browser, Page } from 'puppeteer';
import { Venue, ScrapedSlot, RawCourtsideSlotData } from '../types';

/**
 * Scrapes court availability from Courtside platform (e.g., Victoria Park, Ropemakers Field)
 * Based on Python implementation with Playwright
 */
export async function scrapeCourtside(
  venue: Venue,
  browser: Browser
): Promise<ScrapedSlot[]> {
  let page: Page | null = null;

  try {
    console.log(`🎾 [Courtside] Scraping ${venue.name}...`);

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Courtside URL format: /book/courts/venue-name/YYYY-MM-DD#book
    const today = new Date().toISOString().split('T')[0];
    const dateUrl = buildCourtsideDateUrl(venue.baseUrl, today);

    console.log(`📍 [Courtside] Navigating to ${dateUrl}`);

    await page.goto(dateUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait for page to load
    await sleep(2000);

    // Check if courts are closed
    const closedElements = await page.$$('.closed-today');
    if (closedElements.length > 0) {
      console.log(`⚠️ [Courtside] ${venue.name}: Courts closed on ${today}`);
      return [];
    }

    // Wait for court widget to load
    try {
      await page.waitForSelector('.court-widget', { timeout: 10000 });
    } catch {
      console.log(`⚠️ [Courtside] ${venue.name}: Court widget not found`);
      return [];
    }

    // Respectful scraping delay
    await sleep(1000);

    // Extract available slots from bookable checkboxes
    const slots: RawCourtsideSlotData[] = await page.evaluate((venueId: string, venueName: string) => {
      const availableCheckboxes = document.querySelectorAll('input.bookable');
      const results: RawCourtsideSlotData[] = [];

      availableCheckboxes.forEach((checkbox) => {
        try {
          const element = checkbox as HTMLInputElement;

          // Get checkbox value: "254_164_2025-06-10_14:00"
          const checkboxValue = element.value;
          if (!checkboxValue) return;

          const valueParts = checkboxValue.split('_');
          if (valueParts.length < 4) return;

          const [venueIdPart, courtIdPart, datePart, timePart] = valueParts;

          // Extract price from data-price attribute
          const priceStr = element.getAttribute('data-price');
          const price = priceStr ? parseFloat(priceStr) : null;

          // Find the time from parent row
          const row = element.closest('tr');
          let timeCell = row?.querySelector('th.time')?.textContent?.trim();

          // Parse time (e.g., "2pm" -> "14:00-15:00")
          let startTime: string | null = null;
          let endTime: string | null = null;

          if (timeCell) {
            const parsed = parseCourtsideTime(timeCell);
            startTime = parsed.startTime;
            endTime = parsed.endTime;
          } else {
            // Fallback to parsing from checkbox value
            const parsed = parseTimeFromValue(timePart);
            startTime = parsed.startTime;
            endTime = parsed.endTime;
          }

          if (!startTime || !endTime) return;

          // Find court name from button text
          const label = element.closest('label');
          const button = label?.querySelector('span.button.available');
          let courtName = button?.childNodes[0]?.textContent?.trim() || `Court ${courtIdPart}`;

          // Build booking URL
          const baseUrl = window.location.origin + window.location.pathname.split('#')[0];
          const bookingUrl = `${baseUrl}?booking=${checkboxValue}`;

          results.push({
            venueId,
            venueName,
            courtName,
            startTime,
            endTime,
            price,
            date: datePart,
            bookingUrl,
          });
        } catch (err) {
          console.error('Error parsing checkbox:', err);
        }
      });

      // Helper function for time parsing
      function parseCourtsideTime(timeText: string): { startTime: string | null; endTime: string | null } {
        if (!timeText) return { startTime: null, endTime: null };

        timeText = timeText.trim().toLowerCase();

        // Handle am/pm format
        if (timeText.includes('am') || timeText.includes('pm')) {
          const hourMatch = timeText.match(/(\d+)/);
          if (!hourMatch) return { startTime: null, endTime: null };

          let hour = parseInt(hourMatch[1]);

          // Convert to 24-hour format
          if (timeText.includes('pm') && hour !== 12) {
            hour += 12;
          } else if (timeText.includes('am') && hour === 12) {
            hour = 0;
          }

          const startTime = `${hour.toString().padStart(2, '0')}:00`;
          const endTime = `${(hour + 1).toString().padStart(2, '0')}:00`;

          return { startTime, endTime };
        }

        return { startTime: null, endTime: null };
      }

      function parseTimeFromValue(timePart: string): { startTime: string | null; endTime: string | null } {
        if (!timePart || !timePart.includes(':')) {
          return { startTime: null, endTime: null };
        }

        try {
          const [hourStr, minute] = timePart.split(':');
          const hour = parseInt(hourStr);
          const startTime = `${hour.toString().padStart(2, '0')}:${minute}`;
          const endTime = `${(hour + 1).toString().padStart(2, '0')}:${minute}`;
          return { startTime, endTime };
        } catch {
          return { startTime: null, endTime: null };
        }
      }

      return results;
    }, venue.id, venue.name);

    // Convert to ScrapedSlot format
    const courtSlots: ScrapedSlot[] = slots.map((slot) => ({
      venueId: slot.venueId,
      courtName: `${slot.venueName} ${slot.courtName}`,
      startTime: new Date(`${slot.date}T${slot.startTime}:00`),
      endTime: new Date(`${slot.date}T${slot.endTime}:00`),
      price: slot.price || 0,
      currency: 'GBP',
      bookingUrl: slot.bookingUrl,
      isAvailable: true,
    }));

    console.log(`✅ [Courtside] ${venue.name}: Found ${courtSlots.length} available slots`);
    return courtSlots;

  } catch (error) {
    console.error(
      `❌ [Courtside] ${venue.name} scraping failed:`,
      error instanceof Error ? error.message : error
    );
    return [];
  } finally {
    if (page) {
      await page.close().catch((err) =>
        console.error(`Failed to close page for ${venue.name}:`, err)
      );
    }
  }
}

function buildCourtsideDateUrl(baseUrl: string, date: string): string {
  const cleanUrl = baseUrl.split('#')[0];
  return `${cleanUrl}/${date}#book`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
