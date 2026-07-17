import { describe, it, expect, vi, afterEach } from "vitest";
import { walkToHead, fetchPage, type RpdeItem } from "./client";

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
