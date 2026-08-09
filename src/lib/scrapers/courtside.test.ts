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

describe("scrapeCourtside – bot challenge detection", () => {
  // The real interstitial: a 200 with a full-size body, which is why every
  // pre-existing guard (status, ok, "Access Denied", length) lets it through.
  const turnstilePage = `
    <html><head><title>Book courts and pitches in Tower Hamlets with Courtside</title></head>
    <body><h1>Just checking&hellip;</h1>
      <p>Before you can continue we need to verify that you're actually a person.</p>
      <div class="cf-turnstile" data-sitekey="0x4AAAAAAD_XMJ-DWaJIbiHD" data-theme="auto"></div>
      <script>function onTurnstileSuccess(token) { document.forms[0].submit(); }</script>
    </body></html>
  `;

  it("throws on the Turnstile interstitial instead of parsing it as zero slots", async () => {
    vi.mocked(proxyFetch).mockResolvedValue(makeMockResponse(turnstilePage) as never);

    await expect(scrapeCourtside("victoria-park", "2026-04-03")).rejects.toThrow(/Turnstile/);
  });

  it("detects the challenge by its /verify-human target alone", async () => {
    const withoutWidget = `
      <html><body><p>Please continue to
      <a href="/verify-human">verification</a> before booking a court at this venue.</p>
      </body></html>
    `;
    vi.mocked(proxyFetch).mockResolvedValue(makeMockResponse(withoutWidget) as never);

    await expect(scrapeCourtside("victoria-park", "2026-04-03")).rejects.toThrow(/Bot challenge/);
  });

  it("still returns an empty list for a genuine page with no bookable courts", async () => {
    // The distinction that matters: "no courts free" must stay a successful
    // empty parse, not an error, or every fully-booked venue-day looks blocked.
    const emptyButValid = `
      <html><head><title>Victoria Park — Tennis Tower Hamlets</title></head>
      <body><h1>Victoria Park</h1>
        <p>There are no courts available to book on this date. Please try another day.</p>
        <table><tr><th class="time">8am</th></tr></table>
      </body></html>
    `;
    vi.mocked(proxyFetch).mockResolvedValue(makeMockResponse(emptyButValid) as never);

    await expect(scrapeCourtside("victoria-park", "2026-04-03")).resolves.toEqual([]);
  });
});
