'use client';

import { useMemo } from 'react';
import { MOCK_EVENTS } from '@/lib/gametime/mock-data/events';
import { EventCard } from '@/components/gametime/EventCard';
import { FilterBar } from '@/components/gametime/FilterBar';
import { useFilters, usePrefs } from '@/lib/gametime/context/AppContext';
import { applyFilters, sortEvents, findConflicts } from '@/lib/gametime/normalizers';
import { isThisWeekInTimezone, groupByLocalDate, getDayLabel } from '@/lib/gametime/time';

export default function WeekPage() {
  const { filters } = useFilters();
  const prefs = usePrefs();
  const tz = prefs.timezone || 'UTC';

  const weekEvents = useMemo(() => {
    const filtered = applyFilters(MOCK_EVENTS, filters);
    return sortEvents(filtered.filter(e => isThisWeekInTimezone(e.startTimeUtc, tz)));
  }, [filters, tz]);

  const grouped = useMemo(() => groupByLocalDate(weekEvents, tz), [weekEvents, tz]);
  const sortedDays = Object.keys(grouped).sort();
  const conflicts = useMemo(() => findConflicts(weekEvents), [weekEvents]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gt-text mb-1">This Week</h1>
        <p className="text-sm text-gt-muted">Upcoming events over the next 7 days</p>
      </div>

      <FilterBar />

      {weekEvents.length === 0 ? (
        <div className="text-center py-16 text-gt-muted">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-sm font-medium">No events this week</p>
          <p className="text-xs mt-1">Try adjusting your filters</p>
        </div>
      ) : (
        <div className="space-y-8">
          {sortedDays.map(dateKey => {
            const dayEvents = grouped[dateKey];
            const label = getDayLabel(dateKey, tz);
            const isToday = label === 'Today';
            return (
              <section key={dateKey}>
                <div className="flex items-center gap-3 mb-4 sticky top-12 z-10 bg-gt-bg py-2 -mt-2">
                  <h2 className={`text-sm font-bold ${isToday ? 'text-gt-accent' : 'text-gt-text'}`}>
                    {label}
                  </h2>
                  {isToday && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gt-accent/15 text-gt-accent border border-gt-accent/30">
                      TODAY
                    </span>
                  )}
                  <div className="flex-1 h-px bg-gt-border" />
                  <span className="text-xs text-gt-muted">{dayEvents.length} events</span>
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {(dayEvents as Parameters<typeof EventCard>[0]['event'][]).map(event => (
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
