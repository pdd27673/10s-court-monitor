/**
 * Feed reliability audit: OpenActive feed vs the LIVE booking site.
 *
 * The booking site (tennistowerhamlets.com) is ground truth — it's what a user
 * actually books against. For every Greater London Courtside venue over the next
 * N days we scrape the live page with the SAME parser production uses
 * (`scrapeCourtside`) and diff it against the live feed, keyed by
 * (venue, date, hour, court number, tennis-only).
 *
 * Reports directional error rates:
 *   - FALSE NEGATIVE = site AVAILABLE but feed says TAKEN  → we'd miss a bookable
 *     court and never notify. The harmful direction.
 *   - FALSE POSITIVE = site TAKEN but feed says AVAILABLE  → a wasted alert.
 *
 * Read-only. Run: npx tsx scripts/feed-vs-site-audit.ts [days]
 */
import "dotenv/config";
import { scrapeCourtside } from "../src/lib/scrapers/courtside";
import { walkToHead, FEED_FACILITY_USES, FEED_SLOTS, type RpdeItem } from "../src/lib/ingest/openactive/client";
import {
  parseFacilityUse,
  parseSlot,
  isGreaterLondon,
  hourLabel,
  localDate,
  courtNumberFromName,
} from "../src/lib/ingest/openactive/parse";
import { isNonTennisName } from "../src/lib/non-tennis";

type Rec = Record<string, unknown>;

const isTennis = (name: string | null | undefined) => !isNonTennisName(name);

const DAYS = parseInt(process.argv[2] || "8", 10);
const key = (slug: string, date: string, hour: string, court: number | null) => `${slug}|${date}|${hour}|court${court ?? "?"}`;
const pairOf = (k: string) => k.split("|").slice(0, 2).join("|");

function nextDates(n: number): string[] {
  const out: string[] = [];
  const t = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(t);
    d.setDate(t.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const dates = nextDates(DAYS);
  console.log(`Auditing feed vs live site for ${DAYS} days: ${dates[0]} … ${dates[dates.length - 1]}\n`);

  // --- 1. Facility feed: London venues + tennis court refs ---
  console.log("Walking facility-uses…");
  const courtByRef = new Map<string, { slug: string; num: number | null }>();
  const feedCourtsPerVenue = new Map<string, number>();
  const slugs = new Set<string>();
  {
    const latest = new Map<string, RpdeItem<Rec>>();
    await walkToHead<Rec>(FEED_FACILITY_USES, (items) => {
      for (const it of items) { if (it.state === "deleted") latest.delete(String(it.id)); else latest.set(String(it.id), it); }
    }, { paceMs: 300 });
    for (const it of latest.values()) {
      const v = parseFacilityUse(it.data ?? {});
      if (!v || !isGreaterLondon(v.lat, v.lng)) continue;
      slugs.add(v.slug);
      let n = 0;
      for (const c of v.courts) {
        if (!isTennis(c.name)) continue;
        courtByRef.set(c.externalId, { slug: v.slug, num: courtNumberFromName(c.name) });
        n++;
      }
      feedCourtsPerVenue.set(v.slug, n);
    }
  }
  const slugList = [...slugs].sort();
  console.log(`  London venues: ${slugList.length} — ${slugList.join(", ")}`);

  // --- 2. Live site (production scraper) ---
  console.log(`\nScraping live site (${slugList.length} venues × ${DAYS} days = ${slugList.length * DAYS} pages)…`);
  const siteAvail = new Map<string, boolean>();
  const sitePairs = new Set<string>();
  const siteCourtsPerVenue = new Map<string, Set<number>>();
  for (const slug of slugList) {
    for (const date of dates) {
      try {
        const rows = await scrapeCourtside(slug, date);
        if (rows.length === 0) continue;
        sitePairs.add(`${slug}|${date}`);
        for (const r of rows) {
          const num = courtNumberFromName(r.court);
          siteAvail.set(key(slug, date, r.time, num), r.status === "available");
          if (!siteCourtsPerVenue.has(slug)) siteCourtsPerVenue.set(slug, new Set());
          if (num != null) siteCourtsPerVenue.get(slug)!.add(num);
        }
      } catch (e) {
        console.log(`  ! ${slug} ${date}: ${(e as Error).message}`);
      }
    }
  }
  console.log(`  site court-hours: ${siteAvail.size} across ${sitePairs.size} venue-days`);

  // --- 3. Feed slots ---
  console.log("\nWalking individual-facility-use-slots…");
  const feedAvail = new Map<string, boolean>();
  const feedMod = new Map<string, number>();
  const feedPairs = new Set<string>();
  {
    const latest = new Map<string, RpdeItem<Rec>>();
    const res = await walkToHead<Rec>(FEED_SLOTS, (items) => {
      for (const it of items) { if (it.state === "deleted") latest.delete(String(it.id)); else latest.set(String(it.id), it); }
    }, { paceMs: 300 });
    console.log(`  slot pages: ${res.pages}, live slots: ${latest.size}`);
    for (const it of latest.values()) {
      const s = parseSlot(it.data ?? {});
      if (!s) continue;
      const ref = courtByRef.get(s.courtExternalId);
      if (!ref) continue;
      const date = localDate(s.startsAt);
      if (!dates.includes(date)) continue;
      const hour = hourLabel(s.startsAt);
      if (!hour) continue;
      const k = key(ref.slug, date, hour, ref.num);
      feedAvail.set(k, s.remainingUses != null && s.remainingUses > 0);
      feedMod.set(k, it.modified);
      feedPairs.add(`${ref.slug}|${date}`);
    }
  }
  console.log(`  feed court-hours: ${feedAvail.size} across ${feedPairs.size} venue-days`);

  // --- 4. Compare over venue-days BOTH cover (site = ground truth) ---
  const shared = new Set([...sitePairs].filter((p) => feedPairs.has(p)));
  console.log(`\nShared venue-days: ${shared.size}`);

  let agree = 0, fn = 0, fp = 0, siteOnly = 0, feedOnly = 0, siteAvailCount = 0;
  const fnList: string[] = [], fpList: string[] = [], siteOnlyList: string[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const [k, sa] of siteAvail) {
    if (!shared.has(pairOf(k))) continue;
    if (sa) siteAvailCount++;
    if (!feedAvail.has(k)) { siteOnly++; if (siteOnlyList.length < 15) siteOnlyList.push(`${k} (site=${sa ? "avail" : "taken"})`); continue; }
    const fa = feedAvail.get(k)!;
    if (fa === sa) { agree++; continue; }
    const ageH = ((now - (feedMod.get(k) ?? now)) / 3600).toFixed(0);
    if (sa && !fa) { fn++; if (fnList.length < 25) fnList.push(`${k}  site=AVAIL feed=taken  (feed stale ${ageH}h)`); }
    else { fp++; if (fpList.length < 25) fpList.push(`${k}  site=taken feed=AVAIL  (feed stale ${ageH}h)`); }
  }
  for (const [k] of feedAvail) {
    if (!shared.has(pairOf(k))) continue;
    if (!siteAvail.has(k)) { feedOnly++; }
  }

  const compared = agree + fn + fp;
  const pct = (x: number) => compared ? ((x / compared) * 100).toFixed(2) + "%" : "n/a";
  console.log(`\n================ FEED RELIABILITY vs LIVE SITE ================`);
  console.log(`Court-hours compared:   ${compared}`);
  console.log(`Agreement:              ${agree}  (${pct(agree)})`);
  console.log(`FALSE NEGATIVES:        ${fn}  (${pct(fn)})   site AVAIL, feed taken — MISSED bookable court`);
  console.log(`False positives:        ${fp}  (${pct(fp)})   site taken, feed AVAIL — wasted alert`);
  console.log(`Total disagreement:     ${fn + fp}  (${pct(fn + fp)})`);
  const fnOfAvail = siteAvailCount ? ((fn / siteAvailCount) * 100).toFixed(2) + "%" : "n/a";
  console.log(`\nMiss rate on availability: ${fn}/${siteAvailCount} genuinely-available court-hours = ${fnOfAvail}`);
  console.log(`  (this is the product-relevant denominator: of all bookable slots, how many the feed hides)`);
  console.log(`\nCoverage gaps (not counted as errors):`);
  console.log(`  site-only court-hours: ${siteOnly}  (site has a court-hour the feed omits)`);
  console.log(`  feed-only court-hours: ${feedOnly}  (feed has a court-hour the site omits)`);

  console.log(`\nPer-venue court counts (feed tennis courts / site tennis courts seen):`);
  for (const slug of slugList) {
    console.log(`  ${slug}: feed=${feedCourtsPerVenue.get(slug) ?? 0}  site=${siteCourtsPerVenue.get(slug)?.size ?? 0}`);
  }

  if (fnList.length) { console.log(`\nFalse negatives (up to 25 of ${fn}):`); for (const m of fnList) console.log("  " + m); }
  if (fpList.length) { console.log(`\nFalse positives (up to 25 of ${fp}):`); for (const m of fpList) console.log("  " + m); }
  if (siteOnlyList.length) { console.log(`\nSite-only sample (up to 15 of ${siteOnly}):`); for (const m of siteOnlyList) console.log("  " + m); }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
