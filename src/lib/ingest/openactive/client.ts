/**
 * Minimal RPDE (Real-time Paged Data Exchange) client for the OpenActive feeds.
 *
 * A feed page is `{ next, items[], license }`. Items carry `state`
 * ("updated" | "deleted"), `kind`, `id`, `modified`, and (for "updated") `data`.
 * You page forward through `next` to the head; the head is reached when a page
 * returns no items and its `next` equals the URL you just requested. Persist
 * that head cursor and poll it on a timer to receive only what changed.
 *
 * Do NOT fabricate cursors — the server issues the exact `next` to follow.
 * Attribution: data © Courtside Hubs CIC, CC-BY 4.0.
 */

export const OPENACTIVE_BASE = "https://api.premiertennis.co.uk/openactive/feed";
export const FEED_FACILITY_USES = `${OPENACTIVE_BASE}/facility-uses`;
export const FEED_SLOTS = `${OPENACTIVE_BASE}/individual-facility-use-slots`;

export type RpdeState = "updated" | "deleted";

export interface RpdeItem<T = unknown> {
  state: RpdeState;
  kind: string;
  id: string | number;
  modified: number;
  data?: T;
}

export interface RpdePage<T = unknown> {
  next: string;
  license?: string;
  items: RpdeItem<T>[];
}

const USER_AGENT = "10s-court-monitor (+https://timefor10s.com; CC-BY OpenActive consumer)";

export async function fetchPage<T = unknown>(url: string, signal?: AbortSignal): Promise<RpdePage<T>> {
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.openactive.rpde+json, application/json", "User-Agent": USER_AGENT },
    signal,
  });
  if (!res.ok) throw new Error(`RPDE fetch ${res.status} ${res.statusText} for ${url}`);
  const page = (await res.json()) as RpdePage<T>;
  if (!Array.isArray(page.items)) throw new Error(`RPDE page missing items[] for ${url}`);
  return page;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WalkOptions {
  /** ms between page fetches — the server throttles rapid firing (default 350). */
  paceMs?: number;
  /** safety cap on pages per walk (default 5000). */
  maxPages?: number;
  signal?: AbortSignal;
}

export interface WalkResult {
  /** the head cursor to persist and poll next time. */
  cursor: string;
  pages: number;
  items: number;
}

/**
 * Walk from `startUrl` to the feed head, invoking `onItems` for each page's
 * items. Returns the head cursor. If `startUrl` is already the head, this makes
 * a single request and returns immediately (this is how polling works too).
 */
export async function walkToHead<T = unknown>(
  startUrl: string,
  onItems: (items: RpdeItem<T>[], page: RpdePage<T>) => Promise<void> | void,
  opts: WalkOptions = {}
): Promise<WalkResult> {
  const { paceMs = 350, maxPages = 5000, signal } = opts;
  let url = startUrl;
  let pages = 0;
  let items = 0;

  while (pages < maxPages) {
    const page = await fetchPage<T>(url, signal);
    pages++;
    if (page.items.length > 0) {
      items += page.items.length;
      await onItems(page.items, page);
    }
    // Head reached: RPDE signals it with an empty page whose `next` points back
    // at the same cursor. Persist `page.next` and stop.
    if (page.items.length === 0 || !page.next || page.next === url) {
      return { cursor: page.next || url, pages, items };
    }
    url = page.next;
    if (paceMs > 0) await sleep(paceMs);
  }
  return { cursor: url, pages, items };
}
