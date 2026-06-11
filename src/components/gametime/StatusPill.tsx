import type { EventStatus } from '@/lib/gametime/types';

interface Props {
  status: EventStatus;
  isLive?: boolean;
  label?: string;
  size?: 'xs' | 'sm';
}

const STYLES: Record<EventStatus, string> = {
  live: 'bg-red-500/20 text-red-400 border border-red-500/40',
  upcoming: 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
  final: 'bg-zinc-700/60 text-zinc-400 border border-zinc-600/40',
  delayed: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  cancelled: 'bg-zinc-700/60 text-zinc-500 border border-zinc-600/30 line-through',
  postponed: 'bg-zinc-700/60 text-zinc-400 border border-zinc-600/30',
  suspended: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
};

const LABELS: Record<EventStatus, string> = {
  live: 'Live',
  upcoming: 'Soon',
  final: 'Final',
  delayed: 'Delayed',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
  suspended: 'Suspended',
};

export function StatusPill({ status, isLive, label, size = 'xs' }: Props) {
  const styles = STYLES[status];
  const displayLabel = label ?? LABELS[status];
  const sizeClass = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';

  return (
    <span className={`inline-flex items-center gap-1 rounded font-semibold uppercase tracking-wide ${sizeClass} ${styles}`}>
      {(status === 'live' || isLive) && (
        <span className="size-1.5 rounded-full bg-red-500 animate-pulse" />
      )}
      {displayLabel}
    </span>
  );
}
