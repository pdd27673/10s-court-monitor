import { describe, it, expect } from "vitest";
import { watchPreferredTimes, nextDates } from "./reconcile";

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
