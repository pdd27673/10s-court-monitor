import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SlotChange } from "../differ";

function change(over: Partial<SlotChange> = {}): SlotChange {
  return {
    venue: "victoria-park",
    venueName: "Victoria Park",
    date: "2026-07-18",
    time: "5pm",
    court: "Court 1",
    oldStatus: "booked",
    newStatus: "available",
    ...over,
  };
}

describe("formatSlotChangesForTelegram", () => {
  it("returns an empty string for no changes", async () => {
    const { formatSlotChangesForTelegram } = await import("./telegram");
    expect(formatSlotChangesForTelegram([])).toBe("");
  });

  it("groups by venue+date and lists each slot with its price", async () => {
    const { formatSlotChangesForTelegram } = await import("./telegram");
    const msg = formatSlotChangesForTelegram([
      change({ time: "5pm", court: "Court 1", price: "£8" }),
      change({ time: "6pm", court: "Court 2" }),
      change({ venue: "west-ham-park", venueName: "West Ham Park", date: "2026-07-19", time: "9am", court: "Court 3" }),
    ]);
    expect(msg).toContain("🎾 <b>Tennis courts now available!</b>");
    // one venue header per group
    expect(msg).toContain("<b>Victoria Park</b>");
    expect(msg).toContain("<b>West Ham Park</b>");
    // slot lines
    expect(msg).toContain("5pm - Court 1 (£8)");
    expect(msg).toContain("6pm - Court 2");
    expect(msg).toContain("🔗 Book online to reserve your slot");
  });

  it("escapes HTML-significant characters in venue names", async () => {
    const { formatSlotChangesForTelegram } = await import("./telegram");
    const msg = formatSlotChangesForTelegram([change({ venueName: "A & B <club>" })]);
    expect(msg).toContain("A &amp; B &lt;club&gt;");
  });
});

describe("sendTelegramMessage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("no-ops (no fetch) when TELEGRAM_BOT_TOKEN is unset", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { sendTelegramMessage } = await import("./telegram");
    await sendTelegramMessage("chat-1", "hi");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs to the Telegram API and returns the parsed body on success", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { sendTelegramMessage } = await import("./telegram");
    const out = await sendTelegramMessage("chat-1", "hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/bottest-token/sendMessage");
    expect(JSON.parse(init.body)).toMatchObject({ chat_id: "chat-1", text: "hello", parse_mode: "HTML" });
    expect(out).toMatchObject({ ok: true });
  });

  it("throws when the Telegram API responds non-ok", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, text: async () => "chat not found" })
    );

    const { sendTelegramMessage } = await import("./telegram");
    await expect(sendTelegramMessage("bad", "hello")).rejects.toThrow("Telegram API error: chat not found");
  });
});
