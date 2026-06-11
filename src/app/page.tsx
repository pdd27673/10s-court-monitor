'use client';

import { useMemo } from 'react';
import { MOCK_EVENTS, getLiveEvents, getUpcomingEvents, getFeaturedEvents } from '@/lib/gametime/mock-data/events';
import { LiveNowRail } from '@/components/gametime/LiveNowRail';
import { EventCard } from '@/components/gametime/EventCard';
import { FilterBar } from '@/components/gametime/FilterBar';
import { useFilters, usePrefs } from '@/lib/gametime/context/AppContext';
import { applyFilters, findConflicts, sortEvents } from '@/lib/gametime/normalizers';
import { groupByLocalDate, getDayLabel } from '@/lib/gametime/time';
import Link from 'next/link';

function FeaturedBanner() {
  const featured = getFeaturedEvents().filter(e => e.importance === 'high').slice(0, 3);
  return (
    <div className="mb-6 p-4 rounded-2xl border border-gt-accent/20 bg-gt-accent/5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-gt-accent text-xs font-semibold uppercase tracking-widest">Featured Tonight</span>
        <span className="flex-1 h-px bg-gt-accent/20" />
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
        {featured.map(event => (
          <div key={event.id} className="flex-none w-64">
            <EventCard event={event} compact />
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickNav() {
  const items = [
    { href: '/today', label: 'Today', icon: '☀', desc: 'All events today' },
    { href: '/week', label: 'This Week', icon: '📅', desc: 'Plan ahead' },
    { href: '/guide', label: 'EPG Guide', icon: '▤', desc: 'Timeline view' },
    { href: '/channels', label: 'Channels', icon: '📺', desc: 'Browse by broadcaster' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
      {items.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className="flex flex-col items-center gap-1 px-3 py-3 rounded-xl border border-gt-border bg-gt-surface hover:border-gt-accent/40 hover:bg-gt-surface-hover transition-colors text-center"
        >
          <span className="text-xl leading-none">{item.icon}</span>
          <span className="text-xs font-semibold text-gt-text">{item.label}</span>
          <span className="text-[10px] text-gt-muted">{item.desc}</span>
        </Link>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { filters } = useFilters();
  const prefs = usePrefs();
  const tz = prefs.timezone || 'UTC';

  const liveEvents = getLiveEvents();
  const upcomingEvents = getUpcomingEvents(240); // next 4 hours

  const allEvents = useMemo(() => {
    const filtered = applyFilters(MOCK_EVENTS, filters);
    return sortEvents(filtered);
  }, [filters]);

  const todayEvents = useMemo(() => {
    const groups = groupByLocalDate(allEvents, tz);
    const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    return (groups[todayKey] ?? []) as typeof allEvents;
  }, [allEvents, tz]);

  const conflicts = useMemo(() => findConflicts(allEvents), [allEvents]);

  const hasFilters = filters.sports.length > 0 || filters.showLiveOnly || filters.freeOnly || filters.streamingOnly;

  return (
    <div>
      {/* Live now */}
      <LiveNowRail events={liveEvents} />

      {/* Featured banner */}
      {!hasFilters && <FeaturedBanner />}

      {/* Quick nav */}
      {!hasFilters && <QuickNav />}

      {/* Filters */}
      <FilterBar />

      {/* Up Next section */}
      {!hasFilters && upcomingEvents.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gt-text">Up Next</h2>
            <span className="text-xs text-gt-muted">Next 4 hours</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {upcomingEvents.slice(0, 4).map(event => (
              <EventCard
                key={event.id}
                event={event}
                hasConflict={conflicts.has(event.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Today section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gt-text">
            {hasFilters ? 'Filtered Events' : 'Today\'s Schedule'}
          </h2>
          <Link href="/today" className="text-xs text-gt-accent hover:underline">
            Full schedule →
          </Link>
        </div>
        {todayEvents.length === 0 ? (
          <div className="text-center py-12 text-gt-muted">
            <div className="text-3xl mb-2">📭</div>
            <p className="text-sm">No events match your filters</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-2">
            {todayEvents.map(event => (
              <EventCard
                key={event.id}
                event={event}
                hasConflict={conflicts.has(event.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
