import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SlotChange } from "../differ";
import type { ScrapeStats } from "./email";

// Mock resend before the module under test imports it.
const mockEmailSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockEmailSend } })),
}));

function change(over: Partial<SlotChange> = {}): SlotChange {
  return {
    venue: "victoria-park",
    venueName: "Victoria Park",
    date: "2026-07-20",
    time: "5pm",
    court: "Court 1",
    oldStatus: "booked",
    newStatus: "available",
    ...over,
  };
}

function makeStats(over: Partial<ScrapeStats> = {}): ScrapeStats {
  return {
    durationMs: 1000,
    durationFormatted: "1.0s",
    totalRequests: 10,
    totalBytes: 1024,
    totalBytesFormatted: "1KB",
    venuesTotal: 10,
    venuesSuccess: 10,
    venuesFailed: 0,
    datesScraped: 8,
    slotsScraped: 100,
    failedVenues: [],
    ...over,
  };
}

beforeEach(() => {
  vi.resetModules();
  mockEmailSend.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("formatSlotChangesForEmail", () => {
  it("returns empty subject/html for no changes", async () => {
    const { formatSlotChangesForEmail } = await import("./email");
    expect(formatSlotChangesForEmail([])).toEqual({ subject: "", html: "" });
  });

  it("uses a singular subject for one slot and plural for many", async () => {
    const { formatSlotChangesForEmail } = await import("./email");
    expect(formatSlotChangesForEmail([change()]).subject).toBe("1 tennis court now available");
    expect(
      formatSlotChangesForEmail([change({ time: "5pm" }), change({ time: "6pm", court: "Court 2" })]).subject
    ).toBe("2 tennis courts now available");
  });

  it("groups by venue/date, sorts slots by time, and escapes names", async () => {
    const { formatSlotChangesForEmail } = await import("./email");
    const { html } = formatSlotChangesForEmail([
      change({ time: "6pm", court: "Court 2", venueName: "A & B" }),
      change({ time: "10am", court: "Court 1", venueName: "A & B" }),
    ]);
    expect(html).toContain("A &amp; B");
    // 10am should be rendered before 6pm after the time sort
    expect(html.indexOf("10am")).toBeLessThan(html.indexOf("6pm"));
  });

  it("renders the price when present", async () => {
    const { formatSlotChangesForEmail } = await import("./email");
    const { html } = formatSlotChangesForEmail([change({ price: "£8" })]);
    expect(html).toContain("£8");
  });
});

describe("sendEmail", () => {
  it("no-ops when RESEND_API_KEY is unset", async () => {
    const { sendEmail } = await import("./email");
    await sendEmail("to@test.com", "subj", "<p/>");
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("sends via Resend when configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "noreply@test.com");
    mockEmailSend.mockResolvedValue({ data: { id: "e1" }, error: null });

    const { sendEmail } = await import("./email");
    await sendEmail("to@test.com", "subj", "<p>hi</p>");

    expect(mockEmailSend).toHaveBeenCalledWith({
      from: "noreply@test.com",
      to: "to@test.com",
      subject: "subj",
      html: "<p>hi</p>",
    });
  });

  it("throws when EMAIL_FROM is missing but a key is set", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "");
    const { sendEmail } = await import("./email");
    await expect(sendEmail("to@test.com", "s", "h")).rejects.toThrow("EMAIL_FROM");
  });

  it("throws when Resend returns an error", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "noreply@test.com");
    mockEmailSend.mockResolvedValue({ error: { message: "domain not verified" } });

    const { sendEmail } = await import("./email");
    await expect(sendEmail("to@test.com", "s", "h")).rejects.toThrow("Resend error: domain not verified");
  });
});

describe("sendScrapeSummary", () => {
  it("returns false when resend/admin aren't configured", async () => {
    const { sendScrapeSummary } = await import("./email");
    expect(await sendScrapeSummary(makeStats())).toBe(false);
  });

  it("returns false when LOG_SCRAPE_SUMMARY isn't 'true'", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "noreply@test.com");
    vi.stubEnv("ADMIN_EMAIL", "admin@test.com");
    vi.stubEnv("LOG_SCRAPE_SUMMARY", "false");
    const { sendScrapeSummary } = await import("./email");
    expect(await sendScrapeSummary(makeStats())).toBe(false);
  });

  it("sends and returns true when enabled", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("EMAIL_FROM", "noreply@test.com");
    vi.stubEnv("ADMIN_EMAIL", "admin@test.com");
    vi.stubEnv("LOG_SCRAPE_SUMMARY", "true");
    mockEmailSend.mockResolvedValue({ error: null });

    const { sendScrapeSummary } = await import("./email");
    expect(await sendScrapeSummary(makeStats({ venuesFailed: 2, venuesSuccess: 8 }))).toBe(true);
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
  });
});
