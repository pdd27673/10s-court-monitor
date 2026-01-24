import { Resend } from "resend";
import { SlotChange } from "../differ";

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
  const grouped: Record<string, SlotChange[]> = {};
  for (const change of changes) {
    const key = `${change.venueName}|${change.date}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(change);
  }

  let html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #16a34a;">Tennis Courts Available!</h1>
  `;

  for (const [key, slots] of Object.entries(grouped)) {
    const [venueName, date] = key.split("|");
    const formattedDate = new Date(date).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    html += `
      <div style="margin-bottom: 20px; padding: 16px; background: #f9fafb; border-radius: 8px;">
        <h2 style="margin: 0 0 8px 0; color: #111827;">${venueName}</h2>
        <p style="margin: 0 0 12px 0; color: #6b7280;">${formattedDate}</p>
        <ul style="margin: 0; padding-left: 20px;">
    `;

    for (const slot of slots) {
      const priceStr = slot.price ? ` - ${slot.price}` : "";
      html += `<li style="margin: 4px 0; color: #374151;">${slot.time} - ${slot.court}${priceStr}</li>`;
    }

    html += `
        </ul>
      </div>
    `;
  }

  html += `
      <p style="margin-top: 24px;">
        <a href="https://tennistowerhamlets.com/courts" style="color: #10b981;"
           style="display: inline-block; padding: 12px 24px; background: #16a34a; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
          Book Now
        </a>
      </p>
      <p style="margin-top: 24px; color: #9ca3af; font-size: 14px;">
        You're receiving this because you set up a tennis court alert.
      </p>
    </div>
  `;

  return { subject, html };
}
