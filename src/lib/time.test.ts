import { describe, it, expect } from "vitest";
import {
  hhmmToMinutes,
  minutesToHhmm,
  labelToMinutes,
  anyToMinutes,
  minutesToLabel,
  toHhmm,
  toLabel,
  normalizeDayTimes,
  dayTimesToLabels,
  minutesFromIso,
} from "./time";

describe("hhmmToMinutes", () => {
  it("parses canonical 24h", () => {
    expect(hhmmToMinutes("00:00")).toBe(0);
    expect(hhmmToMinutes("07:00")).toBe(420);
    expect(hhmmToMinutes("19:00")).toBe(1140);
    expect(hhmmToMinutes("19:30")).toBe(1170);
    expect(hhmmToMinutes("23:59")).toBe(1439);
    expect(hhmmToMinutes(" 9:05 ")).toBe(545); // trims, single-digit hour
  });
  it("rejects malformed / out-of-range", () => {
    expect(hhmmToMinutes("24:00")).toBeNull();
    expect(hhmmToMinutes("12:60")).toBeNull();
    expect(hhmmToMinutes("7pm")).toBeNull();
    expect(hhmmToMinutes("noon")).toBeNull();
  });
});

describe("minutesToHhmm", () => {
  it("zero-pads and wraps", () => {
    expect(minutesToHhmm(0)).toBe("00:00");
    expect(minutesToHhmm(545)).toBe("09:05");
    expect(minutesToHhmm(1140)).toBe("19:00");
    expect(minutesToHhmm(1440)).toBe("00:00"); // wrap
  });
});

describe("labelToMinutes", () => {
  it("parses am/pm whole hours with 12 edge cases", () => {
    expect(labelToMinutes("12am")).toBe(0);
    expect(labelToMinutes("7am")).toBe(420);
    expect(labelToMinutes("12pm")).toBe(720);
    expect(labelToMinutes("7pm")).toBe(1140);
    expect(labelToMinutes("10PM")).toBe(1320); // case-insensitive
  });
  it("parses half hours", () => {
    expect(labelToMinutes("7:30pm")).toBe(1170);
    expect(labelToMinutes("12:30am")).toBe(30);
  });
  it("rejects non-labels and out-of-range", () => {
    expect(labelToMinutes("19:00")).toBeNull();
    expect(labelToMinutes("13pm")).toBeNull();
    expect(labelToMinutes("0am")).toBeNull();
  });
});

describe("anyToMinutes", () => {
  it("accepts both canonical and legacy, and they agree", () => {
    expect(anyToMinutes("19:00")).toBe(1140);
    expect(anyToMinutes("7pm")).toBe(1140);
    expect(anyToMinutes("19:00")).toBe(anyToMinutes("7pm"));
    expect(anyToMinutes("07:00")).toBe(anyToMinutes("7am"));
  });
  it("returns null for empty/garbage", () => {
    expect(anyToMinutes(null)).toBeNull();
    expect(anyToMinutes(undefined)).toBeNull();
    expect(anyToMinutes("")).toBeNull();
    expect(anyToMinutes("later")).toBeNull();
  });
});

describe("minutesToLabel", () => {
  it("renders friendly am/pm, whole and half hours", () => {
    expect(minutesToLabel(0)).toBe("12am");
    expect(minutesToLabel(420)).toBe("7am");
    expect(minutesToLabel(720)).toBe("12pm");
    expect(minutesToLabel(1140)).toBe("7pm");
    expect(minutesToLabel(1170)).toBe("7:30pm");
  });
  it("round-trips with labelToMinutes", () => {
    for (const min of [0, 420, 720, 1140, 1170, 1320]) {
      expect(labelToMinutes(minutesToLabel(min))).toBe(min);
    }
  });
});

describe("toHhmm", () => {
  it("normalises either form to canonical HH:MM", () => {
    expect(toHhmm("7pm")).toBe("19:00");
    expect(toHhmm("19:00")).toBe("19:00");
    expect(toHhmm("7:30pm")).toBe("19:30");
    expect(toHhmm("garbage")).toBeNull();
    expect(toHhmm(null)).toBeNull();
  });
});

describe("toLabel", () => {
  it("renders either form as a friendly am/pm label", () => {
    expect(toLabel("19:00")).toBe("7pm");
    expect(toLabel("7pm")).toBe("7pm");
    expect(toLabel("09:00")).toBe("9am");
    expect(toLabel("bad")).toBeNull();
  });
});

describe("normalizeDayTimes / dayTimesToLabels", () => {
  it("canonicalises a mixed-format DayTimes to HH:MM, dropping junk", () => {
    expect(
      normalizeDayTimes({ monday: ["7pm", "19:00", "8pm"], tuesday: [], friday: ["garbage", "9am"] })
    ).toEqual({ monday: ["19:00", "19:00", "20:00"], tuesday: [], friday: ["09:00"] });
  });
  it("renders a DayTimes to am/pm labels", () => {
    expect(dayTimesToLabels({ monday: ["19:00", "09:00"], sunday: ["7am"] })).toEqual({
      monday: ["7pm", "9am"],
      sunday: ["7am"],
    });
  });
  it("passes null/undefined through", () => {
    expect(normalizeDayTimes(null)).toBeNull();
    expect(dayTimesToLabels(undefined)).toBeNull();
  });
});

describe("minutesFromIso", () => {
  it("reads wall clock without timezone conversion", () => {
    expect(minutesFromIso("2026-07-12T17:00:00+01:00")).toBe(1020);
    expect(minutesFromIso("2026-07-12T17:30:00Z")).toBe(1050);
    expect(minutesFromIso("2026-07-12")).toBeNull();
  });
});
