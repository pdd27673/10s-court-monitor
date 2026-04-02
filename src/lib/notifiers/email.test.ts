import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ScrapeStats } from "../scraper";

// Mock resend before any module imports
const mockEmailSend = vi.fn();
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockEmailSend },
  })),
}));

function makeStats(venuesSuccess: number, venuesFailed: number): ScrapeStats {
  const total = venuesSuccess + venuesFailed;
  return {
    durationMs: 1000,
    durationFormatted: "1.0s",
    totalRequests: total,
    totalBytes: 1024,
    totalBytesFormatted: "1KB",
    venuesTotal: total,
    venuesSuccess,
    venuesFailed,
    datesScraped: 8,
    slotsScraped: 100,
    failedVenues: Array.from({ length: venuesFailed }, (_, i) => `venue-${i}`),
  };
}

// Re-import the module fresh before each test so lastFailureAlertAt resets
let sendScrapeFailureAlert: (stats: ScrapeStats) => Promise<boolean>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("ADMIN_EMAIL", "admin@test.com");
  vi.stubEnv("EMAIL_FROM", "noreply@test.com");
  vi.stubEnv("SCRAPE_FAILURE_THRESHOLD", "40");
  vi.stubEnv("SCRAPE_ALERT_COOLDOWN_HOURS", "1");

  mockEmailSend.mockClear();
  mockEmailSend.mockResolvedValue({ data: { id: "test-id" }, error: null });

  const emailModule = await import("./email");
  sendScrapeFailureAlert = emailModule.sendScrapeFailureAlert;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("sendScrapeFailureAlert – threshold", () => {
  it("does not send alert when failure rate is below 40%", async () => {
    // 3 failures out of 10 = 30%
    const sent = await sendScrapeFailureAlert(makeStats(7, 3));
    expect(sent).toBe(false);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("does not send alert when failure rate is exactly below threshold (39%)", async () => {
    // ~39% failures
    const sent = await sendScrapeFailureAlert(makeStats(61, 39));
    expect(sent).toBe(false);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("sends alert when failure rate is exactly 40%", async () => {
    // 4 failures out of 10 = 40%
    const sent = await sendScrapeFailureAlert(makeStats(6, 4));
    expect(sent).toBe(true);
    expect(mockEmailSend).toHaveBeenCalledOnce();
  });

  it("sends alert when failure rate is above 40%", async () => {
    // 6 failures out of 10 = 60%
    const sent = await sendScrapeFailureAlert(makeStats(4, 6));
    expect(sent).toBe(true);
    expect(mockEmailSend).toHaveBeenCalledOnce();
  });

  it("respects SCRAPE_FAILURE_THRESHOLD env override", async () => {
    vi.stubEnv("SCRAPE_FAILURE_THRESHOLD", "60");
    vi.resetModules();
    const emailModule = await import("./email");
    sendScrapeFailureAlert = emailModule.sendScrapeFailureAlert;

    // 50% — below custom 60% threshold, no alert
    const notSent = await sendScrapeFailureAlert(makeStats(5, 5));
    expect(notSent).toBe(false);

    // 70% — above custom 60% threshold, alert sent
    const sent = await sendScrapeFailureAlert(makeStats(3, 7));
    expect(sent).toBe(true);
  });
});

describe("sendScrapeFailureAlert – cooldown", () => {
  it("suppresses a second alert within the cooldown window", async () => {
    vi.useFakeTimers();

    const stats = makeStats(4, 6); // 60% — above threshold

    const first = await sendScrapeFailureAlert(stats);
    expect(first).toBe(true);
    expect(mockEmailSend).toHaveBeenCalledOnce();

    // Try again immediately — should be suppressed
    const second = await sendScrapeFailureAlert(stats);
    expect(second).toBe(false);
    expect(mockEmailSend).toHaveBeenCalledOnce(); // still only once
  });

  it("sends alert again after cooldown expires", async () => {
    vi.useFakeTimers();

    const stats = makeStats(4, 6); // 60%

    const first = await sendScrapeFailureAlert(stats);
    expect(first).toBe(true);

    // Advance past the 1-hour cooldown
    vi.advanceTimersByTime(61 * 60 * 1000);

    const second = await sendScrapeFailureAlert(stats);
    expect(second).toBe(true);
    expect(mockEmailSend).toHaveBeenCalledTimes(2);
  });

  it("respects SCRAPE_ALERT_COOLDOWN_HOURS env override", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SCRAPE_ALERT_COOLDOWN_HOURS", "2");
    vi.resetModules();
    const emailModule = await import("./email");
    sendScrapeFailureAlert = emailModule.sendScrapeFailureAlert;

    const stats = makeStats(4, 6); // 60%

    await sendScrapeFailureAlert(stats);

    // After 90 min — still within 2h cooldown
    vi.advanceTimersByTime(90 * 60 * 1000);
    const suppressed = await sendScrapeFailureAlert(stats);
    expect(suppressed).toBe(false);

    // After another 31 min (total 121 min) — past 2h cooldown
    vi.advanceTimersByTime(31 * 60 * 1000);
    const sent = await sendScrapeFailureAlert(stats);
    expect(sent).toBe(true);
  });
});
