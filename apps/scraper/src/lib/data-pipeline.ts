import { sql } from 'drizzle-orm';
import { type Database, type ScrapingLogParams, courtSlots, scrapingLogs } from '@10s/database';
import { type ScrapedSlot } from '../types';
import { nanoid } from 'nanoid';
import crypto from 'crypto';

/**
 * Store court slot data using upsert with change detection
 * Returns only newly inserted slots for notification
 */
export async function storeCourtData(
  db: Database,
  slots: ScrapedSlot[]
): Promise<ScrapedSlot[]> {
  if (slots.length === 0) {
    return [];
  }

  try {
    // Prepare slot data for insertion
    const slotsToInsert = slots.map((slot) => {
      // Generate checksum for change detection
      const checksumData = `${slot.venueId}-${slot.courtName}-${slot.startTime.toISOString()}-${slot.price}`;
      const checksum = crypto.createHash('sha256').update(checksumData).digest('hex');

      return {
        id: nanoid(),
        venueId: slot.venueId,
        courtName: slot.courtName,
        startTime: slot.startTime,
        endTime: slot.endTime,
        price: slot.price.toString(),
        currency: slot.currency,
        bookingUrl: slot.bookingUrl,
        isAvailable: slot.isAvailable,
        checksum,
        scrapedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });

    // Upsert with conflict resolution on composite unique key
    // Use xmax = 0 to detect new inserts vs updates
    const result = await db
      .insert(courtSlots)
      .values(slotsToInsert)
      .onConflictDoUpdate({
        target: [courtSlots.venueId, courtSlots.courtName, courtSlots.startTime],
        set: {
          price: sql`EXCLUDED.price`,
          endTime: sql`EXCLUDED.end_time`,
          bookingUrl: sql`EXCLUDED.booking_url`,
          isAvailable: sql`EXCLUDED.is_available`,
          checksum: sql`EXCLUDED.checksum`,
          scrapedAt: sql`EXCLUDED.scraped_at`,
          updatedAt: sql`NOW()`,
        },
      })
      .returning({
        id: courtSlots.id,
        venueId: courtSlots.venueId,
        courtName: courtSlots.courtName,
        startTime: courtSlots.startTime,
        endTime: courtSlots.endTime,
        price: courtSlots.price,
        currency: courtSlots.currency,
        bookingUrl: courtSlots.bookingUrl,
        isAvailable: courtSlots.isAvailable,
        // Use xmax system column to detect inserts (xmax = 0 means INSERT, not UPDATE)
        isNew: sql<boolean>`xmax = 0`,
      });

    // Filter to only return newly inserted slots
    const newSlots = result
      .filter((row) => row.isNew)
      .map((row) => ({
        venueId: row.venueId,
        courtName: row.courtName,
        startTime: new Date(row.startTime),
        endTime: new Date(row.endTime),
        price: parseFloat(row.price),
        currency: row.currency,
        bookingUrl: row.bookingUrl,
        isAvailable: row.isAvailable,
      }));

    console.log(`💾 Stored ${slots.length} slots, ${newSlots.length} are new`);

    return newSlots;
  } catch (error) {
    console.error('❌ Failed to store court data:', error);
    throw error;
  }
}

/**
 * Log scraping activity to database
 */
export async function logScrapingRun(
  db: Database,
  params: ScrapingLogParams
): Promise<void> {
  try {
    const durationMs = params.endTime.getTime() - params.startTime.getTime();

    await db.insert(scrapingLogs).values({
      id: nanoid(),
      venueId: params.venueId,
      scraperType: params.scraperType,
      status: params.status,
      startTime: params.startTime,
      endTime: params.endTime,
      durationMs,
      slotsFound: params.slotsFound,
      slotsAdded: params.slotsAdded,
      slotsUpdated: params.slotsUpdated,
      errorMessage: params.errorMessage || null,
      errorStack: params.errorStack || null,
      metadata: null,
      createdAt: new Date(),
    });

    console.log(`📝 Logged scraping run for venue ${params.venueId}: ${params.status}`);
  } catch (error) {
    console.error('❌ Failed to log scraping run:', error);
    // Don't throw - logging failure shouldn't stop the scraping process
  }
}
