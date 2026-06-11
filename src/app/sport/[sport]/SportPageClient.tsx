'use client';

import { useMemo } from 'react';
import { MOCK_EVENTS } from '@/lib/gametime/mock-data/events';
import { EventCard } from '@/components/gametime/EventCard';
import { SportIcon } from '@/components/gametime/SportIcon';
import { sortEvents, findConflicts } from '@/lib/gametime/normalizers';
import { groupByLocalDate, getDayLabel } from '@/lib/gametime/time';
import { usePrefs, useApp } from '@/lib/gametime/context/AppContext';
import type { Sport } from '@/lib/gametime/types';
import { SPORTS_LIST } from '@/lib/gametime/types';
import Link from 'next/link';

interface Props {
  sport: Sport;
}

export function SportPageClient({ sport }: Props) {
  const prefs = usePrefs();
  const { dispatch, isFavoriteSport } = useApp();
  const tz = prefs.timezone || 'UTC';
  const isFav = isFavoriteSport(sport);

  const sportMeta = SPORTS_LIST.find(s => s.id === sport);

  const events = useMemo(() => {
    return sortEvents(MOCK_EVENTS.filter(e => e.sport === sport));
  }, [sport]);

  const grouped = useMemo(() => groupByLocalDate(events, tz), [events, tz]);
  const sortedDays = Object.keys(grouped).sort();
  const conflicts = useMemo(() => findConflicts(events), [events]);

  if (!sportMeta) {
    return (
      <div className="text-center py-16">
        <p className="text-gt-muted">Unknown sport</p>
        <Link href="/" className="text-gt-accent text-sm mt-2 inline-block">← Back to Dashboard</Link>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <SportIcon sport={sport} size="lg" />
          <div>
            <h1 className="text-xl font-bold text-gt-text">{sportMeta.label}</h1>
            <p className="text-sm text-gt-muted">{events.length} upcoming events</p>
          </div>
        </div>
        <button
          onClick={() => dispatch({ type: 'TOGGLE_FAVORITE_SPORT', payload: sport })}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
            isFav
              ? 'bg-gt-accent/15 border-gt-accent/50 text-gt-accent'
              : 'bg-gt-surface border-gt-border text-gt-muted hover:text-gt-text hover:border-gt-accent/30'
          }`}
        >
          {isFav ? '★ Pinned' : '☆ Pin sport'}
        </button>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-16 text-gt-muted">
          <div className="text-4xl mb-3">{sportMeta.emoji}</div>
          <p className="text-sm">No upcoming {sportMeta.label} events in demo data</p>
        </div>
      ) : (
        <div className="space-y-8">
          {sortedDays.map(dateKey => {
            const dayEvents = grouped[dateKey];
            const label = getDayLabel(dateKey, tz);
            const isToday = label === 'Today';
            return (
              <section key={dateKey}>
                <div className="flex items-center gap-3 mb-3 sticky top-12 bg-gt-bg py-1 z-10">
                  <h2 className={`text-sm font-bold ${isToday ? 'text-gt-accent' : 'text-gt-text'}`}>
                    {label}
                  </h2>
                  {isToday && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gt-accent/15 text-gt-accent border border-gt-accent/30">
                      TODAY
                    </span>
                  )}
                  <div className="flex-1 h-px bg-gt-border" />
                </div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {dayEvents.map(event => (
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
