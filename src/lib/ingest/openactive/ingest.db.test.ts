import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { initTestDb, truncateAll, testDb, dbProxy } from "../../../test/pglite";

// ingest.ts imports `db` from "../../db" and the RPDE walker from "./client".
// Back the db with PGlite; replace walkToHead with a controllable in-memory feed
// (keeping the real FEED_* constants) so no network is touched.
vi.mock("../../db", () => ({ db: dbProxy }));

const walkState = vi.hoisted(() => ({ items: [] as { state: string; id: string | number }[], cursor: "HEAD-CURSOR" }));
// ingest.ts now consumes the feed via `collectLatest` (the shared RPDE reducer),
// so intercept THAT seam and reproduce its updated-wins/deleted-drops reduction
// over the in-memory walkState.
vi.mock("./client", async (orig) => {
  const actual = await orig<typeof import("./client")>();
  return {
    ...actual,
    collectLatest: vi.fn(async () => {
      const latest = new Map<string, unknown>();
      let deleted = 0;
      for (const it of walkState.items) {
        if (it.state === "deleted") {
          deleted++;
          latest.delete(String(it.id));
        } else {
          latest.set(String(it.id), it);
        }
      }
      return { latest, deleted, walk: { cursor: walkState.cursor, pages: 1, items: walkState.items.length } };
    }),
  };
});

import { ingestFacilities, ingestSlots, pollSlots } from "./ingest";
import { nextDates } from "../reconcile";
import { venues, courts, slots, feedState } from "../../schema";
import { and, eq } from "drizzle-orm";

const [TODAY] = nextDates(1);
const BASE = "https://api.premiertennis.co.uk/openactive/feed";
const FACILITY_ID = `${BASE}/facility-uses/900`;
const COURT_EXT = `${BASE}/facility-uses/900/individual-facility-uses/1`;

const facilityItem = (opts: { lat: number; lng: number; id?: number }) => {
  const id = opts.id ?? 900;
  return {
    state: "updated",
    kind: "FacilityUse",
    id,
    modified: 1,
    data: {
      "@id": `${BASE}/facility-uses/${id}`,
      identifier: String(id),
      name: `Tennis courts at Test Park ${id}`,
      individualFacilityUse: [{ "@id": `${BASE}/facility-uses/${id}/individual-facility-uses/1`, name: "Court 1" }],
      location: { name: `Test Park ${id}`, geo: { latitude: opts.lat, longitude: opts.lng } },
    },
  };
};

const slotItem = (opts: { remainingUses: number; court?: string; id?: number }) => ({
  state: "updated",
  kind: "Slot",
  id: opts.id ?? 5000,
  modified: 1,
  data: {
    "@id": `${BASE}/slots/${opts.id ?? 5000}`,
    facilityUse: opts.court ?? COURT_EXT,
    startDate: `${TODAY}T19:00:00+01:00`,
    endDate: `${TODAY}T20:00:00+01:00`,
    remainingUses: opts.remainingUses,
    maximumUses: 1,
    offers: [{ identifier: "base", price: 8.5, priceCurrency: "GBP" }],
  },
});

const PADEL_COURT_EXT = `${BASE}/facility-uses/900/individual-facility-uses/7`;
const UNSEEDED_COURT_EXT = `${BASE}/facility-uses/900/individual-facility-uses/2`;

async function seedVenueAndCourt() {
  const [v] = await testDb()
    .insert(venues)
    .values({ slug: "test-park", name: "Test Park", sourceType: "courtside" })
    .returning({ id: venues.id });
  await testDb().insert(courts).values({ venueId: v.id, externalId: COURT_EXT, name: "Court 1" });
  return v.id;
}

/** Seeded-but-flagged court at the SAME tracked facility — the padel case that
 * used to be dropped at parse time and misread as an unmapped tennis court. */
async function seedPadelCourt(venueId: number) {
  await testDb()
    .insert(courts)
    .values({ venueId, externalId: PADEL_COURT_EXT, name: "Padel Court 1", nonTennis: 1 });
}

beforeAll(initTestDb);
beforeEach(async () => {
  await truncateAll();
  walkState.items = [];
  walkState.cursor = "HEAD-CURSOR";
});

describe("ingestFacilities (DB)", () => {
  it("upserts London venues + courts and persists the facility cursor; skips non-London", async () => {
    walkState.items = [facilityItem({ lat: 51.5, lng: -0.1 }), facilityItem({ lat: 52.2, lng: -0.9, id: 901 })];

    const s = await ingestFacilities({ paceMs: 0 });
    expect(s.londonVenues).toBe(1);
    expect(s.venuesInserted).toBe(1);
    expect(s.courtsUpserted).toBe(1);

    const vs = await testDb().select().from(venues);
    expect(vs).toHaveLength(1);
    expect(vs[0].lat).toBeCloseTo(51.5);
    expect(vs[0].externalId).toBe(FACILITY_ID);

    const cs = await testDb().select().from(courts);
    expect(cs).toHaveLength(1);

    const fs = await testDb()
      .select()
      .from(feedState)
      .where(and(eq(feedState.source, "openactive"), eq(feedState.feed, "facility-uses")));
    expect(fs[0].nextCursor).toBe("HEAD-CURSOR");
  });

  it("dryRun writes nothing", async () => {
    walkState.items = [facilityItem({ lat: 51.5, lng: -0.1 })];
    const s = await ingestFacilities({ dryRun: true, paceMs: 0 });
    expect(s.londonVenues).toBe(1);
    expect(await testDb().select().from(venues)).toHaveLength(0);
    expect(await testDb().select().from(feedState)).toHaveLength(0);
  });
});

describe("ingestSlots (DB)", () => {
  it("persist:false resolves but writes nothing", async () => {
    await seedVenueAndCourt();
    walkState.items = [slotItem({ remainingUses: 1 })];

    const s = await ingestSlots({ persist: false, paceMs: 0 });
    expect(s.resolved).toBe(1);
    expect(s.slotsUpserted).toBe(0);
    expect(await testDb().select().from(slots)).toHaveLength(0);
  });

  it("persist:true writes a canonical-label slot row + slot cursor", async () => {
    const vid = await seedVenueAndCourt();
    walkState.items = [slotItem({ remainingUses: 1 })];

    const s = await ingestSlots({ persist: true, paceMs: 0 });
    expect(s.resolved).toBe(1);
    expect(s.slotsUpserted).toBe(1);

    const rows = await testDb().select().from(slots).where(eq(slots.venueId, vid));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ court: "Court 1", time: "7pm", date: TODAY, status: "available" });
    expect(rows[0].price).toBe("8.5");

    const fs = await testDb()
      .select()
      .from(feedState)
      .where(eq(feedState.feed, "individual-facility-use-slots"));
    expect(fs[0].nextCursor).toBe("HEAD-CURSOR");
  });

  it("classifies a slot for an untracked facility as unresolved/foreign", async () => {
    await seedVenueAndCourt(); // seeds facility 900
    // facility 999 isn't one we track → benign national-feed noise
    walkState.items = [slotItem({ remainingUses: 1, court: `${BASE}/facility-uses/999/individual-facility-uses/9` })];
    const s = await ingestSlots({ persist: true, paceMs: 0 });
    expect(s.resolved).toBe(0);
    expect(s.unresolved).toBe(1);
    expect(s.unresolvedBy).toMatchObject({ foreign: 1, unmappedCourt: 0 });
    expect(await testDb().select().from(slots)).toHaveLength(0);
  });

  it("flags a slot for a TRACKED facility whose court @id isn't seeded as unmappedCourt", async () => {
    await seedVenueAndCourt(); // seeds facility 900, court .../900/individual-facility-uses/1
    // same facility 900 (we track it) but court #2 was never seeded → real gap
    walkState.items = [slotItem({ remainingUses: 1, court: UNSEEDED_COURT_EXT })];
    const s = await ingestSlots({ persist: true, paceMs: 0 });
    expect(s.resolved).toBe(0);
    expect(s.unresolvedBy).toMatchObject({ foreign: 0, unmappedCourt: 1, excludedNonTennis: 0 });
  });

  it("counts a seeded-but-flagged (non-tennis) court as excludedNonTennis, not unmappedCourt, and writes no row", async () => {
    const vid = await seedVenueAndCourt();
    await seedPadelCourt(vid);
    walkState.items = [slotItem({ remainingUses: 1, court: PADEL_COURT_EXT })];

    const s = await ingestSlots({ persist: true, paceMs: 0 });
    expect(s.resolved).toBe(0);
    expect(s.unresolved).toBe(1);
    expect(s.unresolvedBy).toMatchObject({ excludedNonTennis: 1, unmappedCourt: 0, foreign: 0 });
    expect(s.slotsUpserted).toBe(0);
    expect(await testDb().select().from(slots)).toHaveLength(0);
  });
});

describe("ingestFacilities — non-tennis flag persistence", () => {
  it("re-flags a court seeded before the guard existed (update path)", async () => {
    const [v] = await testDb()
      .insert(venues)
      .values({ slug: "test-park-900", name: "Test Park 900", sourceType: "courtside" })
      .returning({ id: venues.id });
    // Pre-existing unflagged padel row, as a pre-guard ingest would have left it.
    await testDb()
      .insert(courts)
      .values({ venueId: v.id, externalId: PADEL_COURT_EXT, name: "Padel Court 1", nonTennis: 0 });

    const item = facilityItem({ lat: 51.5, lng: -0.1 });
    item.data.individualFacilityUse.push({ "@id": PADEL_COURT_EXT, name: "Padel Court 1" });
    walkState.items = [item];

    await ingestFacilities({ paceMs: 0 });

    const padel = await testDb().select().from(courts).where(eq(courts.externalId, PADEL_COURT_EXT));
    expect(padel[0].nonTennis).toBe(1);
    const tennis = await testDb().select().from(courts).where(eq(courts.externalId, COURT_EXT));
    expect(tennis[0].nonTennis).toBe(0);
  });
});

describe("pollSlots (DB) — delta + transition detection", () => {
  it("first run (no cursor) backfills and notifies nothing; second run detects booked→available", async () => {
    const vid = await seedVenueAndCourt();

    // Poll #1: no saved cursor → backfill; slot booked. Null prior → no transition.
    walkState.items = [slotItem({ remainingUses: 0 })];
    const p1 = await pollSlots({ persist: true, paceMs: 0 });
    expect(p1.startedFromHead).toBe(false);
    expect(p1.transitions).toBe(0);
    expect(p1.slotsUpserted).toBe(1);
    const after1 = await testDb().select().from(slots).where(eq(slots.venueId, vid));
    expect(after1[0].status).toBe("booked");

    // Poll #2: cursor now saved → delta; same slot flips to available → transition.
    walkState.items = [slotItem({ remainingUses: 1 })];
    const p2 = await pollSlots({ persist: true, paceMs: 0 });
    expect(p2.startedFromHead).toBe(true);
    expect(p2.transitions).toBe(1);
    expect(p2.changes[0]).toMatchObject({ court: "Court 1", oldStatus: "booked", newStatus: "available" });
    const after2 = await testDb().select().from(slots).where(eq(slots.venueId, vid));
    expect(after2[0].status).toBe("available");
  });

  it("persist:false previews a transition without writing or advancing the cursor", async () => {
    const vid = await seedVenueAndCourt();
    // seed a booked feed-owned row
    await testDb().insert(slots).values({ venueId: vid, date: TODAY, time: "7pm", court: "Court 1", status: "booked" });
    walkState.items = [slotItem({ remainingUses: 1 })];

    const p = await pollSlots({ persist: false, paceMs: 0 });
    expect(p.transitions).toBe(1);
    expect(p.slotsUpserted).toBe(0);

    const rows = await testDb().select().from(slots).where(eq(slots.venueId, vid));
    expect(rows[0].status).toBe("booked"); // unchanged
    expect(await testDb().select().from(feedState).where(eq(feedState.feed, "individual-facility-use-slots"))).toHaveLength(0);
  });

  it("a slot for a seeded-but-flagged court is excludedNonTennis: no row, no transition", async () => {
    const vid = await seedVenueAndCourt();
    await seedPadelCourt(vid);
    // A prior booked row would make this a booked→available flip for a tennis
    // court; the flag must suppress the transition as well as the write.
    await testDb()
      .insert(slots)
      .values({ venueId: vid, date: TODAY, time: "7pm", court: "Padel Court 1", status: "booked" });
    walkState.items = [slotItem({ remainingUses: 1, court: PADEL_COURT_EXT })];

    const p = await pollSlots({ persist: true, paceMs: 0 });
    expect(p.resolved).toBe(0);
    expect(p.unresolved).toBe(1);
    expect(p.unresolvedBy).toMatchObject({ excludedNonTennis: 1, unmappedCourt: 0, foreign: 0 });
    expect(p.transitions).toBe(0);
    expect(p.changes).toHaveLength(0);
    expect(p.slotsUpserted).toBe(0);
    expect(p.byVenue).toEqual({});

    const rows = await testDb().select().from(slots).where(eq(slots.venueId, vid));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("booked"); // untouched
  });
});

describe("pollSlots (DB) — heal-and-retry for unmapped tracked-venue courts", () => {
  it("rescues a previously-unmapped slot when healUnmapped seeds the court", async () => {
    const vid = await seedVenueAndCourt();
    // Court #2 at the tracked facility 900 is missing → unmappedCourt.
    walkState.items = [slotItem({ remainingUses: 1, court: UNSEEDED_COURT_EXT })];

    const healUnmapped = vi.fn(async () => {
      await testDb().insert(courts).values({ venueId: vid, externalId: UNSEEDED_COURT_EXT, name: "Court 2" });
      return true;
    });

    const p = await pollSlots({ persist: true, paceMs: 0, healUnmapped });
    expect(healUnmapped).toHaveBeenCalledTimes(1);
    expect(p.healed).toBe(true);
    expect(p.healedResolved).toBe(1);
    expect(p.resolved).toBe(1);
    expect(p.unresolved).toBe(0);
    expect(p.unresolvedBy).toMatchObject({ unmappedCourt: 0, foreign: 0, excludedNonTennis: 0 });
    expect(p.slotsUpserted).toBe(1);
    expect(p.byVenue).toEqual({ "test-park": 1 });

    const rows = await testDb().select().from(slots).where(eq(slots.court, "Court 2"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ venueId: vid, date: TODAY, time: "7pm", status: "available" });
  });

  it("a healed slot still notifies: booked→available flip is detected on the retry pass", async () => {
    const vid = await seedVenueAndCourt();
    // Prior booked row for the not-yet-seeded court, so the rescue is a flip.
    await testDb()
      .insert(slots)
      .values({ venueId: vid, date: TODAY, time: "7pm", court: "Court 2", status: "booked" });
    walkState.items = [slotItem({ remainingUses: 1, court: UNSEEDED_COURT_EXT })];

    const p = await pollSlots({
      persist: true,
      paceMs: 0,
      healUnmapped: async () => {
        await testDb().insert(courts).values({ venueId: vid, externalId: UNSEEDED_COURT_EXT, name: "Court 2" });
        return true;
      },
    });
    expect(p.healedResolved).toBe(1);
    expect(p.transitions).toBe(1);
    expect(p.changes[0]).toMatchObject({ court: "Court 2", oldStatus: "booked", newStatus: "available" });
  });

  it("a heal that seeds the court FLAGGED moves it to excludedNonTennis, not resolved", async () => {
    const vid = await seedVenueAndCourt();
    walkState.items = [slotItem({ remainingUses: 1, court: PADEL_COURT_EXT })];

    const p = await pollSlots({
      persist: true,
      paceMs: 0,
      healUnmapped: async () => {
        await seedPadelCourt(vid);
        return true;
      },
    });
    expect(p.healed).toBe(true);
    expect(p.healedResolved).toBe(0);
    expect(p.resolved).toBe(0);
    expect(p.unresolved).toBe(1); // still unresolved, just benignly so
    expect(p.unresolvedBy).toMatchObject({ unmappedCourt: 0, excludedNonTennis: 1 });
    expect(p.slotsUpserted).toBe(0);
  });

  it("healUnmapped returning false (throttled) leaves the slot counted as unmappedCourt", async () => {
    await seedVenueAndCourt();
    walkState.items = [slotItem({ remainingUses: 1, court: UNSEEDED_COURT_EXT })];

    const healUnmapped = vi.fn(async () => false);
    const p = await pollSlots({ persist: true, paceMs: 0, healUnmapped });
    expect(healUnmapped).toHaveBeenCalledTimes(1);
    expect(p.healed).toBe(false);
    expect(p.healedResolved).toBe(0);
    expect(p.unresolved).toBe(1);
    expect(p.unresolvedBy).toMatchObject({ unmappedCourt: 1 });
    expect(p.slotsUpserted).toBe(0);
  });

  it("a throwing healUnmapped doesn't sink the poll; cursor still advances", async () => {
    await seedVenueAndCourt();
    walkState.items = [
      slotItem({ remainingUses: 1 }), // normal slot, must still be processed
      slotItem({ remainingUses: 1, court: UNSEEDED_COURT_EXT, id: 5001 }),
    ];

    const p = await pollSlots({
      persist: true,
      paceMs: 0,
      healUnmapped: async () => {
        throw new Error("facility ingest exploded");
      },
    });
    expect(p.healed).toBe(false);
    expect(p.healedResolved).toBe(0);
    expect(p.resolved).toBe(1);
    expect(p.unresolvedBy).toMatchObject({ unmappedCourt: 1 });
    expect(p.slotsUpserted).toBe(1);

    const fs = await testDb().select().from(feedState).where(eq(feedState.feed, "individual-facility-use-slots"));
    expect(fs[0].nextCursor).toBe("HEAD-CURSOR");
  });

  it("no unmapped slots → the heal hook is never called", async () => {
    await seedVenueAndCourt();
    walkState.items = [slotItem({ remainingUses: 1 })];
    const healUnmapped = vi.fn(async () => true);
    const p = await pollSlots({ persist: true, paceMs: 0, healUnmapped });
    expect(healUnmapped).not.toHaveBeenCalled();
    expect(p.healed).toBe(false);
  });

  it("a foreign (untracked-facility) slot is never buffered for healing", async () => {
    await seedVenueAndCourt();
    walkState.items = [slotItem({ remainingUses: 1, court: `${BASE}/facility-uses/999/individual-facility-uses/9` })];
    const healUnmapped = vi.fn(async () => true);
    const p = await pollSlots({ persist: true, paceMs: 0, healUnmapped });
    expect(healUnmapped).not.toHaveBeenCalled();
    expect(p.unresolvedBy).toMatchObject({ foreign: 1, unmappedCourt: 0 });
  });
});
