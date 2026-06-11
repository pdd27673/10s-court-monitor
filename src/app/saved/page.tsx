'use client';

import { useMemo } from 'react';
import { MOCK_EVENTS } from '@/lib/gametime/mock-data/events';
import { EventCard } from '@/components/gametime/EventCard';
import { useApp } from '@/lib/gametime/context/AppContext';
import { sortEvents } from '@/lib/gametime/normalizers';
import Link from 'next/link';

export default function SavedPage() {
  const { state } = useApp();
  const savedIds = state.prefs.savedEventIds;

  const savedEvents = useMemo(() => {
    const events = MOCK_EVENTS.filter(e => savedIds.includes(e.id));
    return sortEvents(events);
  }, [savedIds]);

  const remindedIds = state.prefs.remindedEventIds;
  const remindedEvents = useMemo(() => {
    return MOCK_EVENTS.filter(e => remindedIds.includes(e.id) && !savedIds.includes(e.id));
  }, [remindedIds, savedIds]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gt-text mb-1">Saved Events</h1>
        <p className="text-sm text-gt-muted">Events you&apos;ve bookmarked or set reminders for</p>
      </div>

      {savedEvents.length === 0 && remindedEvents.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-4">☆</div>
          <p className="text-sm font-medium text-gt-text mb-2">No saved events yet</p>
          <p className="text-xs text-gt-muted mb-6">
            Open any event and tap Save to add it here.
          </p>
          <Link
            href="/"
            className="px-4 py-2 rounded-lg bg-gt-accent/15 border border-gt-accent/40 text-gt-accent text-sm hover:bg-gt-accent/25 transition-colors"
          >
            Browse events
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {savedEvents.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gt-muted mb-3">
                Saved ({savedEvents.length})
              </h2>
              <div className="grid sm:grid-cols-2 gap-2">
                {savedEvents.map(e => <EventCard key={e.id} event={e} />)}
              </div>
            </section>
          )}
          {remindedEvents.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-gt-muted mb-3">
                🔔 Reminders ({remindedEvents.length})
              </h2>
              <div className="grid sm:grid-cols-2 gap-2">
                {remindedEvents.map(e => <EventCard key={e.id} event={e} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
