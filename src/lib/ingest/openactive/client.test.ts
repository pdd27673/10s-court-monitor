import { describe, it, expect, vi, afterEach } from "vitest";
import { walkToHead, collectLatest, fetchPage, type RpdeItem } from "./client";

function mockFetchPages(pages: Record<string, unknown>) {
  const fn = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => pages[url],
  }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("walkToHead", () => {
  it("pages forward through `next` to the head, invoking onItems per non-empty page", async () => {
    mockFetchPages({
      u1: { next: "u2", items: [{ state: "updated", id: 1 }] },
      u2: { next: "u3", items: [{ state: "updated", id: 2 }] },
      u3: { next: "u3", items: [] }, // head: empty page whose next points at itself
    });

    const seen: RpdeItem[] = [];
    const r = await walkToHead("u1", (items) => { seen.push(...items); }, { paceMs: 0 });

    expect(r.pages).toBe(3);
    expect(r.items).toBe(2);
    expect(r.cursor).toBe("u3");
    expect(seen.map((i) => i.id)).toEqual([1, 2]);
  });

  it("treats a non-empty page whose next equals the current url as the head (stops after it)", async () => {
    mockFetchPages({ u1: { next: "u1", items: [{ state: "updated", id: 7 }] } });
    const r = await walkToHead("u1", () => {}, { paceMs: 0 });
    expect(r.pages).toBe(1);
    expect(r.items).toBe(1);
    expect(r.cursor).toBe("u1");
  });

  it("respects maxPages as a safety cap", async () => {
    // an infinite feed that never reaches head
    const fn = vi.fn(async (url: string) => ({
      ok: true, status: 200, statusText: "OK",
      json: async () => ({ next: url + "x", items: [{ state: "updated", id: 1 }] }),
    }));
    vi.stubGlobal("fetch", fn);

    const r = await walkToHead("u", () => {}, { paceMs: 0, maxPages: 3 });
    expect(r.pages).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("fetchPage", () => {
  it("throws on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, statusText: "Service Unavailable" })));
    await expect(fetchPage("u")).rejects.toThrow(/503/);
  });

  it("throws when the payload has no items[] array", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ next: "u" }) })));
    await expect(fetchPage("u")).rejects.toThrow(/missing items/);
  });
});

describe("walkToHead – progress logging", () => {
  it("logs every `progressEvery` pages when a label is set", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fn = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ next: url + "x", items: [{ state: "updated", id: 1 }] }),
    }));
    vi.stubGlobal("fetch", fn);

    await walkToHead("u", () => {}, { paceMs: 0, maxPages: 6, label: "slots", progressEvery: 2 });

    const lines = log.mock.calls.flat().join("\n");
    expect(lines).toContain("slots: walked 2 pages");
    expect(lines).toContain("slots: walked 4 pages");
    log.mockRestore();
  });

  it("stays silent when no label is given", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    mockFetchPages({ u1: { next: "u1", items: [] } });

    await walkToHead("u1", () => {}, { paceMs: 0, progressEvery: 1 });

    expect(log.mock.calls.flat().join("\n")).not.toContain("walked");
    log.mockRestore();
  });
});

describe("collectLatest", () => {
  it("keeps the latest updated item per id", async () => {
    mockFetchPages({
      u1: {
        next: "u2",
        items: [
          { state: "updated", id: "a", data: { v: 1 } },
          { state: "updated", id: "b", data: { v: 1 } },
        ],
      },
      u2: { next: "u2", items: [{ state: "updated", id: "a", data: { v: 2 } }] },
    });

    const { latest, deleted, walk } = await collectLatest("u1", { paceMs: 0 });

    expect([...latest.keys()].sort()).toEqual(["a", "b"]);
    // A later "updated" for the same id must win — RPDE upsert semantics.
    expect((latest.get("a")!.data as { v: number }).v).toBe(2);
    expect(deleted).toBe(0);
    expect(walk.cursor).toBe("u2");
  });

  it("drops an id when a tombstone arrives and counts the delete", async () => {
    mockFetchPages({
      u1: { next: "u2", items: [{ state: "updated", id: "a" }, { state: "updated", id: "b" }] },
      u2: { next: "u2", items: [{ state: "deleted", id: "a" }] },
    });

    const { latest, deleted } = await collectLatest("u1", { paceMs: 0 });

    expect([...latest.keys()]).toEqual(["b"]);
    expect(deleted).toBe(1);
  });

  it("re-adds an id that is deleted then updated again", async () => {
    mockFetchPages({
      u1: { next: "u2", items: [{ state: "updated", id: "a", data: { v: 1 } }] },
      u2: { next: "u3", items: [{ state: "deleted", id: "a" }] },
      u3: { next: "u3", items: [{ state: "updated", id: "a", data: { v: 3 } }] },
    });

    const { latest, deleted } = await collectLatest("u1", { paceMs: 0 });

    expect((latest.get("a")!.data as { v: number }).v).toBe(3);
    expect(deleted).toBe(1);
  });

  it("normalises numeric ids to strings so they collapse onto one key", async () => {
    mockFetchPages({
      u1: { next: "u2", items: [{ state: "updated", id: 7, data: { v: 1 } }] },
      u2: { next: "u2", items: [{ state: "updated", id: "7", data: { v: 2 } }] },
    });

    const { latest } = await collectLatest("u1", { paceMs: 0 });

    expect(latest.size).toBe(1);
    expect((latest.get("7")!.data as { v: number }).v).toBe(2);
  });

  it("returns an empty map for a feed already at head", async () => {
    mockFetchPages({ u1: { next: "u1", items: [] } });

    const { latest, deleted, walk } = await collectLatest("u1", { paceMs: 0 });

    expect(latest.size).toBe(0);
    expect(deleted).toBe(0);
    expect(walk.pages).toBe(1);
  });
});
