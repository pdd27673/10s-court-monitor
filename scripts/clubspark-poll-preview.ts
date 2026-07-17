/**
 * ClubSpark (Newham) smoke test: run `pollClubSpark` READ-ONLY against the
 * configured DB.
 *
 * Prints what a ClubSpark poll would do — venues polled, slots seen, courts it
 * would create, and the booked/closed/coaching→available transitions it would
 * notify on — without writing to `slots`/`courts` or enriching venues.
 *
 * Note: like the other clocks, `persist` defaults FALSE and the transition signal
 * is only meaningful once the feed owns `slots` (post-cutover). A ClubSpark venue
 * that isn't seeded in the DB yet is skipped on this preview (it would be created
 * on the first persisting run).
 *
 * Read-only. Run: npx tsx scripts/clubspark-poll-preview.ts
 */
import "dotenv/config";
import { pollClubSpark } from "../src/lib/ingest/clubspark/ingest";

async function main() {
  console.log("Running pollClubSpark({ persist: false }) — read-only preview…\n");
  const r = await pollClubSpark({ persist: false });

  console.log("================ CLUBSPARK (NEWHAM) POLL (preview) ================");
  console.log(`Venues polled:     ${r.venues}`);
  console.log(`Slots scraped:     ${r.slotsScraped}`);
  console.log(`Courts resolved:   ${r.courtsUpserted}  (created on the first persisting run)`);
  console.log(`Would upsert:      ${r.slotsUpserted}  (0 in preview mode)`);
  console.log(`Transitions:       ${r.transitions}  (booked/closed/coaching → available)`);

  if (r.venues === 0) {
    console.log(`\n⚠️  0 venues polled — are the ClubSpark venues seeded in the DB? A preview skips unseeded venues.`);
  }
  if (r.errors.length) {
    console.log(`\nErrors (${r.errors.length}):`);
    for (const e of r.errors) console.log(`  ${e.venueSlug}: ${e.error}`);
  }
  if (r.changes.length) {
    console.log(`\nWould notify on ${r.changes.length} transition(s):`);
    for (const c of r.changes.slice(0, 25)) {
      console.log(`  ${c.venue} | ${c.date} | ${c.time} | ${c.court}  ${c.oldStatus} → ${c.newStatus}${c.price ? `  ${c.price}` : ""}`);
    }
    if (r.changes.length > 25) console.log(`  … and ${r.changes.length - 25} more`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
