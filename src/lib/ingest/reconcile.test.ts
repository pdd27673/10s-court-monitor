import { describe, it, expect } from "vitest";
import {
  watchPreferredTimes,
  nextDates,
  canonicalCourtLabel,
  selectReconcileTargets,
  type PendingVenueDay,
} from "./reconcile";

describe("watchPreferredTimes", () => {
  const dayTimes = (o: Record<string, string[]>) => ({ dayTimes: JSON.stringify(o), weekdayTimes: null, weekendTimes: null });

  it("reads the new dayTimes JSON per day", () => {
    const w = dayTimes({ monday: ["7pm", "8pm"], tuesday: [] });
    expect(watchPreferredTimes(w, "monday")).toEqual(["7pm", "8pm"]);
    expect(watchPreferredTimes(w, "tuesday")).toEqual([]);
    expect(watchPreferredTimes(w, "sunday")).toEqual([]); // absent key
  });

  it("falls back to legacy weekday/weekend fields", () => {
    const w = { dayTimes: null, weekdayTimes: JSON.stringify(["6pm"]), weekendTimes: JSON.stringify(["10am"]) };
    expect(watchPreferredTimes(w, "wednesday")).toEqual(["6pm"]);
    expect(watchPreferredTimes(w, "saturday")).toEqual(["10am"]);
    expect(watchPreferredTimes(w, "sunday")).toEqual(["10am"]);
  });

  it("is defensive against malformed / missing config", () => {
    expect(watchPreferredTimes({ dayTimes: "not json", weekdayTimes: null, weekendTimes: null }, "monday")).toEqual([]);
    expect(watchPreferredTimes({ dayTimes: null, weekdayTimes: null, weekendTimes: null }, "monday")).toEqual([]);
  });
});

describe("nextDates", () => {
  it("returns n consecutive local dates starting today", () => {
    const from = new Date("2026-07-12T09:00:00Z");
    expect(nextDates(3, from)).toEqual(["2026-07-12", "2026-07-13", "2026-07-14"]);
    expect(nextDates(1, from)).toEqual(["2026-07-12"]);
  });

  it("rolls over month boundaries", () => {
    expect(nextDates(2, new Date("2026-07-31T09:00:00Z"))).toEqual(["2026-07-31", "2026-08-01"]);
  });
});

describe("canonicalCourtLabel", () => {
  const index = new Map([
    [1, { courtId: 11, name: "Court 1" }],
    [3, { courtId: 13, name: "Court 3" }],
  ]);

  it("maps a scraped 'Tennis court N' to the feed-canonical row (label + courtId)", () => {
    expect(canonicalCourtLabel("Tennis court 3", index)).toEqual({ court: "Court 3", courtId: 13 });
    // trailing coaching marker the scraper appends is tolerated
    expect(canonicalCourtLabel("Tennis court 1 -", index)).toEqual({ court: "Court 1", courtId: 11 });
  });

  it("synthesises 'Court N' when the court number isn't in the index (pre-cutover)", () => {
    expect(canonicalCourtLabel("Tennis court 2", index)).toEqual({ court: "Court 2", courtId: null });
    expect(canonicalCourtLabel("Tennis court 4", undefined)).toEqual({ court: "Court 4", courtId: null });
  });

  it("returns null for an unmappable label with no court number", () => {
    expect(canonicalCourtLabel("Unknown", index)).toBeNull();
  });
});

describe("selectReconcileTargets", () => {
  const vd = (venueSlug: string, date: string): PendingVenueDay => ({ venueSlug, date, pendingTimes: ["7pm"] });

  it("orders least-recently-checked first, never-checked before all", () => {
    const pending = [vd("victoria-park", "2026-07-16"), vd("bethnal-green-gardens", "2026-07-16"), vd("ropemakers-field", "2026-07-16")];
    const lastChecked = new Map<string, number>([
      ["victoria-park|2026-07-16", 5000],
      ["ropemakers-field|2026-07-16", 1000],
      // bethnal-green never checked → sorts first
    ]);
    const out = selectReconcileTargets(pending, lastChecked, 10);
    expect(out.map((t) => t.venueSlug)).toEqual(["bethnal-green-gardens", "ropemakers-field", "victoria-park"]);
  });

  it("bounds the result to maxPages (round-robin backlog)", () => {
    const pending = [vd("a", "2026-07-16"), vd("b", "2026-07-16"), vd("c", "2026-07-16")];
    const out = selectReconcileTargets(pending, new Map(), 2);
    // all never-checked → deterministic tiebreak by "<slug>|<date>"
    expect(out.map((t) => t.venueSlug)).toEqual(["a", "b"]);
    expect(out).toHaveLength(2);
  });

  it("is deterministic on ties so repeated runs rotate cleanly", () => {
    const pending = [vd("b", "2026-07-16"), vd("a", "2026-07-16")];
    expect(selectReconcileTargets(pending, new Map(), 5).map((t) => t.venueSlug)).toEqual(["a", "b"]);
  });
});
