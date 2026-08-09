#!/usr/bin/env tsx
/**
 * Phase 6 data migration: canonicalise `watches.day_times` values from legacy
 * am/pm labels ("7pm") to 24h "HH:MM" ("19:00").
 *
 * This is CLEANUP, not a correctness flag-day — matching already normalises both
 * formats to minute-of-day (`src/lib/time.ts`, `matchesWatch`, confirm-on-notify),
 * so watches keep firing correctly whether or not this has run. Running it just
 * makes stored data consistent with the canonical form the API now writes.
 *
 * Idempotent: rows already in HH:MM normalise to themselves and are left untouched
 * (only rows whose normalised JSON differs are written). Uses the exact same
 * `normalizeDayTimes` the watch APIs use, so storage and write-path never drift.
 *
 * Usage:
 *   DATABASE_URL=postgres://... tsx scripts/migrate-daytimes-to-hhmm.ts [--dry-run]
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { watches } from "../src/lib/schema";
import { eq, isNotNull } from "drizzle-orm";
import { normalizeDayTimes } from "../src/lib/time";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`Phase 6 dayTimes → HH:MM migration${DRY_RUN ? " (dry run)" : ""}\n`);

  const rows = await db
    .select({ id: watches.id, dayTimes: watches.dayTimes })
    .from(watches)
    .where(isNotNull(watches.dayTimes));

  console.log(`${rows.length} watch(es) with dayTimes to inspect.\n`);

  let changed = 0;
  let unchanged = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.dayTimes) continue;
    let parsed: Record<string, string[]>;
    try {
      parsed = JSON.parse(row.dayTimes) as Record<string, string[]>;
    } catch {
      console.warn(`  ⚠️  watch ${row.id}: dayTimes is not valid JSON — skipping`);
      skipped++;
      continue;
    }

    const normalized = normalizeDayTimes(parsed);
    const nextJson = normalized ? JSON.stringify(normalized) : null;

    // Compare against a re-stringify of the parsed original so key-order/whitespace
    // differences don't count as a change — only a real value change writes.
    const currentJson = JSON.stringify(parsed);
    if (nextJson === currentJson) {
      unchanged++;
      continue;
    }

    changed++;
    console.log(`  watch ${row.id}: ${currentJson}  →  ${nextJson}`);
    if (!DRY_RUN) {
      await db.update(watches).set({ dayTimes: nextJson }).where(eq(watches.id, row.id));
    }
  }

  console.log(
    `\n${DRY_RUN ? "Would update" : "Updated"} ${changed} watch(es); ` +
      `${unchanged} already canonical; ${skipped} skipped (bad JSON).`
  );
  if (DRY_RUN && changed > 0) console.log("Re-run without --dry-run to apply.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
