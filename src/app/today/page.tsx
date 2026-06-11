'use client';

import { useMemo } from 'react';
import { MOCK_EVENTS } from '@/lib/gametime/mock-data/events';
import { EventCard } from '@/components/gametime/EventCard';
import { FilterBar } from '@/components/gametime/FilterBar';
import { useFilters, usePrefs } from '@/lib/gametime/context/AppContext';
import { applyFilters, sortEvents, findConflicts } from '@/lib/gametime/normalizers';
import { isTodayInTimezone, formatTime } from '@/lib/gametime/time';

function groupByHour<T extends { startTimeUtc: string }>(events: T[], tz: string) {
  const groups = new Map<number, T[]>();
  for (const ev of events) {
    const d = new Date(ev.startTimeUtc);
    const hour = parseInt(d.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
    if (!groups.has(hour)) groups.set(hour, []);
    groups.get(hour)!.push(ev);
  }
  return groups;
}

export default function TodayPage() {
  const { filters } = useFilters();
  const prefs = usePrefs();
  const tz = prefs.timezone || 'UTC';

  const todayEvents = useMemo(() => {
    const filtered = applyFilters(MOCK_EVENTS, filters);
    return sortEvents(filtered.filter(e => isTodayInTimezone(e.startTimeUtc, tz)));
  }, [filters, tz]);

  const byHour = useMemo(() => groupByHour(todayEvents, tz), [todayEvents, tz]);
  const conflicts = useMemo(() => findConflicts(todayEvents), [todayEvents]);

  const now = new Date();
  const todayLabel = now.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: tz,
  });

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gt-text mb-1">Today</h1>
        <p className="text-sm text-gt-muted">{todayLabel}</p>
      </div>

      <FilterBar />

      {todayEvents.length === 0 ? (
        <div className="text-center py-16 text-gt-muted">
          <div className="text-4xl mb-3">📅</div>
          <p className="text-sm font-medium">No events today</p>
          <p className="text-xs mt-1">Try adjusting your filters</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(byHour.entries())
            .sort(([a], [b]) => a - b)
            .map(([hour, events]) => {
              const slotDate = new Date();
              slotDate.setHours(hour, 0, 0, 0);
              const isPast = slotDate.getTime() < now.getTime() - 60 * 60 * 1000;
              return (
                <section key={hour}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`text-xs font-semibold tabular-nums px-2 py-1 rounded-md border ${
                      isPast
                        ? 'text-gt-muted border-gt-border bg-gt-surface/50'
                        : 'text-gt-accent border-gt-accent/30 bg-gt-accent/10'
                    }`}>
                      {formatTime(slotDate.toISOString(), tz, prefs.use24h)}
                    </div>
                    <div className="flex-1 h-px bg-gt-border" />
                    <span className="text-xs text-gt-muted">{events.length} event{events.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {events.map(event => (
                      <EventCard
                        key={event.id}
                        event={event}
                        hasConflict={conflicts.has(event.id)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}
