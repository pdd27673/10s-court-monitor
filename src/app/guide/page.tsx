'use client';

import { useMemo } from 'react';
import { MOCK_EVENTS } from '@/lib/gametime/mock-data/events';
import { EPGGrid } from '@/components/gametime/EPGGrid';
import { FilterBar } from '@/components/gametime/FilterBar';
import { useFilters } from '@/lib/gametime/context/AppContext';
import { applyFilters } from '@/lib/gametime/normalizers';

export default function GuidePage() {
  const { filters } = useFilters();

  const events = useMemo(() => applyFilters(MOCK_EVENTS, filters), [filters]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-gt-text mb-1">EPG Guide</h1>
        <p className="text-sm text-gt-muted">Timeline view — current time marked in red</p>
      </div>

      <FilterBar showSportFilter={false} />

      <div className="mb-2 flex items-center gap-4 text-[10px] text-gt-muted">
        <div className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-red-500 inline-block" />
          <span>Live now</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="size-2 rounded bg-gt-accent/40 inline-block" />
          <span>Upcoming</span>
        </div>
        <span>← scroll to navigate →</span>
      </div>

      <EPGGrid events={events} hoursToShow={14} />

      <p className="mt-3 text-[10px] text-gt-muted text-center">
        Times shown in your local timezone · Click any event for details
      </p>
    </div>
  );
}
