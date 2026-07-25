/**
 * DB ingest for the OpenActive feeds.
 *
 * `ingestFacilities` walks facility-uses and upserts London venues + their
 * courts, and persists the feed cursor. It is SAFE to run alongside the existing
 * scrapers: it only enriches venue metadata (geo/address/amenities/external_id)
 * and fills the new `courts` table — it does not touch the `slots` table, so the
 * scraper's availability data is untouched until the Phase 3 cutover.
 *
 * Existing venues are matched by slug (parse maps known Tower Hamlets facilities
 * to their existing slugs), so no duplicates are created; curated fields
 * (name, slug, operator, booking_url_template) are preserved.
 *
 * Non-tennis courts (padel …) at a tracked venue are SEEDED with
 * `courts.non_tennis = 1` rather than dropped. Dropping them made their slots
 * look identical to a tennis court we'd failed to seed, so a deliberate
 * exclusion raised the same "unmapped court" alarm as a real ingest gap. Seeded
 * and flagged, they resolve normally and are counted `excludedNonTennis`, while
 * every write path checks the flag so they never yield a slot row or a
 * notification.
 */
import { db } from "../../db";
import { venues, courts, slots, feedState } from "../../schema";
import { and, eq } from "drizzle-orm";
import { minutesFromIso } from "../../time";
import { collectLatest, FEED_FACILITY_USES, FEED_SLOTS } from "./client";
import { upsertFeedState } from "../feed-state";
import { detectSlotTransition } from "../slot-write";
import type { SlotChange } from "../../differ";
import {
  parseFacilityUse,
  parseSlot,
  isGreaterLondon,
  hourLabel,
  localDate,
  courtNumberFromName,
  facilityIdFromRef,
  feedSlotStatus,
  type ParsedVenue,
  type ParsedSlot,
} from "./parse";

/** The RPDE slots feed name, as stored in `feed_state.feed`. */
const SLOT_FEED = "individual-facility-use-slots";

/**
 * Why an updated slot didn't resolve to one of our courts. The slots feed is
 * Premier Tennis *national*, but we only seed London venues, so most deltas are
 * for courts we deliberately don't track. Splitting the count keeps the benign
 * misses ("foreign": another operator/region; "excludedNonTennis": a padel/other
 * court at a venue we do track, seeded-but-flagged precisely so it lands here)
 * distinct from a real seeding gap ("unmappedCourt": a venue we DO track whose
 * specific court @id isn't in `courts`) — the latter is the only one worth an
 * alert, and the only one `pollSlots` tries to heal-and-retry.
 */
export interface UnresolvedBreakdown {
  /** court's parent facility isn't one we track — other operator/region (expected). */
  foreign: number;
  /** parent facility IS tracked but this court @id isn't seeded (real gap → check facility ingest). */
  unmappedCourt: number;
  /** court resolved but is flagged non-tennis — deliberately excluded, not a gap. */
  excludedNonTennis: number;
  /** couldn't derive an hour label from the slot's startDate. */
  noTime: number;
  /** slot payload was missing @id / facilityUse / startDate. */
  badData: number;
}

const newBreakdown = (): UnresolvedBreakdown => ({
  foreign: 0,
  unmappedCourt: 0,
  excludedNonTennis: 0,
  noTime: 0,
  badData: 0,
});

/** The set of parent facility ids we have at least one seeded court for, derived
 * from the court index (`facilityIdFromRef` of each court's external_id). Lets an
 * unresolved slot be classed as a tracked-venue gap vs national-feed noise. */
function trackedFacilityIds(courtIndex: Map<string, CourtRef>): Set<string> {
  const s = new Set<string>();
  for (const key of courtIndex.keys()) {
    const fid = facilityIdFromRef(key);
    if (fid) s.add(fid);
  }
  return s;
}

/** Bucket a court-not-found slot: parent facility we track (court missing → real
 * gap) vs a facility we don't track at all (benign national-feed noise). */
function unresolvedReason(courtExternalId: string, tracked: Set<string>): "unmappedCourt" | "foreign" {
  const fid = facilityIdFromRef(courtExternalId);
  return fid && tracked.has(fid) ? "unmappedCourt" : "foreign";
}

export interface IngestSummary {
  pages: number;
  itemsSeen: number;
  londonVenues: number;
  venuesInserted: number;
  venuesUpdated: number;
  courtsUpserted: number;
  cursor: string;
  dryRun: boolean;
}

async function upsertVenue(v: ParsedVenue, dryRun: boolean): Promise<{ id: number | null; inserted: boolean }> {
  // Enrichment only — never overwrite curated name/slug/operator/booking template.
  const enrich = {
    externalId: v.externalId,
    sourceType: "courtside",
    address: v.address,
    postcode: v.postcode,
    amenities: v.amenities ?? undefined,
    lat: v.lat ?? undefined,
    lng: v.lng ?? undefined,
    active: 1,
  };
  if (dryRun) {
    const existing = await db.select({ id: venues.id }).from(venues).where(eq(venues.slug, v.slug)).limit(1);
    return { id: existing[0]?.id ?? null, inserted: existing.length === 0 };
  }
  const updated = await db.update(venues).set(enrich).where(eq(venues.slug, v.slug)).returning({ id: venues.id });
  if (updated.length > 0) return { id: updated[0].id, inserted: false };
  const inserted = await db
    .insert(venues)
    .values({ slug: v.slug, name: v.name, ...enrich })
    .returning({ id: venues.id });
  return { id: inserted[0]?.id ?? null, inserted: true };
}

async function upsertCourts(venueId: number, v: ParsedVenue, dryRun: boolean): Promise<number> {
  let n = 0;
  for (const c of v.courts) {
    if (dryRun) { n++; continue; }
    // Write the non-tennis flag on BOTH paths: the update path retroactively
    // re-flags padel courts seeded before the guard existed (and un-flags one
    // that was renamed), so the flag always tracks the feed's current naming.
    const updated = await db
      .update(courts)
      .set({ name: c.name, nonTennis: c.nonTennis ? 1 : 0 })
      .where(and(eq(courts.venueId, venueId), eq(courts.externalId, c.externalId)))
      .returning({ id: courts.id });
    if (updated.length === 0) {
      await db
        .insert(courts)
        .values({ venueId, externalId: c.externalId, name: c.name, nonTennis: c.nonTennis ? 1 : 0 });
    }
    n++;
  }
  return n;
}

export async function ingestFacilities(opts: { startCursor?: string; dryRun?: boolean; paceMs?: number } = {}): Promise<IngestSummary> {
  const dryRun = opts.dryRun ?? false;

  // Reduce the walk to the latest state per facility (updated wins; deleted drops).
  const { latest, walk } = await collectLatest<Record<string, unknown>>(
    opts.startCursor ?? FEED_FACILITY_USES,
    { paceMs: opts.paceMs ?? 350, label: "facility-uses" }
  );

  let londonVenues = 0;
  let venuesInserted = 0;
  let venuesUpdated = 0;
  let courtsUpserted = 0;

  for (const it of latest.values()) {
    const v = parseFacilityUse(it.data ?? {});
    if (!v || !isGreaterLondon(v.lat, v.lng)) continue;
    londonVenues++;
    const { id, inserted } = await upsertVenue(v, dryRun);
    if (inserted) venuesInserted++;
    else venuesUpdated++;
    if (id != null) courtsUpserted += await upsertCourts(id, v, dryRun);
  }

  if (!dryRun) {
    await upsertFeedState("openactive", "facility-uses", { nextCursor: walk.cursor });
  }

  return {
    pages: walk.pages,
    itemsSeen: walk.items,
    londonVenues,
    venuesInserted,
    venuesUpdated,
    courtsUpserted,
    cursor: walk.cursor,
    dryRun,
  };
}

// ============================================================================
// Slot ingestion
// ============================================================================

export interface SlotIngestSummary {
  pages: number;
  updated: number; // updated slot items seen across the walk
  deleted: number; // deleted slot items seen
  resolved: number; // updated slots whose court mapped to a known London court
  unresolved: number; // updated slots we couldn't place (court not in DB / not London)
  unresolvedBy: UnresolvedBreakdown; // why they didn't resolve (foreign vs real gap)
  slotsUpserted: number; // rows written (0 unless persist)
  cursor: string;
  persist: boolean;
}

interface CourtRef {
  courtId: number;
  venueId: number;
  venueSlug: string;
  venueName: string;
  courtName: string | null;
  courtNumber: number | null;
  /** seeded-but-excluded (padel, cricket nets …) — resolves, but never writes a slot. */
  nonTennis: boolean;
}

/** Load every known court keyed by its OpenActive `external_id`
 * (individual-facility-use @id) — the join key a slot's `facilityUse` points at.
 * Joins `venues` so the poller can build `SlotChange`s (which need venue slug +
 * name) without a second lookup.
 *
 * DO NOT filter out `non_tennis` courts here, however tempting: they are seeded
 * precisely so their slots RESOLVE and can be counted as `excludedNonTennis`.
 * Dropping them from the index makes those slots indistinguishable from a
 * tennis court we forgot to seed — they'd be re-counted as `unmappedCourt`,
 * firing the false ⚠️ (and now a pointless heal-and-retry) this flag exists to
 * kill. The exclusion is enforced at use-site via `CourtRef.nonTennis`. */
async function loadCourtIndex(): Promise<Map<string, CourtRef>> {
  const rows = await db
    .select({
      id: courts.id,
      venueId: courts.venueId,
      externalId: courts.externalId,
      name: courts.name,
      nonTennis: courts.nonTennis,
      venueSlug: venues.slug,
      venueName: venues.name,
    })
    .from(courts)
    .innerJoin(venues, eq(courts.venueId, venues.id));
  const idx = new Map<string, CourtRef>();
  for (const r of rows) {
    if (!r.externalId) continue;
    idx.set(r.externalId, {
      courtId: r.id,
      venueId: r.venueId,
      venueSlug: r.venueSlug,
      venueName: r.venueName,
      courtName: r.name,
      courtNumber: courtNumberFromName(r.name),
      nonTennis: r.nonTennis === 1,
    });
  }
  return idx;
}

/** Build the `slots` upsert values for one resolved feed slot. Shared by the
 * bulk backfill (`ingestSlots`) and the delta poller (`pollSlots`) so both write
 * identical rows (same court label, same status vocabulary). */
function slotRowValues(court: CourtRef, s: ParsedSlot, date: string, time: string) {
  const status = feedSlotStatus(s.remainingUses);
  const courtLabel = court.courtName ?? `Court ${court.courtNumber ?? "?"}`;
  return {
    status,
    courtLabel,
    values: {
      venueId: court.venueId,
      courtId: court.courtId,
      date,
      time,
      court: courtLabel,
      status,
      price: s.price != null ? String(s.price) : null,
      startsAt: new Date(s.startsAt),
      endsAt: s.endsAt ? new Date(s.endsAt) : null,
      startMinute: minutesFromIso(s.startsAt), // canonical minute-of-day (Phase 6)
      remainingUses: s.remainingUses,
      maxUses: s.maxUses,
      updatedAt: new Date().toISOString(),
    },
  };
}

type SlotRowValues = ReturnType<typeof slotRowValues>["values"];

/** Upsert one feed slot row, keyed by the legacy (venue,date,time,court) unique. */
async function upsertSlotRow(values: SlotRowValues): Promise<void> {
  await db
    .insert(slots)
    .values(values)
    .onConflictDoUpdate({
      target: [slots.venueId, slots.date, slots.time, slots.court],
      set: {
        status: values.status,
        price: values.price,
        courtId: values.courtId,
        startsAt: values.startsAt,
        endsAt: values.endsAt,
        startMinute: values.startMinute,
        remainingUses: values.remainingUses,
        maxUses: values.maxUses,
        updatedAt: values.updatedAt,
      },
    });
}

/**
 * Walk the `individual-facility-use-slots` feed and (optionally) persist slots
 * into the `slots` table, resolving each slot to a court via the `courts` table.
 *
 * `persist` defaults to FALSE. In Phase 2 the HTML scraper still owns the `slots`
 * table (it upserts by `venue_id,date,time,court` and prunes rows it didn't
 * scrape), so writing feed slots concurrently would fight the scraper. Run this
 * read-only to validate resolution; the parity script (`scripts/parity-openactive.ts`)
 * is the gate. Flip `persist` on at the Phase 3 cutover once the scraper is gone.
 *
 * Requires `courts` to be populated first (run `ingestFacilities()`); slots whose
 * court isn't in the index are counted as `unresolved` and skipped, as are slots
 * whose court IS indexed but flagged `non_tennis` (`excludedNonTennis`). Unlike
 * `pollSlots` this does NOT heal-and-retry unmapped courts: a backfill is
 * re-runnable and follows a facility ingest anyway, so a mid-walk re-seed would
 * only add churn.
 */
export async function ingestSlots(
  opts: { startCursor?: string; persist?: boolean; paceMs?: number; maxPages?: number } = {}
): Promise<SlotIngestSummary> {
  const persist = opts.persist ?? false;
  const courtIndex = await loadCourtIndex();
  const tracked = trackedFacilityIds(courtIndex);

  // Reduce the walk to the latest state per slot (updated wins; deleted drops).
  const { latest, deleted, walk } = await collectLatest<Record<string, unknown>>(
    opts.startCursor ?? FEED_SLOTS,
    { paceMs: opts.paceMs ?? 350, maxPages: opts.maxPages ?? 5000, label: "slots backfill" }
  );

  let updated = 0;
  let resolved = 0;
  let unresolved = 0;
  const unresolvedBy = newBreakdown();
  let slotsUpserted = 0;

  for (const it of latest.values()) {
    updated++;
    const s = parseSlot(it.data ?? {});
    if (!s) { unresolved++; unresolvedBy.badData++; continue; }
    const court = courtIndex.get(s.courtExternalId);
    if (!court) { unresolved++; unresolvedBy[unresolvedReason(s.courtExternalId, tracked)]++; continue; }
    // Seeded-but-flagged court: bail before any parsing/writing so an excluded
    // court can never produce a `slots` row (it only resolves so it can be
    // counted as a deliberate exclusion rather than a seeding gap).
    if (court.nonTennis) { unresolved++; unresolvedBy.excludedNonTennis++; continue; }
    const date = localDate(s.startsAt);
    const time = hourLabel(s.startsAt);
    if (!time) { unresolved++; unresolvedBy.noTime++; continue; }
    resolved++;
    if (!persist) continue;

    const { values } = slotRowValues(court, s, date, time);
    await upsertSlotRow(values);
    slotsUpserted++;
  }

  if (persist) {
    await upsertFeedState("openactive", SLOT_FEED, { nextCursor: walk.cursor });
  }

  return {
    pages: walk.pages,
    updated,
    deleted,
    resolved,
    unresolved,
    unresolvedBy,
    slotsUpserted,
    cursor: walk.cursor,
    persist,
  };
}

// ============================================================================
// Clock 1 — feed head-poll (delta) with transition detection
// ============================================================================

export interface SlotPollSummary {
  pages: number; // pages walked this poll (1 when already at head, no deltas)
  updated: number; // updated slot items seen across the walk
  deleted: number; // deleted slot items seen (see note in pollSlots)
  resolved: number; // updated slots that mapped to a known London court
  unresolved: number; // updated slots we couldn't place
  unresolvedBy: UnresolvedBreakdown; // why they didn't resolve (foreign vs real gap)
  slotsUpserted: number; // rows written (0 unless persist)
  transitions: number; // booked/closed → available flips detected
  /** a heal actually ran this poll: `unmappedCourt` slots were seen AND the
   * injected `healUnmapped` hook re-ingested facilities (false when no hook, no
   * unmapped slots, the hook declined/throttled, or the hook threw). */
  healed: boolean;
  /** slots rescued by that heal — previously `unmappedCourt`, resolved to a real
   * tennis court on the retry pass and written/notified like any other. */
  healedResolved: number;
  cursor: string; // head cursor after this poll
  startedFromHead: boolean; // false = full backfill (no saved cursor yet)
  persist: boolean;
  changes: SlotChange[]; // transitions, ready to hand to notifyUsers()
  byVenue: Record<string, number>; // resolved slots per venue slug (for logging)
}

/** What one feed slot resolved to, so the main loop and the heal retry pass can
 * share the resolve→write→detect body and each apply their own bookkeeping
 * (the retry pass has to UNDO the counts the main loop already made). */
type SlotOutcome = "resolved" | "excludedNonTennis" | "unmappedOrForeign" | "noTime";

/**
 * Clock 1 of the hybrid ingestion. Delta-polls the slots feed from the saved
 * head cursor (`feed_state`), applies changes to `slots`, and collects
 * booked/closed→available transitions as `SlotChange`s for the caller to notify:
 *
 *   const { changes } = await pollSlots({ persist: true });
 *   if (changes.length) await notifyUsers(changes);
 *
 * The FIRST run (no saved cursor) walks from page 1 — a full backfill — and by
 * the transition rule (`isNewlyAvailable`) notifies nothing, since every prior
 * status is null. Subsequent runs resume from the head and fetch only deltas.
 *
 * `persist` defaults FALSE: a read-only preview that detects would-be changes,
 * writes nothing, and does NOT advance the cursor. Flip it on only at the Phase 3
 * cutover — AND only after `slots` has been reset to feed-owned rows. The feed
 * writes court labels as "Court N" whereas the retiring HTML scraper wrote
 * "Tennis court N"; those are different values under the (venue,date,time,court)
 * unique key, so running both writers at once would create duplicate rows. The
 * cutover procedure is: retire the scraper, truncate `slots`, run
 * `ingestSlots({ persist: true })` once to backfill, then start `pollSlots`.
 *
 * Requires `courts` populated first (run `ingestFacilities()`); slots whose court
 * isn't in the index are counted `unresolved` and skipped. A slot whose court IS
 * indexed but flagged `non_tennis` is counted `excludedNonTennis` and skipped
 * before any write — deliberate exclusion, not a gap.
 *
 * HEAL-AND-RETRY (`opts.healUnmapped`): a slot for a tracked venue whose court
 * @id we never seeded (`unmappedCourt`) is real availability we'd otherwise drop
 * until the next facility refresh — and RPDE never re-sends it, so it'd be lost,
 * not merely delayed. So those slots are buffered; after the walk the injected
 * hook re-ingests facilities, and if it reports it actually ran we reload the
 * court index and re-process the buffer through the identical path, notifying
 * included. The hook is injected because the POLICY (throttling, "only once per
 * N minutes") belongs to the caller (`run.ts`); only the mechanism lives here.
 * A hook that declines or throws leaves the counts as-is — the poll never sinks
 * on a failed heal, and leftovers stay `unmappedCourt` so run.ts still warns.
 *
 * NOTE on deletes: an RPDE "deleted" item carries only an id (no data), and the
 * `slots` table isn't keyed by the feed slot id, so a delete can't be mapped back
 * to a row here. Deletes are counted for observability but not applied; stale
 * feed-dropped rows are swept by the daily full sweep (Clock 3) and age-based
 * cleanup. (Storing the slot @id on the row would let us prune precisely later.)
 */
export async function pollSlots(
  opts: {
    persist?: boolean;
    paceMs?: number;
    maxPages?: number;
    /** Re-ingest facilities when a tracked-venue court turns out to be unseeded.
     * Returns true if a re-ingest actually ran (false = throttled/declined, in
     * which case no retry is attempted). Throwing is tolerated. */
    healUnmapped?: () => Promise<boolean>;
  } = {}
): Promise<SlotPollSummary> {
  const persist = opts.persist ?? false;
  let courtIndex = await loadCourtIndex();
  const tracked = trackedFacilityIds(courtIndex);

  // Resume from the saved head cursor; first run (no cursor) backfills from page 1.
  const [state] = await db
    .select({ nextCursor: feedState.nextCursor })
    .from(feedState)
    .where(and(eq(feedState.source, "openactive"), eq(feedState.feed, SLOT_FEED)))
    .limit(1);
  const startedFromHead = Boolean(state?.nextCursor);
  const startUrl = state?.nextCursor || FEED_SLOTS;

  // Reduce the walk to the latest state per slot (updated wins; deleted drops).
  const { latest, deleted, walk } = await collectLatest<Record<string, unknown>>(
    startUrl,
    { paceMs: opts.paceMs ?? 350, maxPages: opts.maxPages ?? 5000, label: startedFromHead ? "slots head-poll" : "slots backfill" }
  );

  const changes: SlotChange[] = [];
  const byVenue: Record<string, number> = {};
  let updated = 0;
  let resolved = 0;
  let unresolved = 0;
  const unresolvedBy = newBreakdown();
  let slotsUpserted = 0;
  let transitions = 0;
  let healed = false;
  let healedResolved = 0;
  // Slots for a venue we track whose court @id isn't seeded — retry candidates.
  const pendingUnmapped: ParsedSlot[] = [];

  /** Resolve one parsed slot against the CURRENT index and, when it lands on a
   * real tennis court, do the full per-slot job: venue tally, transition
   * detection, persist. Returns the outcome so the caller can do the counting —
   * shared verbatim by the main loop and the post-heal retry so a rescued slot
   * is written and notified on exactly like a normally-resolved one. */
  const processSlot = async (s: ParsedSlot): Promise<SlotOutcome> => {
    const court = courtIndex.get(s.courtExternalId);
    if (!court) return "unmappedOrForeign";
    // Seeded-but-flagged: stop before any parse/write/transition work so an
    // excluded court can neither store a slot nor emit a notification.
    if (court.nonTennis) return "excludedNonTennis";
    const date = localDate(s.startsAt);
    const time = hourLabel(s.startsAt);
    if (!time) return "noTime";
    byVenue[court.venueSlug] = (byVenue[court.venueSlug] ?? 0) + 1;

    const { status: newStatus, courtLabel, values } = slotRowValues(court, s, date, time);

    // Prior status for transition detection (feed owns the row post-cutover).
    const { change } = await detectSlotTransition(
      court.venueId,
      { date, time, court: courtLabel, status: newStatus, price: values.price ?? undefined },
      { venue: court.venueSlug, venueName: court.venueName }
    );
    if (change) {
      transitions++;
      changes.push(change);
    }

    if (persist) {
      await upsertSlotRow(values);
      slotsUpserted++;
    }
    return "resolved";
  };

  for (const it of latest.values()) {
    updated++;
    const s = parseSlot(it.data ?? {});
    if (!s) { unresolved++; unresolvedBy.badData++; continue; }
    const outcome = await processSlot(s);
    if (outcome === "resolved") { resolved++; continue; }
    unresolved++;
    if (outcome === "noTime") { unresolvedBy.noTime++; continue; }
    if (outcome === "excludedNonTennis") { unresolvedBy.excludedNonTennis++; continue; }
    const reason = unresolvedReason(s.courtExternalId, tracked);
    unresolvedBy[reason]++;
    // Buffer only the real gaps; "foreign" is national-feed noise, not healable.
    if (reason === "unmappedCourt") pendingUnmapped.push(s);
  }

  // Heal-and-retry: re-seed the missing courts, then replay the buffer in this
  // same tick so the availability isn't lost (RPDE won't resend these deltas).
  if (pendingUnmapped.length > 0 && opts.healUnmapped) {
    try {
      healed = await opts.healUnmapped();
    } catch (error) {
      // A failed heal is strictly worse-case-status-quo: never sink the poll,
      // the buffered slots simply stay counted as unmapped and run.ts warns.
      console.error("healUnmapped failed (non-fatal):", error);
      healed = false;
    }
    if (healed) {
      courtIndex = await loadCourtIndex();
      for (const s of pendingUnmapped) {
        const outcome = await processSlot(s);
        if (outcome === "resolved") {
          // Undo the main loop's unmapped counting; it's a normal slot now.
          unresolved--;
          unresolvedBy.unmappedCourt--;
          resolved++;
          healedResolved++;
        } else if (outcome === "excludedNonTennis") {
          // Was never a gap — the newly-seeded court is flagged non-tennis.
          unresolvedBy.unmappedCourt--;
          unresolvedBy.excludedNonTennis++;
        } else if (outcome === "noTime") {
          unresolvedBy.unmappedCourt--;
          unresolvedBy.noTime++;
        }
        // Still unresolved → genuine upstream gap; leave it counted as
        // unmappedCourt so run.ts's ⚠️ still fires.
      }
    }
  }

  if (persist) {
    await upsertFeedState("openactive", SLOT_FEED, { nextCursor: walk.cursor });
  }

  return {
    pages: walk.pages,
    updated,
    deleted,
    resolved,
    unresolved,
    unresolvedBy,
    slotsUpserted,
    transitions,
    healed,
    healedResolved,
    cursor: walk.cursor,
    startedFromHead,
    persist,
    changes,
    byVenue,
  };
}
