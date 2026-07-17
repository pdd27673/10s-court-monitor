import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { initTestDb, truncateAll, testDb, dbProxy } from "../../test/pglite";

// The module under test imports `db` from "../db" and `scrapeCourtside` from
// "../scrapers/courtside". Point the first at the PGlite instance and stub the
// second so no real HTTP happens.
vi.mock("../db", () => ({ db: dbProxy }));
vi.mock("../scrapers/courtside", () => ({ scrapeCourtside: vi.fn() }));

import { scrapeCourtside } from "../scrapers/courtside";
import {
  computePendingSet,
  reconcileWatchedVenueDays,
  fullSweep,
  nextDates,
} from "./reconcile";
import { venues, courts, users, watches, slots, feedState } from "../schema";
import { and, eq } from "drizzle-orm";

const scrape = vi.mocked(scrapeCourtside);

// ---- seed helpers ----
const [TODAY, TOMORROW] = nextDates(2);

/** dayTimes JSON with the same times on every weekday (weekday-agnostic tests). */
function everyDay(times: string[]): string {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  return JSON.stringify(Object.fromEntries(days.map((d) => [d, times])));
}

async function addVenue(slug: string, opts: { sourceType?: string; active?: number } = {}) {
  const [v] = await testDb()
    .insert(venues)
    .values({ slug, name: slug, sourceType: opts.sourceType ?? "courtside", active: opts.active ?? 1 })
    .returning({ id: venues.id });
  return v.id;
}

async function addCourt(venueId: number, externalId: string, name: string) {
  const [c] = await testDb().insert(courts).values({ venueId, externalId, name }).returning({ id: courts.id });
  return c.id;
}

async function addWatch(venueId: number | null, times: string[]) {
  const [u] = await testDb()
    .insert(users)
    .values({ email: `u${Math.random().toString(36).slice(2)}@e.com` })
    .returning({ id: users.id });
  await testDb().insert(watches).values({ userId: u.id, venueId, dayTimes: everyDay(times), active: 1 });
}

async function addSlot(
  venueId: number,
  date: string,
  time: string,
  court: string,
  status: string,
  courtId?: number
) {
  await testDb().insert(slots).values({ venueId, date, time, court, status, courtId });
}

async function slotRows(venueId: number, date: string, time: string) {
  return testDb()
    .select()
    .from(slots)
    .where(and(eq(slots.venueId, venueId), eq(slots.date, date), eq(slots.time, time)));
}

beforeAll(initTestDb);
beforeEach(async () => {
  await truncateAll();
  scrape.mockReset();
});

describe("computePendingSet (DB)", () => {
  it("flags a watched venue-day as pending only when no court is available", async () => {
    const v = await addVenue("victoria-park");
    await addWatch(v, ["7pm"]);
    await addSlot(v, TODAY, "7pm", "Court 1", "booked");
    await addSlot(v, TODAY, "7pm", "Court 2", "booked");

    const p = await computePendingSet({ windowDays: 1 });
    expect(p.pendingSlots).toBe(1);
    expect(p.venueDays).toHaveLength(1);
    expect(p.venueDays[0]).toMatchObject({ venueSlug: "victoria-park", date: TODAY });
  });

  it("is NOT pending when at least one court is available", async () => {
    const v = await addVenue("victoria-park");
    await addWatch(v, ["7pm"]);
    await addSlot(v, TODAY, "7pm", "Court 1", "booked");
    await addSlot(v, TODAY, "7pm", "Court 2", "available");

    const p = await computePendingSet({ windowDays: 1 });
    expect(p.pendingSlots).toBe(0);
    expect(p.venueDays).toHaveLength(0);
  });

  it("an all-venues watch (venueId null) fans out to active venues only", async () => {
    const active = await addVenue("victoria-park", { active: 1 });
    await addVenue("st-johns-park", { active: 0 }); // closed → excluded
    await addWatch(null, ["7pm"]);
    // no slots anywhere → the active venue's watched slot is pending (missing = taken)
    const p = await computePendingSet({ windowDays: 1 });
    expect(p.venueDays.map((d) => d.venueSlug)).toEqual(["victoria-park"]);
    expect(p.venueDays[0].venueSlug).not.toBe("st-johns-park");
    void active;
  });
});

describe("reconcileWatchedVenueDays (DB) — site wins + canonical dedup", () => {
  it("updates the feed-owned 'Court N' row (no 'Tennis court N' duplicate) and emits the transition", async () => {
    const v = await addVenue("victoria-park");
    const c1 = await addCourt(v, "ext-1", "Court 1");
    await addWatch(v, ["7pm"]);
    // feed-owned row currently booked → pending
    await addSlot(v, TODAY, "7pm", "Court 1", "booked", c1);

    scrape.mockResolvedValue([
      { venue: "victoria-park", date: TODAY, time: "7pm", court: "Tennis court 1", status: "available", price: "£8" },
    ]);

    const r = await reconcileWatchedVenueDays({ persist: true, windowDays: 1 });

    expect(scrape).toHaveBeenCalledWith("victoria-park", TODAY);
    expect(r.transitions).toBe(1);
    expect(r.changes[0]).toMatchObject({ venue: "victoria-park", court: "Court 1", oldStatus: "booked", newStatus: "available" });

    const rows = await slotRows(v, TODAY, "7pm");
    expect(rows).toHaveLength(1); // updated, not duplicated
    expect(rows[0].court).toBe("Court 1");
    expect(rows[0].status).toBe("available");
    expect(rows[0].courtId).toBe(c1);

    // round-robin cursor stamped
    const cur = await testDb()
      .select()
      .from(feedState)
      .where(and(eq(feedState.source, "reconcile"), eq(feedState.feed, `victoria-park|${TODAY}`)));
    expect(cur).toHaveLength(1);
  });

  it("persist:false previews transitions without writing or stamping", async () => {
    const v = await addVenue("victoria-park");
    const c1 = await addCourt(v, "ext-1", "Court 1");
    await addWatch(v, ["7pm"]);
    await addSlot(v, TODAY, "7pm", "Court 1", "booked", c1);
    scrape.mockResolvedValue([
      { venue: "victoria-park", date: TODAY, time: "7pm", court: "Tennis court 1", status: "available" },
    ]);

    const r = await reconcileWatchedVenueDays({ persist: false, windowDays: 1 });
    expect(r.transitions).toBe(1);
    expect(r.upserted).toBe(0);

    const rows = await slotRows(v, TODAY, "7pm");
    expect(rows[0].status).toBe("booked"); // unchanged
    const cur = await testDb().select().from(feedState).where(eq(feedState.source, "reconcile"));
    expect(cur).toHaveLength(0);
  });

  it("bounds the run to maxPages (round-robin)", async () => {
    const v = await addVenue("victoria-park");
    await addCourt(v, "ext-1", "Court 1");
    await addWatch(v, ["7pm"]);
    // two pending venue-days (today + tomorrow), booked at 7pm
    await addSlot(v, TODAY, "7pm", "Court 1", "booked");
    await addSlot(v, TOMORROW, "7pm", "Court 1", "booked");
    scrape.mockResolvedValue([]);

    const r = await reconcileWatchedVenueDays({ persist: true, maxPages: 1, windowDays: 2 });
    expect(r.pendingVenueDays).toBe(2);
    expect(r.scrapedVenueDays).toBe(1);
    expect(scrape).toHaveBeenCalledTimes(1);
  });

  it("isolates a per-venue-day scrape failure", async () => {
    const v = await addVenue("victoria-park");
    await addCourt(v, "ext-1", "Court 1");
    await addWatch(v, ["7pm"]);
    await addSlot(v, TODAY, "7pm", "Court 1", "booked");
    await addSlot(v, TOMORROW, "7pm", "Court 1", "booked");

    scrape
      .mockRejectedValueOnce(new Error("blocked 404"))
      .mockResolvedValueOnce([
        { venue: "victoria-park", date: TOMORROW, time: "7pm", court: "Tennis court 1", status: "available" },
      ]);

    const r = await reconcileWatchedVenueDays({ persist: true, windowDays: 2 });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].error).toContain("blocked");
    expect(r.transitions).toBe(1); // the surviving venue-day still reconciled
  });

  it("advances the round-robin cursor even when a scrape fails (no starvation)", async () => {
    const v = await addVenue("victoria-park");
    await addWatch(v, ["7pm"]);
    await addSlot(v, TODAY, "7pm", "Court 1", "booked");
    scrape.mockRejectedValue(new Error("IP blocked (404)"));

    const r = await reconcileWatchedVenueDays({ persist: true, windowDays: 1 });
    expect(r.errors).toHaveLength(1);

    // cursor stamped despite the failure → next run rotates past it
    const cur = await testDb()
      .select()
      .from(feedState)
      .where(and(eq(feedState.source, "reconcile"), eq(feedState.feed, `victoria-park|${TODAY}`)));
    expect(cur).toHaveLength(1);
  });

  it("excludes non-Courtside (ClubSpark) venues from reconcile targets", async () => {
    const v = await addVenue("newham-clubspark", { sourceType: "clubspark" });
    await addWatch(v, ["7pm"]);
    await addSlot(v, TODAY, "7pm", "Court 1", "booked");

    const r = await reconcileWatchedVenueDays({ persist: true, windowDays: 1 });
    expect(r.pendingVenueDays).toBe(0);
    expect(scrape).not.toHaveBeenCalled();
  });
});

describe("fullSweep (DB)", () => {
  it("scrapes every active courtside venue-day and site-wins upserts", async () => {
    const v = await addVenue("victoria-park");
    const c1 = await addCourt(v, "ext-1", "Court 1");
    await addSlot(v, TODAY, "7pm", "Court 1", "booked", c1);
    scrape.mockResolvedValue([
      { venue: "victoria-park", date: TODAY, time: "7pm", court: "Tennis court 1", status: "available" },
    ]);

    const r = await fullSweep({ persist: true, windowDays: 1 });
    expect(r.venueDays).toBe(1); // 1 venue × 1 day
    expect(r.transitions).toBe(1);
    expect(r.upserted).toBe(1);

    const rows = await slotRows(v, TODAY, "7pm");
    expect(rows[0].status).toBe("available");
  });

  it("persist:false writes nothing", async () => {
    const v = await addVenue("victoria-park");
    await addCourt(v, "ext-1", "Court 1");
    await addSlot(v, TODAY, "7pm", "Court 1", "booked");
    scrape.mockResolvedValue([
      { venue: "victoria-park", date: TODAY, time: "7pm", court: "Tennis court 1", status: "available" },
    ]);

    const r = await fullSweep({ persist: false, windowDays: 1 });
    expect(r.upserted).toBe(0);
    const rows = await slotRows(v, TODAY, "7pm");
    expect(rows[0].status).toBe("booked");
  });
});
