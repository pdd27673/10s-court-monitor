/**
 * Clock 2 budget sizer: compute the reconcile pending set from LIVE watches and
 * print how many HTML pages one reconcile run would scrape. Read-only.
 *
 * This is the number that decides whether the watch-targeted reconcile is cheap
 * enough: `venueDays` = HTML pages per run; × runs/day (e.g. 96 at 15-min cadence)
 * is the daily budget to compare against today's ~2,400 blind scrapes/day.
 *
 * Run: npx tsx scripts/reconcile-preview.ts
 */
import "dotenv/config";
import { computePendingSet } from "../src/lib/ingest/reconcile";

async function main() {
  const p = await computePendingSet();

  console.log("================ CLOCK 2 — RECONCILE PENDING SET ================");
  console.log(`Window:            ${p.windowDays} days`);
  console.log(`Active watches:    ${p.activeWatches}`);
  console.log(`Candidate slots:   ${p.candidateSlots}  (watched venue/date/time across the window)`);
  console.log(`Pending slots:     ${p.pendingSlots}  (currently no available court → worth cross-checking)`);
  console.log(`Venue-days to scrape (HTML budget / run): ${p.venueDays.length}`);
  console.log(`  → at 15-min cadence that's ~${p.venueDays.length * 96} pages/day (vs ~2,400 blind today)`);

  if (p.venueDays.length) {
    console.log(`\nPending venue-days:`);
    for (const vd of p.venueDays.slice(0, 40)) {
      console.log(`  ${vd.venueSlug} | ${vd.date}  (${vd.pendingTimes.length} unmet time(s): ${vd.pendingTimes.join(", ")})`);
    }
    if (p.venueDays.length > 40) console.log(`  … and ${p.venueDays.length - 40} more`);
  } else {
    console.log(`\nNothing pending — every watched slot already shows available in the DB.`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
