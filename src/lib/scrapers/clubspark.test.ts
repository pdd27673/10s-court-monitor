import { describe, it, expect, vi, beforeEach } from "vitest";
import { scrapeClubSpark } from "./clubspark";
import type { Venue } from "../constants";

vi.mock("../proxy-manager", () => ({
  proxyManager: { getAgent: () => null },
  proxyFetch: vi.fn(),
}));

import { proxyFetch } from "../proxy-manager";

const mockVenue: Venue = {
  slug: "west-ham-park",
  name: "West Ham Park",
  type: "clubspark",
  clubsparkId: "WestHamPark",
  clubsparkHost: "clubspark.lta.org.uk",
};

function makeMockResponse(resources: { ID: string; Name: string }[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      EarliestStartTime: 480, // 8am
      LatestEndTime: 600,     // 10am (2 slots for brevity)
      MinimumInterval: 60,
      Resources: resources.map((r) => ({
        ...r,
        Days: [{ Date: "2026-04-03T00:00:00", Sessions: [] }],
      })),
    }),
  };
}

beforeEach(() => {
  vi.mocked(proxyFetch).mockResolvedValue(makeMockResponse([]) as never);
});

describe("scrapeClubSpark – court filtering", () => {
  it("returns slots for tennis courts", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeMockResponse([{ ID: "1", Name: "Court 1" }]) as never
    );

    const slots = await scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03");
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.court === "Court 1")).toBe(true);
  });

  it("excludes cricket courts", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeMockResponse([
        { ID: "1", Name: "Court 1" },
        { ID: "2", Name: "Cricket Net 1" },
        { ID: "3", Name: "Cricket Net 2" },
        { ID: "4", Name: "Cricket Net 3" },
      ]) as never
    );

    const slots = await scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03");
    const courts = [...new Set(slots.map((s) => s.court))];
    expect(courts).toEqual(["Court 1"]);
    expect(courts).not.toContain("Cricket Net 1");
  });

  it("excludes other non-tennis court types", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeMockResponse([
        { ID: "1", Name: "Court 1" },
        { ID: "2", Name: "Netball Court 1" },
        { ID: "3", Name: "Football Pitch 1" },
        { ID: "4", Name: "Basketball Court" },
      ]) as never
    );

    const slots = await scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03");
    const courts = [...new Set(slots.map((s) => s.court))];
    expect(courts).toEqual(["Court 1"]);
  });

  it("is case-insensitive when filtering", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeMockResponse([
        { ID: "1", Name: "Court 1" },
        { ID: "2", Name: "CRICKET NET 1" },
      ]) as never
    );

    const slots = await scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03");
    const courts = [...new Set(slots.map((s) => s.court))];
    expect(courts).toEqual(["Court 1"]);
  });

  it("returns empty slots when all courts are non-tennis", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeMockResponse([
        { ID: "1", Name: "Cricket Net 1" },
        { ID: "2", Name: "Cricket Net 2" },
      ]) as never
    );

    const slots = await scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03");
    expect(slots).toHaveLength(0);
  });
});
