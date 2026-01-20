import { db } from "./db";
import { slots, venues } from "./schema";
import { eq, and } from "drizzle-orm";
import { ScrapedSlot } from "./scraper";
import { VENUES } from "./constants";

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

// Create a unique key for a slot
function slotKey(slot: { venue: string; date: string; time: string; court: string }): string {
  return `${slot.venue}:${slot.date}:${slot.time}:${slot.court}`;
}

// Ensure all venues exist in the database
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

// Get venue ID by slug
async function getVenueId(slug: string): Promise<number | null> {
  const venue = await db.query.venues.findFirst({
    where: eq(venues.slug, slug),
  });
  return venue?.id ?? null;
}

// Store scraped slots and return changes
export async function storeAndDiff(scrapedSlots: ScrapedSlot[]): Promise<SlotChange[]> {
  const changes: SlotChange[] = [];

  // Group scraped slots by venue for efficient processing
  const byVenue: Record<string, ScrapedSlot[]> = {};
  for (const slot of scrapedSlots) {
    if (!byVenue[slot.venue]) byVenue[slot.venue] = [];
    byVenue[slot.venue].push(slot);
  }

  for (const [venueSlug, venueSlots] of Object.entries(byVenue)) {
    const venueId = await getVenueId(venueSlug);
    if (!venueId) continue;

    const venueName = VENUES.find((v) => v.slug === venueSlug)?.name ?? venueSlug;

    for (const scrapedSlot of venueSlots) {
      // Find existing slot in database
      const existing = await db.query.slots.findFirst({
        where: and(
          eq(slots.venueId, venueId),
          eq(slots.date, scrapedSlot.date),
          eq(slots.time, scrapedSlot.time),
          eq(slots.court, scrapedSlot.court)
        ),
      });

      const oldStatus = existing?.status ?? null;
      const newStatus = scrapedSlot.status;

      // Detect newly available slots (was booked/closed, now available)
      if (
        newStatus === "available" &&
        oldStatus !== null &&
        oldStatus !== "available"
      ) {
        changes.push({
          venue: venueSlug,
          venueName,
          date: scrapedSlot.date,
          time: scrapedSlot.time,
          court: scrapedSlot.court,
          oldStatus,
          newStatus,
          price: scrapedSlot.price,
        });
      }

      // Upsert the slot
      if (existing) {
        await db
          .update(slots)
          .set({
            status: newStatus,
            price: scrapedSlot.price,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(slots.id, existing.id));
      } else {
        await db.insert(slots).values({
          venueId,
          date: scrapedSlot.date,
          time: scrapedSlot.time,
          court: scrapedSlot.court,
          status: newStatus,
          price: scrapedSlot.price,
        });
      }
    }
  }

  return changes;
}

// Get current availability for a venue and date
export async function getAvailability(venueSlug: string, date: string) {
  const venue = await db.query.venues.findFirst({
    where: eq(venues.slug, venueSlug),
  });

  if (!venue) return [];

  return db.query.slots.findMany({
    where: and(eq(slots.venueId, venue.id), eq(slots.date, date)),
  });
}
