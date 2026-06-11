import type { SportEvent, FilterState } from '../types';

export function normalizeEventTitle(event: SportEvent): string {
  if (event.participants.length >= 2) {
    const [a, b] = event.participants;
    return `${a.name} vs ${b.name}`;
  }
  return event.eventTitle;
}

export function deduplicateEvents(events: SportEvent[]): SportEvent[] {
  const seen = new Map<string, SportEvent>();
  for (const event of events) {
    const key = `${event.sport}__${event.startTimeUtc}__${event.eventTitle.toLowerCase().replace(/\s+/g, '')}`;
    const existing = seen.get(key);
    if (!existing || event.sourcePriority < existing.sourcePriority) {
      seen.set(key, event);
    } else if (existing) {
      // Merge: prefer higher-priority source but take broadcasters from both
      const merged: SportEvent = {
        ...existing,
        broadcasters: [
          ...existing.broadcasters,
          ...event.broadcasters.filter(b => !existing.broadcasters.some(eb => eb.id === b.id)),
        ],
        tvChannels: [...new Set([...existing.tvChannels, ...event.tvChannels])],
        streamingPlatforms: [...new Set([...existing.streamingPlatforms, ...event.streamingPlatforms])],
        tags: [...new Set([...existing.tags, ...event.tags])],
      };
      seen.set(key, merged);
    }
  }
  return Array.from(seen.values()).sort(
    (a, b) => new Date(a.startTimeUtc).getTime() - new Date(b.startTimeUtc).getTime()
  );
}

export function applyFilters(events: SportEvent[], filters: FilterState): SportEvent[] {
  return events.filter(event => {
    if (filters.sports.length > 0 && !filters.sports.includes(event.sport)) return false;

    if (filters.competitions.length > 0 && !filters.competitions.includes(event.competition)) return false;

    if (filters.broadcasters.length > 0) {
      const eventBroadcasterIds = event.broadcasters.map(b => b.id);
      if (!filters.broadcasters.some(bid => eventBroadcasterIds.includes(bid))) return false;
    }

    if (filters.showLiveOnly && !event.isLive) return false;

    if (filters.streamingOnly) {
      const hasStream = event.broadcasters.some(b => b.type === 'streaming') || event.streamingPlatforms.length > 0;
      if (!hasStream) return false;
    }

    if (filters.freeOnly) {
      const hasFree = event.broadcasters.some(b => b.isFree);
      if (!hasFree) return false;
    }

    if (filters.search) {
      const q = filters.search.toLowerCase();
      const searchable = [
        event.eventTitle,
        event.competition,
        event.league,
        event.sport,
        event.venue ?? '',
        ...event.participants.map(p => p.name),
        ...event.tags,
      ].join(' ').toLowerCase();
      if (!searchable.includes(q)) return false;
    }

    if (filters.timeRange !== 'all') {
      const now = Date.now();
      const start = new Date(event.startTimeUtc).getTime();
      if (filters.timeRange === 'live') {
        if (!event.isLive) return false;
      } else if (filters.timeRange === '1h') {
        if (start < now || start > now + 60 * 60 * 1000) return false;
      } else if (filters.timeRange === '3h') {
        if (start < now || start > now + 3 * 60 * 60 * 1000) return false;
      } else if (filters.timeRange === 'today') {
        const dayEnd = new Date();
        dayEnd.setHours(23, 59, 59, 999);
        if (start > dayEnd.getTime()) return false;
      } else if (filters.timeRange === 'week') {
        if (start > now + 7 * 24 * 60 * 60 * 1000) return false;
      }
    }

    return true;
  });
}

export function findConflicts(events: SportEvent[]): Map<string, string[]> {
  const conflicts = new Map<string, string[]>();
  const sorted = [...events].sort((a, b) =>
    new Date(a.startTimeUtc).getTime() - new Date(b.startTimeUtc).getTime()
  );

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const aStart = new Date(a.startTimeUtc).getTime();
    const aEnd = a.endTimeUtc
      ? new Date(a.endTimeUtc).getTime()
      : aStart + 2 * 60 * 60 * 1000;

    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const bStart = new Date(b.startTimeUtc).getTime();
      if (bStart >= aEnd) break;

      if (!conflicts.has(a.id)) conflicts.set(a.id, []);
      if (!conflicts.has(b.id)) conflicts.set(b.id, []);
      conflicts.get(a.id)!.push(b.id);
      conflicts.get(b.id)!.push(a.id);
    }
  }

  return conflicts;
}

export function sortEvents(events: SportEvent[]): SportEvent[] {
  return [...events].sort((a, b) => {
    // Live first
    if (a.isLive && !b.isLive) return -1;
    if (!a.isLive && b.isLive) return 1;
    // Then by start time
    return new Date(a.startTimeUtc).getTime() - new Date(b.startTimeUtc).getTime();
  });
}

export function enrichWithWatchStatus(event: SportEvent): SportEvent & { watchStatus: 'available' | 'partial' | 'unavailable' } {
  const hasWatch = event.broadcasters.length > 0 || event.tvChannels.length > 0 || event.streamingPlatforms.length > 0;
  const watchStatus = hasWatch
    ? event.confidence === 'high' ? 'available' : 'partial'
    : 'unavailable';
  return { ...event, watchStatus };
}
