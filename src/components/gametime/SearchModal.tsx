'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/lib/gametime/context/AppContext';
import { MOCK_EVENTS } from '@/lib/gametime/mock-data/events';
import { SportIcon } from './SportIcon';
import { StatusPill } from './StatusPill';
import { usePrefs } from '@/lib/gametime/context/AppContext';
import { formatDate, formatTime } from '@/lib/gametime/time';

export function SearchModal() {
  const { state, dispatch } = useApp();
  const prefs = usePrefs();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const tz = prefs.timezone || 'UTC';

  useEffect(() => {
    if (state.searchOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [state.searchOpen]);

  if (!state.searchOpen) return null;

  const results = query.trim().length < 1
    ? MOCK_EVENTS.filter(e => e.isFeatured).slice(0, 8)
    : MOCK_EVENTS.filter(e => {
        const q = query.toLowerCase();
        return [
          e.eventTitle,
          e.competition,
          e.league,
          e.sport,
          e.venue ?? '',
          ...e.participants.map(p => p.name),
          ...e.tags,
        ].join(' ').toLowerCase().includes(q);
      }).slice(0, 12);

  function close() {
    dispatch({ type: 'CLOSE_SEARCH' });
  }

  function open(id: string) {
    dispatch({ type: 'CLOSE_SEARCH' });
    dispatch({ type: 'OPEN_DRAWER', payload: id });
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" onClick={close} aria-hidden />
      <div className="fixed top-0 inset-x-0 z-50 pt-4 px-4 sm:pt-16 sm:px-8 md:max-w-2xl md:mx-auto">
        <div className="bg-gt-bg border border-gt-border rounded-2xl shadow-2xl overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gt-border">
            <span className="text-gt-muted text-lg">⌕</span>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search events, sports, teams, athletes..."
              className="flex-1 bg-transparent text-sm text-gt-text placeholder:text-gt-muted outline-none"
              autoComplete="off"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-gt-muted hover:text-gt-text transition-colors text-xs">✕</button>
            )}
            <kbd className="hidden sm:inline px-1.5 py-0.5 rounded bg-gt-surface border border-gt-border text-[10px] text-gt-muted">Esc</kbd>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto">
            {results.length === 0 ? (
              <div className="py-8 text-center text-sm text-gt-muted">No results found</div>
            ) : (
              <>
                <div className="px-4 pt-2 pb-1">
                  <span className="text-[10px] text-gt-muted uppercase tracking-widest">
                    {query ? `Results for "${query}"` : 'Featured Events'}
                  </span>
                </div>
                <ul>
                  {results.map(event => (
                    <li key={event.id}>
                      <button
                        onClick={() => open(event.id)}
                        className="w-full text-left flex items-center gap-3 px-4 py-2.5 hover:bg-gt-surface transition-colors"
                      >
                        <SportIcon sport={event.sport} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gt-text truncate">{event.eventTitle}</div>
                          <div className="text-xs text-gt-muted truncate">
                            {event.competition} · {formatDate(event.startTimeUtc, tz)} · {formatTime(event.startTimeUtc, tz, prefs.use24h)}
                          </div>
                        </div>
                        <StatusPill status={event.status} isLive={event.isLive} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* Footer hints */}
          <div className="border-t border-gt-border px-4 py-2 flex items-center gap-4 text-[10px] text-gt-muted">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
            <span>Esc Close</span>
          </div>
        </div>
      </div>
    </>
  );
}
