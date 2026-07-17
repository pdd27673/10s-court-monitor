import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { dbProxy, initTestDb, truncateAll, testDb } from "../test/pglite";
import { venues } from "./schema";
import { VENUES } from "./constants";

// Point the differ's `db` singleton at the in-process PGlite instance.
vi.mock("./db", () => ({ db: dbProxy }));

import { ensureVenuesExist } from "./differ";

beforeAll(initTestDb);
beforeEach(truncateAll);

describe("ensureVenuesExist", () => {
  it("inserts every statically-configured venue into an empty DB", async () => {
    await ensureVenuesExist();

    const rows = await testDb().select({ slug: venues.slug }).from(venues);
    const slugs = rows.map((r) => r.slug).sort();
    expect(slugs).toEqual([...VENUES.map((v) => v.slug)].sort());
  });

  it("is idempotent — a second run creates no duplicates", async () => {
    await ensureVenuesExist();
    await ensureVenuesExist();

    const rows = await testDb().select({ slug: venues.slug }).from(venues);
    expect(rows).toHaveLength(VENUES.length);
  });

  it("preserves an existing venue row instead of re-inserting it", async () => {
    // Pre-seed one venue with a curated name; ensureVenuesExist must leave it be.
    const target = VENUES[0];
    await testDb().insert(venues).values({ slug: target.slug, name: "Curated Name" });

    await ensureVenuesExist();

    const rows = await testDb()
      .select({ slug: venues.slug, name: venues.name })
      .from(venues);
    const seeded = rows.find((r) => r.slug === target.slug);
    expect(seeded?.name).toBe("Curated Name");
    expect(rows).toHaveLength(VENUES.length);
  });
});
