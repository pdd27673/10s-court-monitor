import { describe, it, expect, vi, beforeEach } from "vitest";
import { scrapeCourtside } from "./courtside";

vi.mock("../proxy-manager", () => ({
  proxyManager: { getAgent: () => null },
  proxyFetch: vi.fn(),
}));

import { proxyFetch } from "../proxy-manager";

function makeMockResponse(html: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: html,
  };
}

function makeHtml(courts: { name: string; cssClass: string }[]): string {
  const courtLabels = courts
    .map(
      ({ name, cssClass }) => `
        <td><label class="court">
          <span class="button ${cssClass}">${name}</span>
        </label></td>`
    )
    .join("");

  return `
    <table>
      <tr>
        <th class="time">8am</th>
        ${courtLabels}
      </tr>
    </table>
  `;
}

beforeEach(() => {
  vi.mocked(proxyFetch).mockResolvedValue(
    makeMockResponse(makeHtml([])) as never
  );
});

describe("scrapeCourtside – court filtering", () => {
  it("returns slots for tennis courts", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeMockResponse(makeHtml([{ name: "Court 1", cssClass: "available" }])) as never
    );

    const slots = await scrapeCourtside("victoria-park", "2026-04-03");
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].court).toBe("Court 1");
  });

  it("excludes cricket courts", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeMockResponse(
        makeHtml([
          { name: "Court 1", cssClass: "available" },
          { name: "Cricket Net 1", cssClass: "available" },
          { name: "Cricket Net 2", cssClass: "booked" },
        ])
      ) as never
    );

    const slots = await scrapeCourtside("victoria-park", "2026-04-03");
    const courts = slots.map((s) => s.court);
    expect(courts).toContain("Court 1");
    expect(courts).not.toContain("Cricket Net 1");
    expect(courts).not.toContain("Cricket Net 2");
  });

  it("excludes other non-tennis court types", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeMockResponse(
        makeHtml([
          { name: "Court 1", cssClass: "available" },
          { name: "Netball Court", cssClass: "available" },
          { name: "Football Pitch", cssClass: "available" },
        ])
      ) as never
    );

    const slots = await scrapeCourtside("victoria-park", "2026-04-03");
    const courts = slots.map((s) => s.court);
    expect(courts).toEqual(["Court 1"]);
  });

  it("is case-insensitive when filtering", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeMockResponse(
        makeHtml([
          { name: "Court 1", cssClass: "available" },
          { name: "CRICKET NET 1", cssClass: "available" },
        ])
      ) as never
    );

    const slots = await scrapeCourtside("victoria-park", "2026-04-03");
    const courts = slots.map((s) => s.court);
    expect(courts).toEqual(["Court 1"]);
  });

  it("returns empty when all courts are non-tennis", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(
      makeMockResponse(
        makeHtml([
          { name: "Cricket Net 1", cssClass: "available" },
          { name: "Cricket Net 2", cssClass: "available" },
        ])
      ) as never
    );

    const slots = await scrapeCourtside("victoria-park", "2026-04-03");
    expect(slots).toHaveLength(0);
  });
});
