import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Venue } from "../constants";

const scrapeCourtside = vi.fn();
vi.mock("./courtside", () => ({ scrapeCourtside: (...a: unknown[]) => scrapeCourtside(...a) }));
// clubspark is re-exported by the barrel; stub it so importing the barrel is cheap.
vi.mock("./clubspark", () => ({ scrapeClubSpark: vi.fn() }));

import { scrapeVenue } from "./index";

describe("scrapeVenue", () => {
  beforeEach(() => scrapeCourtside.mockReset());

  it("delegates to scrapeCourtside with the venue slug and date", async () => {
    const rows = [{ date: "2026-07-17", time: "5pm", court: "Court 1", status: "available" }];
    scrapeCourtside.mockResolvedValue(rows);

    const venue = { slug: "victoria-park", name: "Victoria Park", type: "courtside" } as Venue;
    const out = await scrapeVenue(venue, "2026-07-17");

    expect(scrapeCourtside).toHaveBeenCalledWith("victoria-park", "2026-07-17");
    expect(out).toBe(rows);
  });
});
