import { describe, it, expect } from "vitest";
import { isNonTennisName } from "./non-tennis";

describe("isNonTennisName", () => {
  it("flags padel courts (the leak this guards against)", () => {
    expect(isNonTennisName("Padel Court 1")).toBe(true);
    expect(isNonTennisName("padel")).toBe(true);
    expect(isNonTennisName("Paddle Tennis 2")).toBe(true);
  });

  it("flags other non-tennis sports", () => {
    expect(isNonTennisName("Cricket Nets")).toBe(true);
    expect(isNonTennisName("Netball Court")).toBe(true);
    expect(isNonTennisName("Bowling Green")).toBe(true);
  });

  it("keeps tennis courts and tolerates null/empty", () => {
    expect(isNonTennisName("Court 3")).toBe(false);
    expect(isNonTennisName("Tennis court 1")).toBe(false);
    expect(isNonTennisName(null)).toBe(false);
    expect(isNonTennisName(undefined)).toBe(false);
    expect(isNonTennisName("")).toBe(false);
  });
});
