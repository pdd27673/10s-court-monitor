/**
 * Clock 1 smoke test: run `pollSlots` READ-ONLY against the configured DB.
 *
 * Prints what a feed head-poll would do — pages walked, resolution rate, and the
 * booked/closed→available transitions it would notify on — without writing to
 * `slots` or advancing the saved cursor.
 *
 * Prereq: `courts` must be populated (run `ingestFacilities()` first), otherwise
 * every slot is `unresolved`. Until the Phase 3 cutover the `slots` table is
 * still owned by the HTML scraper, so the `transitions` here compare feed status
 * against scraper-written rows (cross-source) and are only a sanity check, not
 * the real Clock-1 signal — that becomes meaningful once the feed owns `slots`.
 *
 * Read-only. Run: npx tsx scripts/poll-slots-preview.ts
 */
import "dotenv/config";
import { pollSlots } from "../src/lib/ingest/openactive/ingest";

async function main() {
  console.log("Running pollSlots({ persist: false }) — read-only preview…\n");
  const r = await pollSlots({ persist: false });

  console.log("================ CLOCK 1 — FEED HEAD-POLL (preview) ================");
  console.log(`Started from:      ${r.startedFromHead ? "saved head cursor (delta)" : "page 1 (full backfill — no saved cursor yet)"}`);
  console.log(`Pages walked:      ${r.pages}`);
  console.log(`Updated items:     ${r.updated}`);
  console.log(`Deleted items:     ${r.deleted}  (counted only; see pollSlots note)`);
  console.log(`Resolved to court: ${r.resolved}`);
  console.log(`Unresolved:        ${r.unresolved}  (court not in DB / not London / unparseable)`);
  console.log(`Would upsert:      ${r.slotsUpserted}  (0 in preview mode)`);
  console.log(`Transitions:       ${r.transitions}  (booked/closed → available)`);
  console.log(`Next cursor:       ${r.cursor}`);

  if (r.resolved === 0) {
    console.log(`\n⚠️  0 resolved — is the 'courts' table populated? Run ingestFacilities() first.`);
  }

  if (r.changes.length) {
    console.log(`\nWould notify on ${r.changes.length} transition(s):`);
    for (const c of r.changes.slice(0, 25)) {
      console.log(`  ${c.venue} | ${c.date} | ${c.time} | ${c.court}  ${c.oldStatus} → ${c.newStatus}${c.price ? `  £${c.price}` : ""}`);
    }
    if (r.changes.length > 25) console.log(`  … and ${r.changes.length - 25} more`);
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
