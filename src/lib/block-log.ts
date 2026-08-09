/**
 * Aggregated logging for blocked scanner probes.
 *
 * Scanner traffic is constant background noise on any public host, and one log
 * line per probe buries everything else — Railway's retention is finite, so the
 * drip evicts the logs you actually need during an incident. This counts probes
 * and emits a single summary per window instead.
 *
 * Exposed as a factory rather than module singletons so tests get a fresh
 * counter (and an injectable clock/sink) per case instead of leaking state.
 */

export const BLOCK_LOG_WINDOW_MS = 10 * 60_000;

/** Cap on distinct keys tracked per window. The key is attacker-controlled, so
 * a scanner walking thousands of unique paths must not grow the map without
 * bound; overflow still counts toward the total, bucketed under `other`. */
export const BLOCK_LOG_MAX_KEYS = 50;

export const OVERFLOW_KEY = "other";

/** Max label length kept for logging. */
export const LABEL_MAX_LENGTH = 80;

/**
 * Strip control characters and truncate. The label reaches `console.log`, and a
 * crafted path could otherwise embed newlines to forge log entries.
 */
export function safeLabel(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, LABEL_MAX_LENGTH);
}

export interface BlockLogger {
  /** Count one blocked request, flushing a summary when the window has elapsed. */
  record(rawLabel: string): void;
  /** Distinct keys currently tracked. Exposed for assertions on boundedness. */
  size(): number;
}

export function createBlockLogger(
  opts: {
    windowMs?: number;
    maxKeys?: number;
    log?: (message: string) => void;
    now?: () => number;
  } = {}
): BlockLogger {
  const windowMs = opts.windowMs ?? BLOCK_LOG_WINDOW_MS;
  const maxKeys = opts.maxKeys ?? BLOCK_LOG_MAX_KEYS;
  const log = opts.log ?? ((m: string) => console.log(m));
  const now = opts.now ?? (() => Date.now());

  const counts = new Map<string, number>();
  let windowStart = now();

  return {
    record(rawLabel: string): void {
      const label = safeLabel(rawLabel);
      // Keep counting a key we already track; only *new* keys hit the cap.
      const key = counts.has(label) || counts.size < maxKeys ? label : OVERFLOW_KEY;
      counts.set(key, (counts.get(key) ?? 0) + 1);

      const elapsed = now() - windowStart;
      if (elapsed < windowMs) return;

      let total = 0;
      for (const n of counts.values()) total += n;
      const top = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, n]) => `${k}×${n}`)
        .join(", ");

      log(
        `🚫 Blocked ${total} suspicious request(s) in the last ` +
          `${Math.round(elapsed / 60_000)}m (top: ${top})`
      );

      counts.clear();
      windowStart = now();
    },

    size(): number {
      return counts.size;
    },
  };
}
