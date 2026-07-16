/**
 * Clock 3 smoke test: run `fullSweep` READ-ONLY against the configured DB. Scrapes
 * EVERY active Courtside venue-day across the window (real HTTP requests) but
 * writes nothing to `slots`, advances no cursor, and fires no notification.
 *
 * Same pre-cutover caveat as the other clock previews: until the feed owns `slots`
 * the scraper's rows are keyed "Tennis court N" while this looks up "Court N", so
 * every prior status is null and `transitions` reads 0. This preview exercises the
 * full-sweep scope + scrape path; the transition signal is real only post-cutover.
 *
 * Read-only. Run: npx tsx scripts/sweep-preview.ts
 */
import "dotenv/config";
import { fullSweep } from "../src/lib/ingest/reconcile";

async function main() {
  console.log("Running fullSweep({ persist: false }) — read-only preview…\n");
  const r = await fullSweep({ persist: false });

  console.log("================ CLOCK 3 — DAILY FULL SWEEP (preview) ================");
  console.log(`Window:            ${r.windowDays} days`);
  console.log(`Venue-days:        ${r.venueDays}  (all active Courtside venues × window)`);
  console.log(`Slots scraped:     ${r.slotsScraped}`);
  console.log(`Would upsert:      ${r.upserted}  (0 in preview mode)`);
  console.log(`Transitions:       ${r.transitions}  (booked/closed → available; 0 pre-cutover — see note)`);

  if (r.errors.length) {
    console.log(`\n⚠️  ${r.errors.length} venue-day scrape error(s):`);
    for (const e of r.errors.slice(0, 20)) console.log(`  ${e.venueSlug} | ${e.date}: ${e.error}`);
  }

  if (r.changes.length) {
    console.log(`\nWould notify on ${r.changes.length} transition(s):`);
    for (const c of r.changes.slice(0, 25)) {
      console.log(`  ${c.venue} | ${c.date} | ${c.time} | ${c.court}  ${c.oldStatus} → ${c.newStatus}${c.price ? `  £${c.price}` : ""}`);
    }
    if (r.changes.length > 25) console.log(`  … and ${r.changes.length - 25} more`);
  } else if (r.venueDays > 0) {
    console.log(`\nNo transitions surfaced (expected pre-cutover — the feed doesn't own \`slots\` yet).`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
