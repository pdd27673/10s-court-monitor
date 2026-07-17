import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { initTestDb, truncateAll, testDb } from "../test/pglite";
import { slots, feedState, venues } from "./schema";

beforeAll(initTestDb);
beforeEach(truncateAll);

describe("migration chain (0000 → latest)", () => {
  it("drops scrape_targets (retired blind path)", async () => {
    const r = (await testDb().execute(sql`select to_regclass('scrape_targets') as t`)) as unknown as {
      rows: { t: string | null }[];
    };
    expect(r.rows[0].t).toBeNull();
  });

  it("keeps the feed-primary tables", async () => {
    for (const table of ["venues", "courts", "slots", "feed_state", "watches", "users"]) {
      const r = (await testDb().execute(sql`select to_regclass(${table}) as t`)) as unknown as {
        rows: { t: string | null }[];
      };
      expect(r.rows[0].t).not.toBeNull();
    }
  });
});

describe("constraints enforced by the real schema", () => {
  it("rejects duplicate (venue,date,time,court) slots", async () => {
    const [v] = await testDb().insert(venues).values({ slug: "v", name: "V" }).returning({ id: venues.id });
    const row = { venueId: v.id, date: "2026-07-17", time: "7pm", court: "Court 1", status: "booked" };
    await testDb().insert(slots).values(row);
    await expect(testDb().insert(slots).values(row)).rejects.toThrow();
  });

  it("rejects duplicate (source,feed) feed_state rows", async () => {
    await testDb().insert(feedState).values({ source: "clock", feed: "sweep", lastPolledAt: "x" });
    await expect(
      testDb().insert(feedState).values({ source: "clock", feed: "sweep", lastPolledAt: "y" })
    ).rejects.toThrow();
  });
});
