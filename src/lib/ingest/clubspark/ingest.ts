/**
 * ClubSpark ingestion (Phase 4) — the Newham / LTA source adapter.
 *
 * Unlike Courtside, ClubSpark is NOT an OpenActive RPDE change-feed: its
 * `GetVenueSessions` JSON endpoint returns a full day-by-day availability
 * snapshot on every call and is first-party authoritative (no stale
 * change-feed problem). So ClubSpark needs neither the RPDE cursor machinery
 * (Clock 1) nor the HTML staleness reconcile (Clock 2/3) — it is polled
 * directly on an interval, and its venues are correctly excluded from the
 * Courtside reconcile in `reconcile.ts`.
 *
 * `pollClubSpark` mirrors the shape of `pollSlots` (Clock 1): for each ClubSpark
 * venue it fetches the window, resolves the venue + its courts, SITE-WINS upserts
 * the snapshot into the feed-owned `slots` rows, and returns the
 * booked/closed/coaching → available transitions as `SlotChange`s for the caller
 * to notify:
 *
 *   const { changes } = await pollClubSpark({ persist: true });
 *   if (changes.length) await notifyUsers(changes);
 *
 * `persist` defaults FALSE (a read-only preview — detects would-be transitions,
 * writes nothing), matching the cutover gate on the other clocks. The FIRST
 * persisting run backfills every row from null → notifies nothing (the shared
 * `isNewlyAvailable` rule never fires on a null prior status); subsequent runs
 * notify on genuine flips.
 *
 * The fetch reuses the tested `scrapeClubSpark` (no proxy is used when the proxy
 * env is unconfigured — the intended mode for this sanctioned first-party API).
 */
import { db } from "../../db";
import { venues, courts, slots } from "../../schema";
import { and, eq } from "drizzle-orm";
import { scrapeClubSpark } from "../../scrapers/clubspark";
import { VENUES } from "../../constants";
import { isNewlyAvailable } from "../openactive/parse";
import type { SlotChange } from "../../differ";

export interface ClubSparkPollSummary {
  /** ClubSpark venues polled this run. */
  venues: number;
  /** slots returned by the source across all venues. */
  slotsScraped: number;
  /** court rows resolved or created for the polled venues. */
  courtsUpserted: number;
  /** rows written (0 unless persist). */
  slotsUpserted: number;
  /** booked/closed/coaching → available flips (candidates for notifyUsers). */
  transitions: number;
  errors: { venueSlug: string; error: string }[];
  changes: SlotChange[];
  persist: boolean;
}

/** The window of local dates ("YYYY-MM-DD") starting today, plus the start/end
 * bounds the ClubSpark endpoint is queried with (one call covers the range). */
function windowRange(windowDays: number, from = new Date()): { startDate: string; endDate: string; dates: Set<string> } {
  const dates = new Set<string>();
  let startDate = "";
  let endDate = "";
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    const s = d.toISOString().slice(0, 10);
    dates.add(s);
    if (i === 0) startDate = s;
    endDate = s;
  }
  return { startDate, endDate, dates };
}

/** Resolve the DB venue for a ClubSpark config, creating/enriching it when
 * persisting. Stamps `source_type='clubspark'` + `external_id` (the ClubSpark
 * venue id) so the reconcile keeps excluding it and the map can distinguish
 * operators. Never overwrites the curated name/slug. Returns null (skip) when the
 * venue doesn't exist yet on a non-persisting preview run. */
async function resolveClubSparkVenue(
  venue: { slug: string; name: string; clubsparkId?: string },
  persist: boolean
): Promise<{ id: number; name: string } | null> {
  const existing = await db
    .select({ id: venues.id, name: venues.name })
    .from(venues)
    .where(eq(venues.slug, venue.slug))
    .limit(1);

  const enrich = { sourceType: "clubspark", externalId: venue.clubsparkId ?? null, active: 1 };

  if (existing[0]) {
    if (persist) await db.update(venues).set(enrich).where(eq(venues.id, existing[0].id));
    return { id: existing[0].id, name: existing[0].name };
  }
  if (!persist) return null;
  const [ins] = await db
    .insert(venues)
    .values({ slug: venue.slug, name: venue.name, ...enrich })
    .returning({ id: venues.id, name: venues.name });
  return { id: ins.id, name: ins.name };
}

/** Ensure a `courts` row exists per scraped court name and return name → courtId.
 * ClubSpark exposes stable court names ("Court 1"), so identity is keyed by a
 * synthesized `external_id` (`clubspark:<venueId>:<name>`) — this gives Newham
 * per-court identity consistent with Courtside without touching the tested
 * scraper. On a preview (!persist) missing courts resolve to null (slots still
 * upsert by label at the cutover, courtId backfills on the first persisting run). */
async function ensureClubSparkCourts(
  venueId: number,
  courtNames: string[],
  persist: boolean
): Promise<Map<string, number | null>> {
  const existing = await db
    .select({ id: courts.id, externalId: courts.externalId })
    .from(courts)
    .where(eq(courts.venueId, venueId));
  const byExt = new Map(existing.filter((c) => c.externalId).map((c) => [c.externalId as string, c.id]));

  const out = new Map<string, number | null>();
  for (const name of courtNames) {
    const ext = `clubspark:${venueId}:${name}`;
    let id = byExt.get(ext) ?? null;
    if (id == null && persist) {
      const [ins] = await db.insert(courts).values({ venueId, externalId: ext, name }).returning({ id: courts.id });
      id = ins.id;
      byExt.set(ext, id);
    }
    out.set(name, id);
  }
  return out;
}

/** Site-wins upsert of one ClubSpark slot into the feed-owned row, keyed by the
 * legacy (venue,date,time,court) unique. ClubSpark carries no RPDE metadata
 * (starts_at/remaining_uses), so only status/price/courtId are written — the
 * columns are nullable and time is normalized end-to-end in Phase 6. */
async function upsertClubSparkSlot(
  venueId: number,
  s: { date: string; time: string; court: string; status: string; price?: string },
  courtId: number | null
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(slots)
    .values({
      venueId,
      date: s.date,
      time: s.time,
      court: s.court,
      status: s.status,
      price: s.price ?? null,
      courtId: courtId ?? undefined,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [slots.venueId, slots.date, slots.time, slots.court],
      set: { status: s.status, price: s.price ?? null, courtId: courtId ?? undefined, updatedAt: now },
    });
}

/**
 * Poll every ClubSpark venue and (optionally) persist its availability snapshot,
 * returning booked/closed/coaching → available transitions to notify on.
 * Per-venue fetch/parse failures are isolated (collected in `errors`) so one dead
 * venue never sinks the run. See the module doc for the `persist` cutover gate.
 */
export async function pollClubSpark(
  opts: { persist?: boolean; windowDays?: number } = {}
): Promise<ClubSparkPollSummary> {
  const persist = opts.persist ?? false;
  const windowDays = opts.windowDays ?? parseInt(process.env.SCRAPE_DAYS || "8", 10);
  const { startDate, endDate, dates } = windowRange(windowDays);

  const clubsparkVenues = VENUES.filter((v) => v.type === "clubspark");

  const changes: SlotChange[] = [];
  const errors: { venueSlug: string; error: string }[] = [];
  let slotsScraped = 0;
  let courtsUpserted = 0;
  let slotsUpserted = 0;
  let transitions = 0;
  let venuesPolled = 0;

  for (const cfg of clubsparkVenues) {
    try {
      const resolved = await resolveClubSparkVenue(cfg, persist);
      if (!resolved) continue; // preview + venue not seeded yet → skip

      const scraped = (await scrapeClubSpark(cfg, startDate, endDate)).filter((s) => dates.has(s.date));
      venuesPolled++;
      slotsScraped += scraped.length;

      const courtIdByName = await ensureClubSparkCourts(
        resolved.id,
        [...new Set(scraped.map((s) => s.court))],
        persist
      );
      courtsUpserted += courtIdByName.size;

      for (const s of scraped) {
        const courtId = courtIdByName.get(s.court) ?? null;

        const existing = await db.query.slots.findFirst({
          where: and(
            eq(slots.venueId, resolved.id),
            eq(slots.date, s.date),
            eq(slots.time, s.time),
            eq(slots.court, s.court)
          ),
        });
        const oldStatus = existing?.status ?? null;

        if (isNewlyAvailable(oldStatus, s.status)) {
          transitions++;
          changes.push({
            venue: cfg.slug,
            venueName: resolved.name,
            date: s.date,
            time: s.time,
            court: s.court,
            oldStatus,
            newStatus: s.status,
            price: s.price,
          });
        }

        if (persist) {
          await upsertClubSparkSlot(resolved.id, s, courtId);
          slotsUpserted++;
        }
      }
    } catch (e) {
      errors.push({ venueSlug: cfg.slug, error: (e as Error).message });
    }
  }

  return {
    venues: venuesPolled,
    slotsScraped,
    courtsUpserted,
    slotsUpserted,
    transitions,
    errors,
    changes,
    persist,
  };
}
