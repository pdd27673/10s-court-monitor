import { describe, it, expect } from "vitest";
import { formatSlotChangesForExpoPush } from "./expo-push";
import type { SlotChange } from "../differ";

function makeChange(overrides: Partial<SlotChange> = {}): SlotChange {
  return {
    venue: "victoria-park",
    venueName: "Victoria Park",
    date: "2026-07-15",
    time: "7pm",
    court: "Court 1",
    oldStatus: "booked",
    newStatus: "available",
    ...overrides,
  };
}

describe("formatSlotChangesForExpoPush", () => {
  it("returns a singular title for one slot", () => {
    const { title, body } = formatSlotChangesForExpoPush([makeChange()]);
    expect(title).toContain("A court just opened up");
    expect(body).toContain("Victoria Park");
    expect(body).toContain("7pm");
  });

  it("returns a plural title with the count for multiple slots", () => {
    const changes = [
      makeChange({ time: "7pm" }),
      makeChange({ time: "8pm" }),
    ];
    const { title, body } = formatSlotChangesForExpoPush(changes);
    expect(title).toContain("2 courts just opened up");
    // Same venue+date collapses into one group with both times.
    expect(body).toContain("7pm");
    expect(body).toContain("8pm");
  });

  it("groups by venue and date", () => {
    const changes = [
      makeChange({ venueName: "Victoria Park", time: "7pm" }),
      makeChange({
        venue: "ropemakers-field",
        venueName: "Ropemakers Field",
        time: "6pm",
      }),
    ];
    const { body } = formatSlotChangesForExpoPush(changes);
    expect(body).toContain("Victoria Park");
    expect(body).toContain("Ropemakers Field");
    expect(body).toContain(" · ");
  });

  it("handles an empty change list without throwing", () => {
    const { body } = formatSlotChangesForExpoPush([]);
    expect(body).toBe("");
  });
});
