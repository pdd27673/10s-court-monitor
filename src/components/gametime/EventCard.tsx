'use client';

import { SportIcon } from './SportIcon';
import { StatusPill } from './StatusPill';
import { TimeDisplay } from './TimeDisplay';
import { BroadcasterList } from './BroadcasterBadge';
import type { SportEvent } from '@/lib/gametime/types';
import { useApp } from '@/lib/gametime/context/AppContext';

interface Props {
  event: SportEvent;
  compact?: boolean;
  hasConflict?: boolean;
}

const TAG_LABELS: Record<string, string> = {
  'title-fight': '👑 Title Fight',
  'big-tonight': '🔥 Big Tonight',
  'free-to-air': '📺 Free',
  'grand-slam': '🏆 Grand Slam',
  'grand-prix': '🏎️ Grand Prix',
  'final': '🏆 Final',
  'major': '⭐ Major',
};

function HighlightTag({ tag }: { tag: string }) {
  const label = TAG_LABELS[tag];
  if (!label) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/25 font-medium">
      {label}
    </span>
  );
}

export function EventCard({ event, compact = false, hasConflict = false }: Props) {
  const { state, dispatch, isSaved } = useApp();
  const saved = isSaved(event.id);
  const denseMode = state.prefs.denseMode;

  const highlightTags = event.tags.filter(t => TAG_LABELS[t]);

  function open() {
    dispatch({ type: 'OPEN_DRAWER', payload: event.id });
  }

  if (compact || denseMode) {
    return (
      <button
        onClick={open}
        className={`w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors hover:bg-gt-surface-hover cursor-pointer
          ${event.isLive ? 'border-red-500/30 bg-red-500/5' : 'border-gt-border bg-gt-surface'}`}
      >
        <SportIcon sport={event.sport} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-gt-text truncate">{event.eventTitle}</span>
            {hasConflict && (
              <span className="text-[10px] text-orange-400 shrink-0">⚠ Clash</span>
            )}
          </div>
          <div className="text-xs text-gt-muted truncate">{event.competition}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <StatusPill status={event.status} isLive={event.isLive} />
          <TimeDisplay utcString={event.startTimeUtc} showRelative={false} className="text-xs text-gt-muted" />
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={open}
      className={`w-full text-left group rounded-xl border p-4 transition-all hover:border-gt-accent/50 hover:bg-gt-surface-hover cursor-pointer
        ${event.isLive
          ? 'border-red-500/40 bg-red-500/5 shadow-sm shadow-red-500/10'
          : 'border-gt-border bg-gt-surface'
        }
        ${saved ? 'ring-1 ring-gt-accent/30' : ''}`}
    >
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <SportIcon sport={event.sport} size="sm" />
          <span className="text-xs text-gt-muted truncate">{event.competition}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasConflict && (
            <span className="text-[10px] text-orange-400 border border-orange-400/30 px-1.5 py-0.5 rounded">⚠ Clash</span>
          )}
          <StatusPill status={event.status} isLive={event.isLive} />
        </div>
      </div>

      {/* Title */}
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-gt-text leading-snug line-clamp-2">
          {event.eventTitle}
        </h3>
        {event.stage && (
          <p className="text-xs text-gt-muted mt-0.5">{event.stage}</p>
        )}
      </div>

      {/* Tags */}
      {highlightTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {highlightTags.map(t => <HighlightTag key={t} tag={t} />)}
        </div>
      )}

      {/* Time & venue */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <TimeDisplay utcString={event.startTimeUtc} />
        {event.venue && (
          <span className="text-[10px] text-gt-muted truncate max-w-32">{event.venue}</span>
        )}
      </div>

      {/* Broadcasters */}
      <BroadcasterList broadcasters={event.broadcasters} max={3} />

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-gt-border/60">
        <span className="text-[10px] text-gt-muted">via {event.source}</span>
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-[10px] text-gt-accent">Details →</span>
        </div>
      </div>
    </button>
  );
}
