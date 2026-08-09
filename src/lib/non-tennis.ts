/**
 * Non-tennis court/venue filter, shared by every ingest path — the OpenActive
 * feed parser AND the legacy HTML/ClubSpark scrapers — so the exclusion list
 * can't drift between them.
 *
 * Padel is the one that keeps leaking back in: some tennis venues co-locate
 * padel courts and the feeds list them right alongside the tennis courts
 * ("Padel Court 1"), so the guard has to run on every path that seeds courts,
 * not just one scraper.
 */
export const NON_TENNIS_KEYWORDS = [
  "cricket",
  "netball",
  "football",
  "basketball",
  "bowls",
  "bowling",
  "padel",
  "paddle",
] as const;

/**
 * True when a court or facility name denotes a non-tennis sport we don't track
 * (padel, cricket nets, netball …). Case-insensitive substring match, matching
 * how the names arrive in the feed and on the booking pages.
 */
export function isNonTennisName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase();
  return NON_TENNIS_KEYWORDS.some((kw) => n.includes(kw));
}
