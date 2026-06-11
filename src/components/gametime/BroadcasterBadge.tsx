import type { Broadcaster } from '@/lib/gametime/types';

interface Props {
  broadcaster: Broadcaster;
  size?: 'xs' | 'sm';
}

export function BroadcasterBadge({ broadcaster, size = 'xs' }: Props) {
  const sizeClass = size === 'xs' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1';
  const isFreeStyle = broadcaster.isFree
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : 'bg-zinc-700/60 text-zinc-300 border-zinc-600/50';

  return (
    <span
      className={`inline-flex items-center rounded border font-medium ${sizeClass} ${isFreeStyle} whitespace-nowrap`}
      title={broadcaster.isFree ? `${broadcaster.name} (Free)` : broadcaster.name}
    >
      {broadcaster.shortName ?? broadcaster.name}
      {broadcaster.isFree && <span className="ml-1 text-emerald-500">✓</span>}
    </span>
  );
}

export function BroadcasterList({ broadcasters, max = 3 }: { broadcasters: Broadcaster[]; max?: number }) {
  if (!broadcasters.length) {
    return <span className="text-[10px] text-gt-muted italic">Watch TBA</span>;
  }
  const shown = broadcasters.slice(0, max);
  const remaining = broadcasters.length - max;
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {shown.map(b => <BroadcasterBadge key={b.id} broadcaster={b} />)}
      {remaining > 0 && (
        <span className="text-[10px] text-gt-muted">+{remaining}</span>
      )}
    </div>
  );
}
