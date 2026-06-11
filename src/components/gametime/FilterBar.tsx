'use client';

import { useFilters } from '@/lib/gametime/context/AppContext';
import { SPORTS_LIST } from '@/lib/gametime/types';
import type { Sport } from '@/lib/gametime/types';

interface QuickFilter {
  id: string;
  label: string;
  apply: (f: ReturnType<typeof useFilters>['filters']) => Partial<ReturnType<typeof useFilters>['filters']>;
}

const QUICK_FILTERS: QuickFilter[] = [
  { id: 'live', label: '🔴 Live', apply: () => ({ showLiveOnly: true, timeRange: 'live' as const }) },
  { id: '1h', label: '⚡ Starts in 1h', apply: () => ({ timeRange: '1h' as const }) },
  { id: 'free', label: '📺 Free to Air', apply: () => ({ freeOnly: true }) },
  { id: 'streaming', label: '💻 Streaming only', apply: () => ({ streamingOnly: true }) },
];

interface Props {
  showSportFilter?: boolean;
  showQuickFilters?: boolean;
}

export function FilterBar({ showSportFilter = true, showQuickFilters = true }: Props) {
  const { filters, setFilter, resetFilters } = useFilters();

  const hasActiveFilters =
    filters.sports.length > 0 ||
    filters.showLiveOnly ||
    filters.freeOnly ||
    filters.streamingOnly ||
    filters.timeRange !== 'all';

  function toggleSport(sport: Sport) {
    const next = filters.sports.includes(sport)
      ? filters.sports.filter(s => s !== sport)
      : [...filters.sports, sport];
    setFilter({ sports: next });
  }

  return (
    <div className="mb-4 space-y-2">
      {/* Quick filters */}
      {showQuickFilters && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
          {QUICK_FILTERS.map(qf => {
            const isActive =
              (qf.id === 'live' && filters.showLiveOnly) ||
              (qf.id === '1h' && filters.timeRange === '1h') ||
              (qf.id === 'free' && filters.freeOnly) ||
              (qf.id === 'streaming' && filters.streamingOnly);
            return (
              <button
                key={qf.id}
                onClick={() => {
                  if (isActive) {
                    resetFilters();
                  } else {
                    setFilter(qf.apply(filters));
                  }
                }}
                className={`flex-none px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-gt-accent/20 border-gt-accent/60 text-gt-accent'
                    : 'bg-gt-surface border-gt-border text-gt-muted hover:text-gt-text hover:border-gt-accent/30'
                }`}
              >
                {qf.label}
              </button>
            );
          })}
          {hasActiveFilters && (
            <button
              onClick={resetFilters}
              className="flex-none px-3 py-1.5 rounded-full text-xs border border-gt-border bg-gt-surface text-gt-muted hover:text-red-400 transition-colors whitespace-nowrap"
            >
              ✕ Clear
            </button>
          )}
        </div>
      )}

      {/* Sport chips */}
      {showSportFilter && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 scrollbar-hide">
          {SPORTS_LIST.map(s => {
            const active = filters.sports.includes(s.id);
            return (
              <button
                key={s.id}
                onClick={() => toggleSport(s.id)}
                className={`flex-none flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-gt-accent/20 border-gt-accent/60 text-gt-accent font-medium'
                    : 'bg-gt-surface border-gt-border text-gt-muted hover:text-gt-text hover:border-gt-accent/30'
                }`}
              >
                <span className="text-sm leading-none">{s.emoji}</span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
