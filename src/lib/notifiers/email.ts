import { Resend } from "resend";
import { SlotChange } from "../differ";
import { getBookingUrl } from "../utils/link-helpers";
import { escapeHtml } from "../utils/html-escape";

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
          <h2 style="margin: 0 0 6px 0; color: #111827; font-size: 20px; font-weight: 600;">${escapeHtml(group.venueName)}</h2>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">${escapeHtml(formattedDate)}</p>
        </div>
        
        <div style="background: #f9fafb; padding: 12px; border-radius: 8px; margin-bottom: 16px;">
          <p style="margin: 0 0 8px 0; color: #374151; font-size: 14px; font-weight: 500;">Available slots:</p>
          <ul style="margin: 0; padding-left: 20px; list-style: none;">
    `;

    for (const slot of sortedSlots) {
      const priceStr = slot.price ? ` <span style="color: #059669; font-weight: 500;">${escapeHtml(slot.price)}</span>` : "";
      html += `<li style="margin: 6px 0; color: #374151; font-size: 14px;">• ${escapeHtml(slot.time)} - <strong>${escapeHtml(slot.court)}</strong>${priceStr}</li>`;
    }

    html += `
          </ul>
        </div>
        
        <a href="${escapeHtml(bookingUrl)}" 
           style="display: inline-block; width: 100%; text-align: center; padding: 14px 24px; background: #16a34a; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; transition: background-color 0.2s;">
          Book ${escapeHtml(group.venueName)} →
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
