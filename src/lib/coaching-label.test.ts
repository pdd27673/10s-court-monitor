import { describe, it, expect } from "vitest";
import { courtLabelImpliesCoaching } from "./coaching-label";

describe("courtLabelImpliesCoaching", () => {
  it.each([
    "Coaching",
    "Court 1 - Coaching",
    "GROUP COACHING",
    "Tennis lesson",
    "Tennis class",
    "Junior session",
    "Adult lesson",
    "Group session",
  ])("treats %j as coaching", (label) => {
    expect(courtLabelImpliesCoaching(label)).toBe(true);
  });

  it.each([
    "Court 1",
    "Tennis court 3",
    "Booked",
    "Closed for maintenance",
    "Cricket Net 1",
    "",
  ])("does not treat %j as coaching", (label) => {
    expect(courtLabelImpliesCoaching(label)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(courtLabelImpliesCoaching("CoAcHiNg")).toBe(true);
  });

  it("matches on word boundaries, not substrings", () => {
    // "coachingxyz" must not match, or arbitrary court names get misread as
    // coaching and silently drop out of availability.
    expect(courtLabelImpliesCoaching("coachingxyz")).toBe(false);
    expect(courtLabelImpliesCoaching("precoaching")).toBe(false);
  });

  it("finds the marker mid-string", () => {
    expect(courtLabelImpliesCoaching("Court 2 (junior session) 7pm")).toBe(true);
  });

  it("requires both words for the two-word patterns", () => {
    expect(courtLabelImpliesCoaching("Tennis")).toBe(false);
    expect(courtLabelImpliesCoaching("lesson")).toBe(false);
    expect(courtLabelImpliesCoaching("junior")).toBe(false);
  });
});
