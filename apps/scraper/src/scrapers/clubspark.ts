import { Browser, Page } from 'puppeteer';
import { Venue, ScrapedSlot, RawSlotData } from '../types';

/**
 * Scrapes court availability from ClubSpark platform (e.g., Stratford Park)
 * Based on Python implementation with Playwright
 */
export async function scrapeClubSpark(
  venue: Venue,
  browser: Browser
): Promise<ScrapedSlot[]> {
  let page: Page | null = null;

  try {
    console.log(`🎾 [ClubSpark] Scraping ${venue.name}...`);

    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // ClubSpark URL format: /Booking/BookByDate#?date=YYYY-MM-DD&role=guest
    const today = new Date().toISOString().split('T')[0];
    const dateUrl = buildClubSparkDateUrl(venue.baseUrl, today);

    console.log(`📍 [ClubSpark] Navigating to ${dateUrl}`);

    await page.goto(dateUrl, {
      waitUntil: 'networkidle2',
      timeout: 45000,
    });

    // Wait for booking sheet to load
    await sleep(3000);

    try {
      await page.waitForSelector('.booking-sheet', { timeout: 15000 });
    } catch {
      console.log(`⚠️ [ClubSpark] ${venue.name}: Booking sheet not found`);
      return [];
    }

    // Respectful scraping delay
    await sleep(2000);

    // Extract available slots using ClubSpark selectors
    const slots: RawSlotData[] = await page.evaluate((venueId: string) => {
      const availableSlots = document.querySelectorAll('a.book-interval.not-booked');
      const results: RawSlotData[] = [];

      availableSlots.forEach((slotElement) => {
        try {
          // Extract price from parent resource-session data-session-cost
          let price: number | null = null;
          let current: Element | null = slotElement;

          while (current && current.parentElement) {
            current = current.parentElement;
            if (current.classList.contains('resource-session')) {
              const sessionCost = current.getAttribute('data-session-cost');
              if (sessionCost) {
                price = parseFloat(sessionCost);
              }
              break;
            }
          }

          // Fallback to span.cost
          if (price === null) {
            const costElement = slotElement.querySelector('span.cost');
            if (costElement?.textContent) {
              const match = costElement.textContent.match(/[\d.]+/);
              if (match) price = parseFloat(match[0]);
            }
          }

          // Extract time from span.available-booking-slot
          const timeElement = slotElement.querySelector('span.available-booking-slot');
          if (!timeElement?.textContent) return;

          // Parse "Book at 08:00 - 09:00" format
          const timeMatch = timeElement.textContent.match(/Book at (\d{2}:\d{2}) - (\d{2}:\d{2})/);
          if (!timeMatch) return;

          const startTime = timeMatch[1];
          const endTime = timeMatch[2];

          // Extract court info from parent resource container
          let courtName = 'Court 1';
          let courtElement: Element | null = slotElement;

          while (courtElement && courtElement.parentElement) {
            courtElement = courtElement.parentElement;
            if (courtElement.classList.contains('resource')) {
              const courtNameAttr = courtElement.getAttribute('data-resource-name');
              if (courtNameAttr) {
                courtName = courtNameAttr;
              } else {
                const headerElement = courtElement.querySelector('.resource-header h3');
                if (headerElement?.textContent) {
                  courtName = headerElement.textContent.trim();
                }
              }
              break;
            }
          }

          // Extract booking URL
          const href = slotElement.getAttribute('href');
          let bookingUrl = href || '';
          if (href && href !== '#' && !href.startsWith('http')) {
            const baseUrl = window.location.origin + window.location.pathname.split('/Booking')[0];
            bookingUrl = baseUrl + href;
          }

          // Get date from URL or use today
          const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
          const date = urlParams.get('date') || new Date().toISOString().split('T')[0];

          results.push({
            venueId,
            courtName,
            startTime,
            endTime,
            price,
            date,
            bookingUrl,
          });
        } catch (err) {
          console.error('Error parsing slot:', err);
        }
      });

      return results;
    }, venue.id);

    // Convert to ScrapedSlot format
    const courtSlots: ScrapedSlot[] = slots.map((slot) => ({
      venueId: slot.venueId,
      courtName: slot.courtName,
      startTime: new Date(`${slot.date}T${slot.startTime}:00`),
      endTime: new Date(`${slot.date}T${slot.endTime}:00`),
      price: slot.price || 0,
      currency: 'GBP',
      bookingUrl: slot.bookingUrl,
      isAvailable: true,
    }));

    console.log(`✅ [ClubSpark] ${venue.name}: Found ${courtSlots.length} available slots`);
    return courtSlots;

  } catch (error) {
    console.error(
      `❌ [ClubSpark] ${venue.name} scraping failed:`,
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

function buildClubSparkDateUrl(baseUrl: string, date: string): string {
  const cleanUrl = baseUrl.split('#')[0];
  return `${cleanUrl}#?date=${date}&role=guest`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
