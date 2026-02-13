import { Resend } from "resend";
import { SlotChange } from "../differ";
import { getBookingUrl } from "../utils/link-helpers";
import type { ScrapeStats } from "../scraper";

// Admin email for scrape alerts
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

// Alert threshold: if failure rate exceeds this percentage, send alert
const FAILURE_ALERT_THRESHOLD = parseFloat(process.env.SCRAPE_FAILURE_THRESHOLD || "20");

// Resend client for HTTP-based email
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Validate EMAIL_FROM is set at module load time
const EMAIL_FROM = process.env.EMAIL_FROM;
if (resend && !EMAIL_FROM) {
  console.error(
    "ERROR: EMAIL_FROM environment variable is not set. " +
    "Email notifications will fail. " +
    "Please set EMAIL_FROM to a verified domain in your Resend account (e.g., 'Your App <noreply@yourdomain.com>')."
  );
}

export async function sendEmail(to: string, subject: string, html: string) {
  if (!resend) {
    console.warn("RESEND_API_KEY not set, skipping email notification");
    return;
  }

  if (!EMAIL_FROM) {
    throw new Error(
      "EMAIL_FROM environment variable is not set. " +
      "Please configure EMAIL_FROM with a verified domain in your Resend account. " +
      "Example: EMAIL_FROM='Your App <noreply@yourdomain.com>'"
    );
  }

  const result = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject,
    html,
  });

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message}`);
  }

  return result;
}

export function formatSlotChangesForEmail(changes: SlotChange[]): {
  subject: string;
  html: string;
} {
  if (changes.length === 0) {
    return { subject: "", html: "" };
  }

  const subject = `${changes.length} tennis court${changes.length > 1 ? "s" : ""} now available`;

  // Group by venue and date
  const grouped: Record<string, { venueName: string; venueSlug: string; date: string; slots: SlotChange[] }> = {};
  for (const change of changes) {
    const key = `${change.venue}|${change.date}`;
    if (!grouped[key]) {
      grouped[key] = {
        venueName: change.venueName,
        venueSlug: change.venue,
        date: change.date,
        slots: [],
      };
    }
    grouped[key].slots.push(change);
  }

  let html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #16a34a; font-size: 28px; margin: 0 0 8px 0;">🎾 Tennis Courts Available!</h1>
        <p style="color: #6b7280; font-size: 16px; margin: 0;">${changes.length} slot${changes.length > 1 ? "s" : ""} just became available</p>
      </div>
  `;

  for (const group of Object.values(grouped)) {
    const formattedDate = new Date(group.date).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const bookingUrl = getBookingUrl(group.venueSlug, group.date);
    
    // Sort slots by time
    const sortedSlots = [...group.slots].sort((a, b) => {
      const timeA = a.time.toLowerCase();
      const timeB = b.time.toLowerCase();
      return timeA.localeCompare(timeB);
    });

    html += `
      <div style="margin-bottom: 24px; padding: 20px; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
        <div style="margin-bottom: 16px;">
          <h2 style="margin: 0 0 6px 0; color: #111827; font-size: 20px; font-weight: 600;">${group.venueName}</h2>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">${formattedDate}</p>
        </div>
        
        <div style="background: #f9fafb; padding: 12px; border-radius: 8px; margin-bottom: 16px;">
          <p style="margin: 0 0 8px 0; color: #374151; font-size: 14px; font-weight: 500;">Available slots:</p>
          <ul style="margin: 0; padding-left: 20px; list-style: none;">
    `;

    for (const slot of sortedSlots) {
      const priceStr = slot.price ? ` <span style="color: #059669; font-weight: 500;">${slot.price}</span>` : "";
      html += `<li style="margin: 6px 0; color: #374151; font-size: 14px;">• ${slot.time} - <strong>${slot.court}</strong>${priceStr}</li>`;
    }

    html += `
          </ul>
        </div>
        
        <a href="${bookingUrl}" 
           style="display: inline-block; width: 100%; text-align: center; padding: 14px 24px; background: #16a34a; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; transition: background-color 0.2s;">
          Book ${group.venueName} →
        </a>
      </div>
    `;
  }

  html += `
      <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e7eb; text-align: center;">
        <p style="margin: 0 0 8px 0; color: #9ca3af; font-size: 13px;">
          You're receiving this because you set up a tennis court alert.
        </p>
        <p style="margin: 0; color: #9ca3af; font-size: 12px;">
          Manage your alerts in your <a href="${process.env.NEXTAUTH_URL || "https://your-app.com"}/dashboard?tab=settings" style="color: #16a34a; text-decoration: underline;">dashboard</a>
        </p>
      </div>
    </div>
  `;

  return { subject, html };
}

/**
 * Send admin alert when scrape failures exceed threshold.
 * Requires ADMIN_EMAIL env var to be set.
 */
export async function sendScrapeFailureAlert(stats: ScrapeStats): Promise<boolean> {
  if (!resend || !ADMIN_EMAIL) {
    if (!ADMIN_EMAIL) {
      console.warn("Admin alerting not configured (missing ADMIN_EMAIL)");
    }
    return false;
  }

  const totalTasks = stats.venuesSuccess + stats.venuesFailed;
  const failureRate = totalTasks > 0 ? (stats.venuesFailed / totalTasks) * 100 : 0;

  // Only alert if failure rate exceeds threshold
  if (failureRate < FAILURE_ALERT_THRESHOLD) {
    return false;
  }

  const subject = `⚠️ Scrape Alert: ${failureRate.toFixed(0)}% Failure Rate`;

  let html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
        <h1 style="color: #dc2626; font-size: 24px; margin: 0 0 16px 0;">⚠️ Scrape Alert: High Failure Rate</h1>

        <div style="background: white; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
          <h3 style="margin: 0 0 12px 0; color: #374151;">📊 Stats</h3>
          <ul style="margin: 0; padding-left: 20px; color: #4b5563;">
            <li>Duration: <strong>${stats.durationFormatted}</strong></li>
            <li>Data transferred: <strong>${stats.totalBytesFormatted}</strong></li>
            <li>Success: <strong style="color: #16a34a;">${stats.venuesSuccess}/${totalTasks}</strong> (${(100 - failureRate).toFixed(1)}%)</li>
            <li>Failed: <strong style="color: #dc2626;">${stats.venuesFailed}/${totalTasks}</strong> (${failureRate.toFixed(1)}%)</li>
          </ul>
        </div>
  `;

  if (stats.failedVenues.length > 0) {
    html += `
        <div style="background: white; padding: 16px; border-radius: 8px;">
          <h3 style="margin: 0 0 12px 0; color: #374151;">❌ Failed Venues</h3>
          <ul style="margin: 0; padding-left: 20px; color: #4b5563; font-family: monospace; font-size: 13px;">
    `;
    const maxToShow = 15;
    for (const venue of stats.failedVenues.slice(0, maxToShow)) {
      html += `<li style="margin: 4px 0;">${venue}</li>`;
    }
    if (stats.failedVenues.length > maxToShow) {
      html += `<li style="margin: 4px 0; color: #9ca3af;">... and ${stats.failedVenues.length - maxToShow} more</li>`;
    }
    html += `
          </ul>
        </div>
    `;
  }

  html += `
      </div>
      <p style="color: #6b7280; font-size: 13px; text-align: center;">
        🔧 Check server logs for detailed error messages.
      </p>
    </div>
  `;

  try {
    await sendEmail(ADMIN_EMAIL, subject, html);
    console.log(`🚨 Admin alert sent: ${failureRate.toFixed(1)}% failure rate`);
    return true;
  } catch (error) {
    console.error("Failed to send admin alert:", error);
    return false;
  }
}

/**
 * Send a scrape summary to admin (optional, for monitoring).
 */
export async function sendScrapeSummary(stats: ScrapeStats): Promise<boolean> {
  if (!resend || !ADMIN_EMAIL) {
    return false;
  }

  // Only send summary if LOG_SCRAPE_SUMMARY is enabled
  if (process.env.LOG_SCRAPE_SUMMARY !== "true") {
    return false;
  }

  const totalTasks = stats.venuesSuccess + stats.venuesFailed;
  const successRate = totalTasks > 0 ? (stats.venuesSuccess / totalTasks) * 100 : 0;

  const subject = `📊 Scrape Summary: ${stats.slotsScraped} slots in ${stats.durationFormatted}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 20px;">
        <h1 style="color: #16a34a; font-size: 24px; margin: 0 0 16px 0;">📊 Scrape Summary</h1>

        <div style="background: white; padding: 16px; border-radius: 8px;">
          <ul style="margin: 0; padding-left: 20px; color: #4b5563;">
            <li>⏱ Duration: <strong>${stats.durationFormatted}</strong></li>
            <li>📦 Data: <strong>${stats.totalBytesFormatted}</strong> (${stats.totalRequests} requests)</li>
            <li>✅ Success: <strong>${stats.venuesSuccess}/${totalTasks}</strong> (${successRate.toFixed(0)}%)</li>
            <li>🎾 Slots: <strong>${stats.slotsScraped}</strong></li>
            ${stats.venuesFailed > 0 ? `<li>⚠️ Failures: <strong style="color: #dc2626;">${stats.venuesFailed}</strong></li>` : ""}
          </ul>
        </div>
      </div>
    </div>
  `;

  try {
    await sendEmail(ADMIN_EMAIL, subject, html);
    return true;
  } catch (error) {
    console.error("Failed to send scrape summary:", error);
    return false;
  }
}
