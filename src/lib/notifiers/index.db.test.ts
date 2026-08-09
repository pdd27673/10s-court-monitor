import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { dbProxy, initTestDb, truncateAll, testDb } from "../../test/pglite";
import { users, venues, watches, notificationChannels, notificationLog } from "../schema";
import { eq } from "drizzle-orm";
import type { SlotChange } from "../differ";

// DB → PGlite; senders → spies (so no real Telegram/email traffic and we can
// assert exactly what would be dispatched).
vi.mock("../db", () => ({ db: dbProxy }));

const sendTelegramMessage = vi.fn();
const sendEmail = vi.fn();
vi.mock("./telegram", () => ({
  sendTelegramMessage: (...a: unknown[]) => sendTelegramMessage(...a),
  formatSlotChangesForTelegram: (c: SlotChange[]) => `telegram:${c.length}`,
}));
vi.mock("./email", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...a),
  formatSlotChangesForEmail: (c: SlotChange[]) => ({ subject: `email:${c.length}`, html: "<p/>" }),
  sendScrapeFailureAlert: vi.fn(),
  sendScrapeSummary: vi.fn(),
}));

import { notifyUsers } from "./index";

beforeAll(initTestDb);
beforeEach(async () => {
  await truncateAll();
  sendTelegramMessage.mockReset();
  sendEmail.mockReset();
});

// 2026-07-20 is a Monday; a Saturday would be 2026-07-18.
const MONDAY = "2026-07-20";

function change(over: Partial<SlotChange> = {}): SlotChange {
  return {
    venue: "victoria-park",
    venueName: "Victoria Park",
    date: MONDAY,
    time: "5pm",
    court: "Court 1",
    oldStatus: "booked",
    newStatus: "available",
    ...over,
  };
}

async function seedUserVenue(): Promise<{ userId: number; venueId: number }> {
  const [u] = await testDb().insert(users).values({ email: "a@test.com" }).returning({ id: users.id });
  const [v] = await testDb()
    .insert(venues)
    .values({ slug: "victoria-park", name: "Victoria Park" })
    .returning({ id: venues.id });
  return { userId: u.id, venueId: v.id };
}

describe("notifyUsers", () => {
  it("returns early on no changes (no channels touched)", async () => {
    await notifyUsers([]);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends one bundled Telegram message for a matching watch and logs it", async () => {
    const { userId, venueId } = await seedUserVenue();
    await testDb().insert(watches).values({
      userId,
      venueId,
      dayTimes: JSON.stringify({ monday: ["5pm", "6pm"] }),
      active: 1,
    });
    await testDb().insert(notificationChannels).values({
      userId,
      type: "telegram",
      destination: "chat-1",
      active: 1,
    });

    await notifyUsers([change({ time: "5pm" }), change({ time: "6pm", court: "Court 2" })]);

    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
    expect(sendTelegramMessage).toHaveBeenCalledWith("chat-1", "telegram:2");
    const logs = await testDb().select().from(notificationLog);
    expect(logs).toHaveLength(2);
  });

  it("deduplicates already-notified slots on a second run", async () => {
    const { userId, venueId } = await seedUserVenue();
    await testDb().insert(watches).values({
      userId,
      venueId,
      dayTimes: JSON.stringify({ monday: ["5pm"] }),
      active: 1,
    });
    await testDb().insert(notificationChannels).values({
      userId,
      type: "telegram",
      destination: "chat-1",
      active: 1,
    });

    await notifyUsers([change()]);
    await notifyUsers([change()]); // same slot again

    expect(sendTelegramMessage).toHaveBeenCalledTimes(1); // second run is a no-op
    const logs = await testDb().select().from(notificationLog);
    expect(logs).toHaveLength(1);
  });

  it("routes email channels through sendEmail", async () => {
    const { userId, venueId } = await seedUserVenue();
    await testDb().insert(watches).values({
      userId,
      venueId,
      dayTimes: JSON.stringify({ monday: ["5pm"] }),
      active: 1,
    });
    await testDb().insert(notificationChannels).values({
      userId,
      type: "email",
      destination: "a@test.com",
      active: 1,
    });

    await notifyUsers([change()]);

    expect(sendEmail).toHaveBeenCalledWith("a@test.com", "email:1", "<p/>");
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("skips an unsupported channel type without logging or sending", async () => {
    const { userId, venueId } = await seedUserVenue();
    await testDb().insert(watches).values({
      userId,
      venueId,
      dayTimes: JSON.stringify({ monday: ["5pm"] }),
      active: 1,
    });
    await testDb().insert(notificationChannels).values({
      userId,
      type: "whatsapp",
      destination: "+44",
      active: 1,
    });

    await notifyUsers([change()]);

    expect(sendTelegramMessage).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    const logs = await testDb().select().from(notificationLog);
    expect(logs).toHaveLength(0);
  });

  it("matches an all-venues watch (venueId null) via the legacy weekday field", async () => {
    const { userId } = await seedUserVenue();
    await testDb().insert(watches).values({
      userId,
      venueId: null,
      weekdayTimes: JSON.stringify(["5pm"]), // Monday is a weekday
      active: 1,
    });
    await testDb().insert(notificationChannels).values({
      userId,
      type: "telegram",
      destination: "chat-1",
      active: 1,
    });

    await notifyUsers([change()]);
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("does not notify when the time isn't in the watch's preferred list", async () => {
    const { userId, venueId } = await seedUserVenue();
    await testDb().insert(watches).values({
      userId,
      venueId,
      dayTimes: JSON.stringify({ monday: ["9am"] }),
      active: 1,
    });
    await testDb().insert(notificationChannels).values({
      userId,
      type: "telegram",
      destination: "chat-1",
      active: 1,
    });

    await notifyUsers([change({ time: "5pm" })]);
    expect(sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("matches across time formats: canonical HH:MM watch vs am/pm slot label", async () => {
    const { userId, venueId } = await seedUserVenue();
    await testDb().insert(watches).values({
      userId,
      venueId,
      dayTimes: JSON.stringify({ monday: ["17:00"] }), // canonical form
      active: 1,
    });
    await testDb().insert(notificationChannels).values({
      userId,
      type: "telegram",
      destination: "chat-1",
      active: 1,
    });

    await notifyUsers([change({ time: "5pm" })]); // legacy label — must still match
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("matches across time formats: am/pm watch vs canonical HH:MM slot label", async () => {
    const { userId, venueId } = await seedUserVenue();
    await testDb().insert(watches).values({
      userId,
      venueId,
      dayTimes: JSON.stringify({ monday: ["5pm"] }), // legacy form
      active: 1,
    });
    await testDb().insert(notificationChannels).values({
      userId,
      type: "telegram",
      destination: "chat-1",
      active: 1,
    });

    await notifyUsers([change({ time: "17:00" })]); // canonical label — must still match
    expect(sendTelegramMessage).toHaveBeenCalledTimes(1);
  });

  it("does not log a send that threw", async () => {
    const { userId, venueId } = await seedUserVenue();
    await testDb().insert(watches).values({
      userId,
      venueId,
      dayTimes: JSON.stringify({ monday: ["5pm"] }),
      active: 1,
    });
    await testDb().insert(notificationChannels).values({
      userId,
      type: "telegram",
      destination: "chat-1",
      active: 1,
    });
    sendTelegramMessage.mockRejectedValueOnce(new Error("telegram down"));

    await notifyUsers([change()]);

    const logs = await testDb().select().from(notificationLog).where(eq(notificationLog.userId, userId));
    expect(logs).toHaveLength(0); // failed send is not recorded → retried next tick
  });
});
