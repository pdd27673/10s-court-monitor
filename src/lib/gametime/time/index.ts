'use client';

export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

export function formatTime(utcString: string, timezone: string, use24h = false): string {
  const d = new Date(utcString);
  return d.toLocaleTimeString(undefined, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: !use24h,
  });
}

export function formatDate(utcString: string, timezone: string): string {
  const d = new Date(utcString);
  return d.toLocaleDateString(undefined, {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateFull(utcString: string, timezone: string): string {
  const d = new Date(utcString);
  return d.toLocaleDateString(undefined, {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateShort(utcString: string, timezone: string): string {
  const d = new Date(utcString);
  return d.toLocaleDateString(undefined, {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
  });
}

export function getRelativeTime(utcString: string): {
  label: string;
  isLive: boolean;
  isSoon: boolean;
  minutesUntil: number;
} {
  const now = Date.now();
  const start = new Date(utcString).getTime();
  const diff = start - now;
  const minutesUntil = Math.round(diff / 60000);
  const absMin = Math.abs(minutesUntil);

  if (minutesUntil < -30) {
    return { label: 'Live', isLive: true, isSoon: false, minutesUntil };
  }
  if (minutesUntil < 0) {
    return { label: 'Starting now', isLive: true, isSoon: true, minutesUntil };
  }
  if (minutesUntil < 1) {
    return { label: 'Starts now', isLive: false, isSoon: true, minutesUntil };
  }
  if (minutesUntil < 60) {
    return { label: `${minutesUntil}m`, isLive: false, isSoon: minutesUntil <= 30, minutesUntil };
  }
  if (minutesUntil < 24 * 60) {
    const h = Math.floor(absMin / 60);
    const m = absMin % 60;
    const label = m > 0 ? `${h}h ${m}m` : `${h}h`;
    return { label, isLive: false, isSoon: false, minutesUntil };
  }
  const days = Math.round(minutesUntil / (24 * 60));
  return { label: `${days}d`, isLive: false, isSoon: false, minutesUntil };
}

export function getLocalDayStart(date: Date, timezone: string): Date {
  const str = date.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
  return new Date(`${str}T00:00:00`);
}

export function groupByLocalDate<T extends { startTimeUtc: string }>(
  events: T[],
  timezone: string
): Record<string, T[]> {
  const groups: Record<string, T[]> = {};
  for (const event of events) {
    const dateKey = new Date(event.startTimeUtc).toLocaleDateString('en-CA', { timeZone: timezone });
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(event);
  }
  return groups;
}

export function getWeekDates(timezone: string): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    dates.push(d.toLocaleDateString('en-CA', { timeZone: timezone }));
  }
  return dates;
}

export function isTodayInTimezone(utcString: string, timezone: string): boolean {
  const now = new Date();
  const nowDate = now.toLocaleDateString('en-CA', { timeZone: timezone });
  const evDate = new Date(utcString).toLocaleDateString('en-CA', { timeZone: timezone });
  return nowDate === evDate;
}

export function isThisWeekInTimezone(utcString: string, timezone: string): boolean {
  const now = new Date();
  const evDate = new Date(utcString);
  const diffDays = (evDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= -1 && diffDays < 7;
}

export function getDayLabel(dateStr: string, timezone: string): string {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: timezone });

  if (dateStr === todayStr) return 'Today';
  if (dateStr === tomorrowStr) return 'Tomorrow';

  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function getTimezoneAbbreviation(timezone: string): string {
  try {
    const now = new Date();
    const abbr = now.toLocaleTimeString('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    }).split(' ').at(-1);
    return abbr ?? timezone;
  } catch {
    return timezone;
  }
}

export function formatTimeRange(startUtc: string, endUtc: string | undefined, timezone: string, use24h = false): string {
  const start = formatTime(startUtc, timezone, use24h);
  if (!endUtc) return start;
  const end = formatTime(endUtc, timezone, use24h);
  return `${start} – ${end}`;
}

export function makeCalendarUrl(event: {
  eventTitle: string;
  startTimeUtc: string;
  endTimeUtc?: string;
  venue?: string;
  competition?: string;
}): string {
  const start = event.startTimeUtc.replace(/[-:]/g, '').replace('.000Z', 'Z');
  const endTime = event.endTimeUtc
    ? new Date(new Date(event.startTimeUtc).getTime() + 2 * 60 * 60 * 1000)
    : new Date(new Date(event.startTimeUtc).getTime() + 2 * 60 * 60 * 1000);
  const end = (event.endTimeUtc ?? endTime.toISOString()).replace(/[-:]/g, '').replace('.000Z', 'Z');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.eventTitle,
    dates: `${start}/${end}`,
    details: event.competition ?? '',
    location: event.venue ?? '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
