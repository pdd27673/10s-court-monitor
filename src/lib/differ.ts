import { db } from "./db";
import { venues } from "./schema";
import { eq } from "drizzle-orm";
import { VENUES } from "./constants";

/**
 * A booked/closed → available transition, emitted by the ingestion stages and
 * consumed by `notifyUsers`. The canonical change shape shared across the feed
 * head-poll (Clock 1), confirm-on-notify, and the periodic full sweep.
 */
export interface SlotChange {
  venue: string;
  venueName: string;
  date: string;
  time: string;
  court: string;
  oldStatus: string | null;
  newStatus: string;
  price?: string;
}

// Ensure all statically-configured venues exist in the database. The OpenActive
// facility ingest enriches these rows (geo/courts/external_id) and adds any
// feed-discovered venues on top.
export async function ensureVenuesExist() {
  for (const venue of VENUES) {
    const existing = await db.query.venues.findFirst({
      where: eq(venues.slug, venue.slug),
    });

    if (!existing) {
      await db.insert(venues).values({
        slug: venue.slug,
        name: venue.name,
      });
    }
  }
}
