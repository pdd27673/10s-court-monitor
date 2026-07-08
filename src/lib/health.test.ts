import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assessScrapeHealth } from "./health";

function slotsFor(counts: Record<string, number>): { venue: string }[] {
  const out: { venue: string }[] = [];
  for (const [venue, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) out.push({ venue });
  }
  return out;
}

describe("assessScrapeHealth", () => {
  const original = process.env.SCRAPE_MIN_SLOTS_PER_TARGET;
  beforeEach(() => {
    delete process.env.SCRAPE_MIN_SLOTS_PER_TARGET;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SCRAPE_MIN_SLOTS_PER_TARGET;
    else process.env.SCRAPE_MIN_SLOTS_PER_TARGET = original;
  });

  it("is healthy when slots were parsed", () => {
    const r = assessScrapeHealth({
      slots: slotsFor({ "victoria-park": 40, "ropemakers-field": 30 }),
      targetsScraped: 10,
    });
    expect(r.healthy).toBe(true);
    expect(r.total).toBe(70);
    expect(r.perVenue["victoria-park"]).toBe(40);
  });

  it("is unhealthy when targets were scraped but zero slots parsed", () => {
    const r = assessScrapeHealth({ slots: [], targetsScraped: 12 });
    expect(r.healthy).toBe(false);
    expect(r.reason).toMatch(/0 slots/i);
  });

  it("ignores runs where nothing was due (no targets scraped)", () => {
    const r = assessScrapeHealth({ slots: [], targetsScraped: 0 });
    expect(r.healthy).toBe(true);
  });

  it("flags a low slots-per-target ratio when the threshold is set", () => {
    process.env.SCRAPE_MIN_SLOTS_PER_TARGET = "1";
    const r = assessScrapeHealth({
      slots: slotsFor({ "victoria-park": 3 }),
      targetsScraped: 40,
    });
    expect(r.healthy).toBe(false);
    expect(r.reason).toMatch(/per target|partial/i);
  });

  it("does not flag a low ratio when the threshold is unset (default)", () => {
    const r = assessScrapeHealth({
      slots: slotsFor({ "victoria-park": 3 }),
      targetsScraped: 40,
    });
    expect(r.healthy).toBe(true);
  });
});
