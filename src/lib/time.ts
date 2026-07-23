/**
 * Canonical time helpers — one place that turns every time representation in the
 * app into a single comparable form: **minute-of-day** (0–1439, venue-local wall
 * clock). Phase 6 uses this to kill the old `"7pm"`-string-equality coupling in
 * matching: slots and watch preferences are compared as integers, not labels.
 *
 * Two on-the-wire string forms exist and both round-trip through here:
 *   • canonical  "HH:MM"  (24h, e.g. "19:00") — what we store/emit going forward.
 *   • legacy     am/pm    (e.g. "7pm", "12am", "7:30pm") — the scraper labels and
 *                          pre-migration watch data.
 * `anyToMinutes` accepts either, so matching stays correct through a mixed-format
 * DB and the dayTimes migration is cleanup, not a flag-day.
 *
 * Display stays friendly: `minutesToLabel` renders am/pm for the UI even though
 * storage is canonical HH:MM.
 */

/** Parse a canonical "HH:MM" (24h) to minute-of-day, or null if malformed. */
export function hhmmToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Minute-of-day → canonical "HH:MM" (zero-padded 24h). */
export function minutesToHhmm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Parse a legacy am/pm label ("7pm", "12am", "7:30pm", "12pm") to minute-of-day,
 * or null if it isn't an am/pm label. Whole-hour and half-hour tolerant. */
export function labelToMinutes(label: string): number | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(label.trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const period = m[3].toLowerCase();
  if (h < 1 || h > 12 || min > 59) return null;
  if (period === "am") {
    if (h === 12) h = 0; // 12am = midnight
  } else {
    if (h !== 12) h += 12; // 1pm..11pm; 12pm stays noon
  }
  return h * 60 + min;
}

/** Accept EITHER canonical "HH:MM" or a legacy am/pm label → minute-of-day.
 * The one entry point matching code should use, so old and new data compare
 * equal. Returns null for anything unparseable. */
export function anyToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  // Canonical form first (has a colon and no am/pm suffix).
  if (/^\d{1,2}:\d{2}$/.test(v)) return hhmmToMinutes(v);
  return labelToMinutes(v);
}

/** Minute-of-day → friendly am/pm display label ("7pm", "12am", "7:30pm"),
 * matching the scraper's whole-hour style but rendering minutes when present. */
export function minutesToLabel(minutes: number): string {
  const total = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const min = total % 60;
  const period = h24 < 12 ? "am" : "pm";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return min === 0 ? `${h12}${period}` : `${h12}:${String(min).padStart(2, "0")}${period}`;
}

/** Normalise any accepted form to canonical "HH:MM"; null if unparseable.
 * Used on the write path (watch APIs, migration) so storage is consistent. */
export function toHhmm(value: string | null | undefined): string | null {
  const mins = anyToMinutes(value);
  return mins == null ? null : minutesToHhmm(mins);
}

/** Any accepted form → friendly am/pm display label; null if unparseable. The
 * read-side counterpart of `toHhmm`: the web UI stores/sends canonical HH:MM but
 * renders am/pm, so it maps API values through this on hydration. */
export function toLabel(value: string | null | undefined): string | null {
  const mins = anyToMinutes(value);
  return mins == null ? null : minutesToLabel(mins);
}

/** Map a per-day time preferences object through a per-value transform, dropping
 * entries the transform can't parse (returns null). Shared by the canonical-write
 * and label-display helpers below so both treat malformed input identically. */
function mapDayTimes(
  dayTimes: Record<string, string[]> | null | undefined,
  fn: (v: string) => string | null
): Record<string, string[]> | null {
  if (!dayTimes) return dayTimes ?? null;
  const out: Record<string, string[]> = {};
  for (const [day, times] of Object.entries(dayTimes)) {
    out[day] = (Array.isArray(times) ? times : []).map(fn).filter((v): v is string => v !== null);
  }
  return out;
}

/** Canonicalise every time in a DayTimes object to "HH:MM" (write path — watch
 * APIs store this, so old am/pm clients and new HH:MM clients converge). */
export function normalizeDayTimes(
  dayTimes: Record<string, string[]> | null | undefined
): Record<string, string[]> | null {
  return mapDayTimes(dayTimes, toHhmm);
}

/** Render every time in a DayTimes object as a friendly am/pm label (read path —
 * the web UI hydrates canonical HH:MM into its am/pm picker). */
export function dayTimesToLabels(
  dayTimes: Record<string, string[]> | null | undefined
): Record<string, string[]> | null {
  return mapDayTimes(dayTimes, toLabel);
}

/** Minute-of-day from an ISO string's WALL CLOCK — no timezone conversion, matching
 * `localDate`/`hourLabel` in the ingest parsers (the feed's offset already encodes
 * venue-local time). "2026-07-12T17:30:00+01:00" → 1050. Null if no time part. */
export function minutesFromIso(iso: string): number | null {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
