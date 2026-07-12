#!/usr/bin/env tsx
/**
 * Phase 1 seed: enrich existing venue rows with the new metadata columns
 * (operator, source_type, booking_url_template, active) from the VENUES config.
 *
 * Idempotent — matches venues by slug and only sets the new columns. Geo
 * (lat/lng), address, postcode, external_id, and amenities are intentionally
 * left for the Phase 2 OpenActive adapter, which gets them authoritatively from
 * the facility-uses feed.
 *
 * Usage:  DATABASE_URL=postgres://... tsx scripts/seed-venue-metadata.ts [--dry-run]
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { venues } from "../src/lib/schema";
import { eq } from "drizzle-orm";
import { VENUES } from "../src/lib/constants";

const DRY_RUN = process.argv.includes("--dry-run");

// A booking deep-link template. `{date}` is a placeholder consumers substitute
// (YYYY-MM-DD); the venue slug / clubspark id is already baked in per venue.
function bookingUrlTemplate(v: (typeof VENUES)[number]): string {
  if (v.type === "clubspark" && v.clubsparkHost && v.clubsparkId) {
    const base =
      v.clubsparkHost === "clubspark.lta.org.uk"
        ? `https://${v.clubsparkHost}/${v.clubsparkId}/Booking/BookByDate`
        : `https://${v.clubsparkHost}/Booking/BookByDate`;
    return `${base}#?date={date}&role=guest`;
  }
  // Courtside (Tower Hamlets)
  return `https://tennistowerhamlets.com/book/courts/${v.slug}/{date}`;
}

const OPERATOR: Record<string, string> = {
  courtside: "Tower Hamlets",
  clubspark: "Newham",
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  console.log(`Seeding venue metadata${DRY_RUN ? " (dry run)" : ""} for ${VENUES.length} venues\n`);

  let updated = 0;
  for (const v of VENUES) {
    const patch = {
      operator: OPERATOR[v.type] ?? null,
      sourceType: v.type,
      bookingUrlTemplate: bookingUrlTemplate(v),
      active: 1,
    };
    console.log(`• ${v.slug.padEnd(22)} source=${patch.sourceType} operator=${patch.operator}`);
    console.log(`    booking: ${patch.bookingUrlTemplate}`);
    if (!DRY_RUN) {
      const res = await db.update(venues).set(patch).where(eq(venues.slug, v.slug)).returning({ id: venues.id });
      if (res.length === 0) console.warn(`    ⚠️  no venue row with slug "${v.slug}" — skipped (run the scraper once to create it)`);
      else updated += res.length;
    }
  }

  console.log(`\n${DRY_RUN ? "Dry run complete (no writes)." : `✅ Updated ${updated}/${VENUES.length} venue rows.`}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
