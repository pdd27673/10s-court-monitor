/**
 * Phase 2 parity gate: OpenActive RPDE feed vs the HTML scraper.
 *
 * Walks BOTH OpenActive feeds in memory (no DB writes, no dependency on the
 * `courts` table being populated), derives per-court-hour availability for the
 * Greater London venues, and compares it against what the HTML scraper has
 * already written to the `slots` table. A high agreement rate on the
 * (venue, date) pairs both sources cover is the green light for Phase 3
 * (deleting the scraper and letting the feed own `slots`).
 *
 * Read-only. Run: npx tsx scripts/parity-openactive.ts
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { slots, venues } from "../src/lib/schema";
import { inArray } from "drizzle-orm";
import { walkToHead, FEED_FACILITY_USES, FEED_SLOTS, type RpdeItem } from "../src/lib/ingest/openactive/client";
import {
  parseFacilityUse,
  parseSlot,
  isGreaterLondon,
  hourLabel,
  localDate,
  courtNumberFromName,
} from "../src/lib/ingest/openactive/parse";

type Rec = Record<string, unknown>;

interface CourtRef {
  slug: string;
  courtNumber: number | null;
}

const key = (slug: string, date: string, time: string, court: number | null) =>
  `${slug}|${date}|${time}|court${court ?? "?"}`;

async function main() {
  const paceMs = 300;

  // --- 1. Facilities: build court-ref index for London venues ---
  console.log("Walking facility-uses to map London courts…");
  const courtByRef = new Map<string, CourtRef>();
  const londonSlugs = new Set<string>();
  {
    const latest = new Map<string, RpdeItem<Rec>>();
    await walkToHead<Rec>(FEED_FACILITY_USES, (items) => {
      for (const it of items) {
        if (it.state === "deleted") latest.delete(String(it.id));
        else latest.set(String(it.id), it);
      }
    }, { paceMs });
    for (const it of latest.values()) {
      const v = parseFacilityUse(it.data ?? {});
      if (!v || !isGreaterLondon(v.lat, v.lng)) continue;
      londonSlugs.add(v.slug);
      for (const c of v.courts) {
        courtByRef.set(c.externalId, { slug: v.slug, courtNumber: courtNumberFromName(c.name) });
      }
    }
  }
  console.log(`  London venues: ${londonSlugs.size} (${[...londonSlugs].join(", ")}), courts: ${courtByRef.size}`);

  // --- 2. Slots: derive feed availability per court-hour ---
  console.log("Walking individual-facility-use-slots (this is the long one)…");
  const feedAvail = new Map<string, boolean>(); // key -> available
  const feedPairs = new Set<string>(); // `${slug}|${date}` the feed covers
  {
    const latest = new Map<string, RpdeItem<Rec>>();
    let deleted = 0;
    const res = await walkToHead<Rec>(FEED_SLOTS, (items) => {
      for (const it of items) {
        if (it.state === "deleted") { deleted++; latest.delete(String(it.id)); }
        else latest.set(String(it.id), it);
      }
    }, { paceMs });
    console.log(`  slot pages: ${res.pages}, live slots: ${latest.size}, deletes seen: ${deleted}`);
    for (const it of latest.values()) {
      const s = parseSlot(it.data ?? {});
      if (!s) continue;
      const ref = courtByRef.get(s.courtExternalId);
      if (!ref) continue; // not a London court
      const date = localDate(s.startsAt);
      const time = hourLabel(s.startsAt);
      if (!time) continue;
      const available = s.remainingUses != null && s.remainingUses > 0;
      feedAvail.set(key(ref.slug, date, time, ref.courtNumber), available);
      feedPairs.add(`${ref.slug}|${date}`);
    }
  }
  console.log(`  feed court-hours: ${feedAvail.size} across ${feedPairs.size} venue-days`);

  // --- 3. Scraper rows from the DB for those London venues ---
  const slugList = [...londonSlugs];
  const vrows = await db.select({ id: venues.id, slug: venues.slug }).from(venues).where(inArray(venues.slug, slugList));
  const slugById = new Map(vrows.map((v) => [v.id, v.slug]));
  const srows = await db
    .select({ venueId: slots.venueId, date: slots.date, time: slots.time, court: slots.court, status: slots.status })
    .from(slots)
    .where(inArray(slots.venueId, vrows.map((v) => v.id)));

  const scrapeAvail = new Map<string, boolean>();
  const scrapePairs = new Set<string>();
  for (const r of srows) {
    const slug = slugById.get(r.venueId);
    if (!slug) continue;
    const n = courtNumberFromName(r.court);
    scrapeAvail.set(key(slug, r.date, r.time, n), r.status === "available");
    scrapePairs.add(`${slug}|${r.date}`);
  }
  console.log(`  scraper court-hours: ${scrapeAvail.size} across ${scrapePairs.size} venue-days`);

  // --- 4. Compare over the venue-days BOTH cover ---
  const sharedPairs = [...feedPairs].filter((p) => scrapePairs.has(p));
  console.log(`\nShared venue-days: ${sharedPairs.length}`);
  const shared = new Set(sharedPairs);
  const pairOf = (k: string) => k.split("|").slice(0, 2).join("|");

  let agree = 0, disagree = 0, feedOnly = 0, scrapeOnly = 0;
  const disagreements: string[] = [];
  const feedOnlySamples: string[] = [];
  const scrapeOnlySamples: string[] = [];

  for (const [k, fa] of feedAvail) {
    if (!shared.has(pairOf(k))) continue;
    if (!scrapeAvail.has(k)) { feedOnly++; if (feedOnlySamples.length < 10) feedOnlySamples.push(`${k} (feed=${fa ? "avail" : "taken"})`); continue; }
    if (scrapeAvail.get(k) === fa) agree++;
    else { disagree++; disagreements.push(`${k}  feed=${fa ? "avail" : "taken"}  scraper=${scrapeAvail.get(k) ? "avail" : "taken"}`); }
  }
  for (const [k] of scrapeAvail) {
    if (!shared.has(pairOf(k))) continue;
    if (!feedAvail.has(k)) { scrapeOnly++; if (scrapeOnlySamples.length < 10) scrapeOnlySamples.push(k); }
  }

  const compared = agree + disagree;
  const rate = compared ? ((agree / compared) * 100).toFixed(1) : "n/a";
  console.log(`\n=== PARITY (shared venue-days) ===`);
  console.log(`Availability agreement: ${agree}/${compared} = ${rate}%`);
  console.log(`Disagreements:          ${disagree}   (same court-hour, opposite availability — freshness skew or bug)`);
  console.log(`Feed-only court-hours:  ${feedOnly}   (feed sees a court-hour the scraper doesn't)`);
  console.log(`Scraper-only court-hrs: ${scrapeOnly}   (scraper has a court-hour absent from feed)`);

  console.log(`\nALL disagreements (${disagreements.length}):`);
  for (const m of disagreements) console.log("  " + m);
  console.log(`\nFeed-only sample (${Math.min(10, feedOnly)} of ${feedOnly}):`);
  for (const m of feedOnlySamples) console.log("  " + m);
  console.log(`\nScraper-only sample (${Math.min(10, scrapeOnly)} of ${scrapeOnly}):`);
  for (const m of scrapeOnlySamples) console.log("  " + m);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
