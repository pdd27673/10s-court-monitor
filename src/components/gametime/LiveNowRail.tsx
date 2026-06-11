'use client';

import type { SportEvent } from '@/lib/gametime/types';
import { SportIcon } from './SportIcon';
import { useApp } from '@/lib/gametime/context/AppContext';
import { usePrefs } from '@/lib/gametime/context/AppContext';
import { formatTime } from '@/lib/gametime/time';

interface Props {
  events: SportEvent[];
}

export function LiveNowRail({ events }: Props) {
  const { dispatch } = useApp();
  const prefs = usePrefs();
  const tz = prefs.timezone || 'UTC';

  if (events.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <span className="size-2 rounded-full bg-red-500 animate-pulse" />
        <h2 className="text-xs font-semibold uppercase tracking-widest text-red-400">Live Now</h2>
        <span className="text-xs text-gt-muted">({events.length})</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
        {events.map(event => (
          <button
            key={event.id}
            onClick={() => dispatch({ type: 'OPEN_DRAWER', payload: event.id })}
            className="flex-none w-56 rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-left hover:border-red-500/60 hover:bg-red-500/10 transition-colors cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wide">Live</span>
              </div>
              <SportIcon sport={event.sport} size="xs" />
            </div>
            <div className="text-sm font-semibold text-gt-text leading-snug mb-1 line-clamp-2">
              {event.eventTitle}
            </div>
            <div className="text-xs text-gt-muted truncate mb-2">{event.competition}</div>
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-1">
                {event.broadcasters.slice(0, 2).map(b => (
                  <span key={b.id} className="text-[10px] px-1.5 py-0.5 rounded bg-gt-surface border border-gt-border text-gt-muted">
                    {b.shortName ?? b.name}
                  </span>
                ))}
                {event.broadcasters.length === 0 && (
                  <span className="text-[10px] text-gt-muted italic">TBA</span>
                )}
              </div>
              <span className="text-[10px] text-gt-muted tabular-nums">{formatTime(event.startTimeUtc, tz, prefs.use24h)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
