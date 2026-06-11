'use client';

import { formatTime, getRelativeTime } from '@/lib/gametime/time';
import { usePrefs } from '@/lib/gametime/context/AppContext';

interface Props {
  utcString: string;
  endUtc?: string;
  showRelative?: boolean;
  showDate?: boolean;
  className?: string;
}

export function TimeDisplay({ utcString, showRelative = true, className = '' }: Props) {
  const { timezone, use24h } = usePrefs();
  const tz = timezone || 'UTC';
  const timeStr = formatTime(utcString, tz, use24h);
  const rel = getRelativeTime(utcString);

  return (
    <span className={`tabular-nums ${className}`}>
      <span className="text-gt-text font-medium">{timeStr}</span>
      {showRelative && (
        <span className={`ml-1.5 text-xs ${rel.isLive ? 'text-red-400' : rel.isSoon ? 'text-amber-400' : 'text-gt-muted'}`}>
          {rel.isLive ? '● Live' : rel.isSoon ? `in ${rel.label}` : rel.minutesUntil > 0 ? `+${rel.label}` : rel.label}
        </span>
      )}
    </span>
  );
}

export function RelativeTime({ utcString }: { utcString: string }) {
  const rel = getRelativeTime(utcString);
  if (rel.isLive) return <span className="text-red-400 text-xs font-semibold">● Live now</span>;
  if (rel.isSoon) return <span className="text-amber-400 text-xs">Starts in {rel.label}</span>;
  if (rel.minutesUntil <= 0) return <span className="text-gt-muted text-xs">Started</span>;
  return <span className="text-gt-muted text-xs">in {rel.label}</span>;
}
