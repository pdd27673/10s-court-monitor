import { sendEmail } from "./notifiers/email";

/**
 * Scraper-health detection.
 *
 * The real-world failure mode is a scrape that returns HTTP 200 but parses
 * ZERO slots (the booking site changed its HTML and the parser silently yields
 * nothing). This is invisible to the existing failure alert, which only fires
 * on thrown exceptions. Because the scraper records *every* slot regardless of
 * status (available/booked/closed/coaching), a healthy run over the whole
 * window essentially always yields many slots — so "scraped targets but got
 * ~no slots" is a high-confidence signal that a parser broke.
 */

export interface ScrapeHealthInput {
  slots: { venue: string }[];
  targetsScraped: number;
}

export interface ScrapeHealthResult {
  healthy: boolean;
  reason?: string;
  total: number;
  perVenue: Record<string, number>;
}

/**
 * Assess whether a completed scrape run looks healthy. Pure — no side effects.
 *
 * Unhealthy when targets were scraped but the run produced fewer slots than
 * expected. By default the only trigger is zero slots (very high confidence);
 * set SCRAPE_MIN_SLOTS_PER_TARGET to tighten (e.g. "1" flags runs that
 * averaged under 1 slot per scraped target).
 */
export function assessScrapeHealth(input: ScrapeHealthInput): ScrapeHealthResult {
  const { slots, targetsScraped } = input;

  const perVenue: Record<string, number> = {};
  for (const slot of slots) {
    perVenue[slot.venue] = (perVenue[slot.venue] ?? 0) + 1;
  }
  const total = slots.length;

  // A run that scraped nothing (nothing due) is not a health signal.
  if (targetsScraped <= 0) {
    return { healthy: true, total, perVenue };
  }

  if (total === 0) {
    return {
      healthy: false,
      reason: `Scraped ${targetsScraped} targets but parsed 0 slots — parser likely broken`,
      total,
      perVenue,
    };
  }

  const minPerTarget = parseFloat(process.env.SCRAPE_MIN_SLOTS_PER_TARGET || "0");
  if (minPerTarget > 0 && total / targetsScraped < minPerTarget) {
    return {
      healthy: false,
      reason: `Only ${total} slots across ${targetsScraped} targets (< ${minPerTarget}/target) — possible partial parser break`,
      total,
      perVenue,
    };
  }

  return { healthy: true, total, perVenue };
}

let lastHealthAlertAt = 0;

function healthAlertCooldownMs(): number {
  const hours = parseFloat(process.env.SCRAPE_HEALTH_COOLDOWN_HOURS || "1");
  return hours * 60 * 60 * 1000;
}

async function pingHealthcheck(healthy: boolean): Promise<void> {
  // Healthchecks.io dead-man's-switch (off-the-shelf). Success ping keeps the
  // check green; /fail flips it red and triggers the configured alert.
  const base = process.env.SCRAPE_HEALTHCHECK_URL;
  if (!base) return;
  const url = healthy ? base : `${base.replace(/\/$/, "")}/fail`;
  try {
    await fetch(url, { method: "POST" });
  } catch (error) {
    console.error("Healthcheck ping failed:", error);
  }
}

/**
 * Assess the run, ping the Healthchecks dead-man's-switch, and email the admin
 * on unhealthy (rate-limited by a cooldown). Call from the scrape job.
 */
export async function reportScrapeHealth(
  input: ScrapeHealthInput
): Promise<ScrapeHealthResult> {
  const result = assessScrapeHealth(input);

  await pingHealthcheck(result.healthy);

  if (!result.healthy) {
    console.error(`🚨 Scrape health check FAILED: ${result.reason}`);

    const now = Date.now();
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail && now - lastHealthAlertAt > healthAlertCooldownMs()) {
      lastHealthAlertAt = now;
      const perVenueRows = Object.entries(result.perVenue)
        .map(([v, n]) => `<li>${v}: ${n} slots</li>`)
        .join("");
      try {
        await sendEmail(
          adminEmail,
          "🚨 Tennis scraper health alert",
          `
            <div style="font-family: sans-serif;">
              <h2>Scraper health check failed</h2>
              <p>${result.reason}</p>
              <p>Total slots this run: <b>${result.total}</b></p>
              <ul>${perVenueRows || "<li>(no slots parsed)</li>"}</ul>
              <p style="color:#666;font-size:12px;">Likely cause: a booking site
              changed its HTML and a parser needs updating.</p>
            </div>
          `
        );
      } catch (error) {
        console.error("Failed to send scrape health alert email:", error);
      }
    }
  } else {
    console.log(`✅ Scrape health OK — ${result.total} slots parsed`);
  }

  return result;
}
