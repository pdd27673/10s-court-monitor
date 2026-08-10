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

/** Response builder that lets a test drive session categories directly. */
function makeSessionResponse(
  sessions: { StartTime: number; EndTime: number; Category: number; CourtCost?: number; LightingCost?: number }[]
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      EarliestStartTime: 480, // 08:00
      LatestEndTime: 540, // 09:00 → exactly one hourly slot
      MinimumInterval: 60,
      Resources: [{ ID: "r1", Name: "Court 1", Days: [{ Date: "2026-04-03T00:00:00", Sessions: sessions }] }],
    }),
  };
}

describe("scrapeClubSpark – session status mapping", () => {
  it("maps Category 0 to available and sums court + lighting cost", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeSessionResponse([
        { StartTime: 480, EndTime: 540, Category: 0, CourtCost: 6, LightingCost: 1.5 },
      ]) as never
    );

    const slots = await scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03");

    expect(slots).toHaveLength(1);
    expect(slots[0].status).toBe("available");
    expect(slots[0].price).toBe("£7.50");
  });

  it("maps Category 1000 to booked and carries no price", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeSessionResponse([{ StartTime: 480, EndTime: 540, Category: 1000 }]) as never
    );

    const slots = await scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03");

    expect(slots[0].status).toBe("booked");
    expect(slots[0].price).toBeUndefined();
  });

  it("maps any other category to coaching", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeSessionResponse([{ StartTime: 480, EndTime: 540, Category: 5 }]) as never
    );

    const slots = await scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03");

    expect(slots[0].status).toBe("coaching");
  });

  it("treats an hour with no covering session as available at the default price", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(makeSessionResponse([]) as never);

    const slots = await scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03");

    expect(slots[0].status).toBe("available");
    expect(slots[0].price).toBe("£10.00");
  });

  it("ignores a session that does not span the slot's start minute", async () => {
    // Session ends exactly at the slot start → must not claim the 08:00 slot.
    vi.mocked(proxyFetch).mockResolvedValue(
      makeSessionResponse([{ StartTime: 420, EndTime: 480, Category: 1000 }]) as never
    );

    const slots = await scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03");

    expect(slots[0].status).toBe("available");
  });

  it("strips the time component from the day's date", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(makeSessionResponse([]) as never);

    const slots = await scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03");

    expect(slots[0].date).toBe("2026-04-03");
  });
});

describe("scrapeClubSpark – transport failures", () => {
  it("throws with the status when the API responds not-ok", async () => {
    vi.mocked(proxyFetch).mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as never);

    await expect(scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03")).rejects.toThrow(/503/);
  });

  it("propagates a transport error rather than returning an empty day", async () => {
    // Silently returning [] would look like "no courts free" and mask an outage.
    vi.mocked(proxyFetch).mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(scrapeClubSpark(mockVenue, "2026-04-03", "2026-04-03")).rejects.toThrow("ETIMEDOUT");
  });
});
