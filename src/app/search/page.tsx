'use client';

import { useState, useMemo } from 'react';
import { MOCK_EVENTS } from '@/lib/gametime/mock-data/events';
import { EventCard } from '@/components/gametime/EventCard';
import { sortEvents } from '@/lib/gametime/normalizers';
import { SPORTS_LIST } from '@/lib/gametime/types';
import { SportIcon } from '@/components/gametime/SportIcon';
import Link from 'next/link';

export default function SearchPage() {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const matches = MOCK_EVENTS.filter(e =>
      [
        e.eventTitle,
        e.competition,
        e.league,
        e.sport,
        e.venue ?? '',
        ...e.participants.map(p => p.name),
        ...e.tags,
      ].join(' ').toLowerCase().includes(q)
    );
    return sortEvents(matches);
  }, [query]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gt-text mb-1">Search</h1>
        <p className="text-sm text-gt-muted">Find events, sports, teams, athletes</p>
      </div>

      {/* Search input */}
      <div className="relative mb-6">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gt-muted">⌕</span>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search events, sports, teams..."
          autoFocus
          className="w-full pl-9 pr-4 py-3 rounded-xl border border-gt-border bg-gt-surface text-sm text-gt-text placeholder:text-gt-muted outline-none focus:border-gt-accent/60 transition-colors"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gt-muted hover:text-gt-text transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      {/* Results */}
      {query ? (
        results.length === 0 ? (
          <div className="text-center py-12 text-gt-muted">
            <div className="text-3xl mb-2">🔍</div>
            <p className="text-sm">No events found for &quot;{query}&quot;</p>
          </div>
        ) : (
          <div>
            <p className="text-xs text-gt-muted mb-3">{results.length} results for &quot;{query}&quot;</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {results.map(e => <EventCard key={e.id} event={e} />)}
            </div>
          </div>
        )
      ) : (
        /* Browse by sport */
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gt-muted mb-3">Browse by Sport</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {SPORTS_LIST.map(s => {
              const count = MOCK_EVENTS.filter(e => e.sport === s.id).length;
              if (count === 0) return null;
              return (
                <Link
                  key={s.id}
                  href={`/sport/${s.id}`}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gt-border bg-gt-surface hover:border-gt-accent/40 hover:bg-gt-surface-hover transition-colors"
                >
                  <SportIcon sport={s.id} size="sm" />
                  <div>
                    <div className="text-xs font-medium text-gt-text">{s.label}</div>
                    <div className="text-[10px] text-gt-muted">{count} event{count !== 1 ? 's' : ''}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
