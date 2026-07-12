/**
 * Courts sometimes label coaching/group sessions in the court text while the
 * button lacks coaching/class CSS, so scrapers store status as "closed".
 * Use this to treat those rows as coaching for display and new scrapes.
 */
export function courtLabelImpliesCoaching(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\bcoaching\b/.test(t) ||
    /\bgroup\s+coaching\b/.test(t) ||
    /\btennis\s+(lesson|class)\b/.test(t) ||
    /\b(junior|adult|group)\s+(session|lesson)\b/.test(t)
  );
}
