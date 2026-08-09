/**
 * Clock 2b smoke test: run `reconcileWatchedVenueDays` READ-ONLY against the
 * configured DB. Actually scrapes the bounded, least-recently-checked subset of
 * pending Courtside venue-days (so it makes real HTTP requests) but writes
 * nothing to `slots`, advances no round-robin cursor, and fires no notification.
 *
 * Prints the site-wins transitions it WOULD notify on. Note (same caveat as
 * `poll-slots-preview.ts`): until the Phase 3 cutover the HTML scraper still owns
 * `slots` under "Tennis court N" labels, while this looks up "Court N" rows — so
 * pre-cutover every prior status is null and `transitions` reads 0. This preview
 * is for exercising target selection + the scrape/canonicalise path; the
 * transition signal only becomes real once the feed owns `slots`.
 *
 * Read-only. Run: npx tsx scripts/reconcile-run-preview.ts
 */
import "dotenv/config";
import { reconcileWatchedVenueDays } from "../src/lib/ingest/reconcile";

async function main() {
  console.log("Running reconcileWatchedVenueDays({ persist: false }) — read-only preview…\n");
  const r = await reconcileWatchedVenueDays({ persist: false });

  console.log("================ CLOCK 2b — WATCH-TARGETED RECONCILE (preview) ================");
  console.log(`Window:                 ${r.windowDays} days`);
  console.log(`Pending venue-days:     ${r.pendingVenueDays}  (Courtside, currently no available court)`);
  console.log(`Max pages / run:        ${r.maxPages}  (RECONCILE_MAX_PAGES)`);
  console.log(`Scraped this run:       ${r.scrapedVenueDays}  (bounded, least-recently-checked)`);
  console.log(`Slots scraped:          ${r.slotsScraped}`);
  console.log(`Would upsert:           ${r.upserted}  (0 in preview mode)`);
  console.log(`Transitions:            ${r.transitions}  (booked/closed → available; 0 pre-cutover — see note)`);

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
  } else if (r.scrapedVenueDays > 0) {
    console.log(`\nNo transitions surfaced (expected pre-cutover — the feed doesn't own \`slots\` yet).`);
  } else {
    console.log(`\nNothing to reconcile — no pending Courtside venue-days this run.`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
