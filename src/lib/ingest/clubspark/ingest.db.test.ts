import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { initTestDb, truncateAll, testDb, dbProxy } from "../../../test/pglite";

// Point the module-under-test's `db` at PGlite, stub the ClubSpark fetch so no
// real HTTP happens, and pin VENUES to a single controlled ClubSpark venue so the
// poll iterates exactly one venue (deterministic assertions).
vi.mock("../../db", () => ({ db: dbProxy }));
vi.mock("../../scrapers/clubspark", () => ({ scrapeClubSpark: vi.fn() }));
vi.mock("../../constants", () => ({
  VENUES: [
    { slug: "west-ham-park", name: "West Ham Park", type: "clubspark", clubsparkId: "WestHamPark", clubsparkHost: "clubspark.lta.org.uk" },
  ],
}));

import { scrapeClubSpark } from "../../scrapers/clubspark";
import { pollClubSpark } from "./ingest";
import { venues, courts, slots } from "../../schema";
import { and, eq } from "drizzle-orm";

const scrape = vi.mocked(scrapeClubSpark);
const TODAY = new Date().toISOString().slice(0, 10);

async function addVenue(slug: string, name = slug) {
  const [v] = await testDb().insert(venues).values({ slug, name }).returning({ id: venues.id });
  return v.id;
}

async function addSlot(venueId: number, date: string, time: string, court: string, status: string) {
  await testDb().insert(slots).values({ venueId, date, time, court, status });
}

function slotRow(venueId: number, date: string, time: string, court: string) {
  return testDb()
    .select()
    .from(slots)
    .where(and(eq(slots.venueId, venueId), eq(slots.date, date), eq(slots.time, time), eq(slots.court, court)))
    .then((r) => r[0]);
}

beforeAll(initTestDb);
beforeEach(async () => {
  await truncateAll();
  scrape.mockReset();
});

describe("pollClubSpark (DB)", () => {
  it("first persisting run backfills without notifying (all prior statuses null)", async () => {
    await addVenue("west-ham-park", "West Ham Park");
    scrape.mockResolvedValue([
      { venue: "west-ham-park", date: TODAY, time: "8am", court: "Court 1", status: "available", price: "£10" },
      { venue: "west-ham-park", date: TODAY, time: "9am", court: "Court 1", status: "booked" },
    ]);

    const r = await pollClubSpark({ persist: true, windowDays: 1 });

    expect(r.venues).toBe(1);
    expect(r.transitions).toBe(0); // backfill notifies nothing
    expect(r.slotsUpserted).toBe(2);
    expect(r.changes).toHaveLength(0);

    const row = await slotRow(1, TODAY, "8am", "Court 1");
    expect(row.status).toBe("available");
    expect(row.price).toBe("£10");
  });

  it("emits a booked → available transition on a subsequent run", async () => {
    const v = await addVenue("west-ham-park", "West Ham Park");
    await addSlot(v, TODAY, "8am", "Court 1", "booked");
    scrape.mockResolvedValue([
      { venue: "west-ham-park", date: TODAY, time: "8am", court: "Court 1", status: "available", price: "£10" },
    ]);

    const r = await pollClubSpark({ persist: true, windowDays: 1 });

    expect(r.transitions).toBe(1);
    expect(r.changes[0]).toMatchObject({
      venue: "west-ham-park",
      venueName: "West Ham Park",
      court: "Court 1",
      oldStatus: "booked",
      newStatus: "available",
    });
    const row = await slotRow(v, TODAY, "8am", "Court 1");
    expect(row.status).toBe("available");
  });

  it("fires on a coaching → available transition (ClubSpark-specific status)", async () => {
    const v = await addVenue("west-ham-park", "West Ham Park");
    await addSlot(v, TODAY, "8am", "Court 1", "coaching");
    scrape.mockResolvedValue([
      { venue: "west-ham-park", date: TODAY, time: "8am", court: "Court 1", status: "available" },
    ]);

    const r = await pollClubSpark({ persist: true, windowDays: 1 });
    expect(r.transitions).toBe(1);
    expect(r.changes[0]).toMatchObject({ oldStatus: "coaching", newStatus: "available" });
  });

  it("creates a court per name and links it to the slot's courtId", async () => {
    const v = await addVenue("west-ham-park", "West Ham Park");
    scrape.mockResolvedValue([
      { venue: "west-ham-park", date: TODAY, time: "8am", court: "Court 1", status: "available" },
      { venue: "west-ham-park", date: TODAY, time: "9am", court: "Court 2", status: "booked" },
    ]);

    await pollClubSpark({ persist: true, windowDays: 1 });

    const createdCourts = await testDb().select().from(courts).where(eq(courts.venueId, v));
    expect(createdCourts.map((c) => c.name).sort()).toEqual(["Court 1", "Court 2"]);

    const row = await slotRow(v, TODAY, "8am", "Court 1");
    const court1 = createdCourts.find((c) => c.name === "Court 1")!;
    expect(row.courtId).toBe(court1.id);
  });

  it("stamps source_type='clubspark' + external_id on the venue", async () => {
    const v = await addVenue("west-ham-park", "West Ham Park");
    scrape.mockResolvedValue([]);

    await pollClubSpark({ persist: true, windowDays: 1 });

    const [row] = await testDb().select().from(venues).where(eq(venues.id, v));
    expect(row.sourceType).toBe("clubspark");
    expect(row.externalId).toBe("WestHamPark");
  });

  it("persist:false previews transitions without writing slots, courts, or venue enrichment", async () => {
    const v = await addVenue("west-ham-park", "West Ham Park");
    await addSlot(v, TODAY, "8am", "Court 1", "booked");
    scrape.mockResolvedValue([
      { venue: "west-ham-park", date: TODAY, time: "8am", court: "Court 1", status: "available" },
    ]);

    const r = await pollClubSpark({ persist: false, windowDays: 1 });

    expect(r.transitions).toBe(1);
    expect(r.slotsUpserted).toBe(0);

    const row = await slotRow(v, TODAY, "8am", "Court 1");
    expect(row.status).toBe("booked"); // unchanged
    const createdCourts = await testDb().select().from(courts).where(eq(courts.venueId, v));
    expect(createdCourts).toHaveLength(0);
    const [venueRow] = await testDb().select().from(venues).where(eq(venues.id, v));
    expect(venueRow.sourceType).toBeNull();
  });

  it("skips a not-yet-seeded venue on a preview run", async () => {
    // no venue seeded; preview must not create it
    scrape.mockResolvedValue([
      { venue: "west-ham-park", date: TODAY, time: "8am", court: "Court 1", status: "available" },
    ]);

    const r = await pollClubSpark({ persist: false, windowDays: 1 });
    expect(r.venues).toBe(0);
    expect(scrape).not.toHaveBeenCalled();
    const all = await testDb().select().from(venues);
    expect(all).toHaveLength(0);
  });

  it("isolates a per-venue fetch failure", async () => {
    await addVenue("west-ham-park", "West Ham Park");
    scrape.mockRejectedValue(new Error("ClubSpark 503"));

    const r = await pollClubSpark({ persist: true, windowDays: 1 });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ venueSlug: "west-ham-park" });
    expect(r.errors[0].error).toContain("503");
    expect(r.transitions).toBe(0);
  });

  it("drops slots outside the requested window", async () => {
    const v = await addVenue("west-ham-park", "West Ham Park");
    scrape.mockResolvedValue([
      { venue: "west-ham-park", date: TODAY, time: "8am", court: "Court 1", status: "available" },
      { venue: "west-ham-park", date: "2099-01-01", time: "8am", court: "Court 1", status: "available" },
    ]);

    const r = await pollClubSpark({ persist: true, windowDays: 1 });
    expect(r.slotsScraped).toBe(1); // out-of-window row filtered
    void v;
  });
});
