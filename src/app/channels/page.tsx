'use client';

import { useMemo } from 'react';
import { MOCK_EVENTS } from '@/lib/gametime/mock-data/events';
import { BROADCASTERS } from '@/lib/gametime/mock-data/broadcasters';
import { EventCard } from '@/components/gametime/EventCard';
import { useApp } from '@/lib/gametime/context/AppContext';
import type { Broadcaster } from '@/lib/gametime/types';

function ChannelSection({ broadcaster, events }: { broadcaster: Broadcaster; events: typeof MOCK_EVENTS }) {
  const { dispatch } = useApp();
  if (events.length === 0) return null;
  return (
    <section className="mb-8">
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-2 h-6 rounded-full shrink-0"
          style={{ backgroundColor: broadcaster.color ?? '#64748b' }}
        />
        <div>
          <h2 className="text-sm font-bold text-gt-text">{broadcaster.name}</h2>
          <p className="text-xs text-gt-muted capitalize">{broadcaster.type} · {broadcaster.country ?? 'Global'}</p>
        </div>
        {broadcaster.isFree && (
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            Free
          </span>
        )}
      </div>
      <div className="grid sm:grid-cols-2 gap-2">
        {events.map(event => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </section>
  );
}

export default function ChannelsPage() {
  const channelMap = useMemo(() => {
    const map = new Map<string, typeof MOCK_EVENTS>();
    for (const event of MOCK_EVENTS) {
      for (const b of event.broadcasters) {
        if (!map.has(b.id)) map.set(b.id, []);
        map.get(b.id)!.push(event);
      }
    }
    return map;
  }, []);

  const sortedBroadcasters = Object.values(BROADCASTERS)
    .filter(b => channelMap.has(b.id))
    .sort((a, b) => {
      // Free first
      if (a.isFree && !b.isFree) return -1;
      if (!a.isFree && b.isFree) return 1;
      return (a.name).localeCompare(b.name);
    });

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gt-text mb-1">Channels & Platforms</h1>
        <p className="text-sm text-gt-muted">Browse upcoming events by broadcaster</p>
      </div>

      {/* Channel pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {sortedBroadcasters.map(b => (
          <a
            key={b.id}
            href={`#${b.id}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-gt-border bg-gt-surface hover:border-gt-accent/40 text-gt-muted hover:text-gt-text transition-colors"
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: b.color ?? '#64748b' }}
            />
            {b.shortName ?? b.name}
            {b.isFree && <span className="text-emerald-400">✓</span>}
          </a>
        ))}
      </div>

      {sortedBroadcasters.map(b => (
        <div key={b.id} id={b.id}>
          <ChannelSection broadcaster={b} events={channelMap.get(b.id) ?? []} />
        </div>
      ))}
    </div>
  );
}
