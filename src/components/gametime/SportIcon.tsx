import type { Sport } from '@/lib/gametime/types';

const ICONS: Record<Sport, string> = {
  ufc: '🥊',
  mma: '🥊',
  boxing: '🥊',
  f1: '🏎️',
  motogp: '🏍️',
  indycar: '🏎️',
  nascar: '🏎️',
  motorsport: '🏁',
  football: '⚽',
  soccer: '⚽',
  'champions-league': '⚽',
  tennis: '🎾',
  basketball: '🏀',
  nba: '🏀',
  nfl: '🏈',
  cricket: '🏏',
  rugby: '🏉',
  'rugby-union': '🏉',
  'rugby-league': '🏉',
  golf: '⛳',
  athletics: '🏃',
  cycling: '🚴',
  snooker: '🎱',
  darts: '🎯',
  other: '🏆',
};

const COLORS: Partial<Record<Sport, string>> = {
  ufc: 'text-red-400',
  mma: 'text-red-400',
  boxing: 'text-red-400',
  f1: 'text-red-500',
  motogp: 'text-orange-400',
  motorsport: 'text-orange-400',
  football: 'text-green-400',
  soccer: 'text-green-400',
  'champions-league': 'text-blue-400',
  tennis: 'text-yellow-400',
  basketball: 'text-orange-500',
  nba: 'text-orange-500',
  nfl: 'text-blue-500',
  cricket: 'text-emerald-400',
  rugby: 'text-amber-400',
  golf: 'text-green-500',
  cycling: 'text-yellow-300',
  athletics: 'text-sky-400',
};

interface Props {
  sport: Sport;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  xs: 'text-sm',
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-3xl',
};

export function SportIcon({ sport, size = 'sm', className = '' }: Props) {
  const icon = ICONS[sport] ?? ICONS.other;
  const color = COLORS[sport] ?? '';
  return (
    <span
      className={`leading-none select-none ${SIZES[size]} ${color} ${className}`}
      role="img"
      aria-label={sport}
      title={sport}
    >
      {icon}
    </span>
  );
}
