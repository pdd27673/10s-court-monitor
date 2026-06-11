'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp, usePrefs } from '@/lib/gametime/context/AppContext';
import { SPORTS_LIST } from '@/lib/gametime/types';
import type { Sport } from '@/lib/gametime/types';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const MAIN_NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: '◈' },
  { href: '/today', label: 'Today', icon: '☀' },
  { href: '/week', label: 'This Week', icon: '📅' },
  { href: '/guide', label: 'EPG Guide', icon: '▤' },
  { href: '/channels', label: 'Channels', icon: '📺' },
  { href: '/saved', label: 'Saved', icon: '★' },
];

function SportNavItem({ sport, label, icon }: { sport: Sport; label: string; icon: string }) {
  const pathname = usePathname();
  const isActive = pathname === `/sport/${sport}`;
  const { isFavoriteSport, dispatch } = useApp();
  const isFav = isFavoriteSport(sport);

  return (
    <div className="flex items-center gap-1 group">
      <Link
        href={`/sport/${sport}`}
        className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
          isActive
            ? 'bg-gt-accent/15 text-gt-accent font-medium'
            : 'text-gt-muted hover:text-gt-text hover:bg-gt-surface'
        }`}
      >
        <span className="text-sm leading-none">{icon}</span>
        <span className="truncate">{label}</span>
      </Link>
      <button
        onClick={() => dispatch({ type: 'TOGGLE_FAVORITE_SPORT', payload: sport })}
        className={`opacity-0 group-hover:opacity-100 size-5 text-xs flex items-center justify-center rounded transition-colors ${
          isFav ? 'opacity-100 text-gt-accent' : 'text-gt-muted hover:text-gt-accent'
        }`}
        title={isFav ? 'Unpin sport' : 'Pin sport'}
      >
        {isFav ? '★' : '☆'}
      </button>
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const prefs = usePrefs();
  const { dispatch } = useApp();

  const favSports = SPORTS_LIST.filter(s => prefs.favoriteSports.includes(s.id));
  const otherSports = SPORTS_LIST.filter(s => !prefs.favoriteSports.includes(s.id));

  return (
    <aside className="hidden lg:flex flex-col w-52 shrink-0 sticky top-12 h-[calc(100vh-3rem)] border-r border-gt-border bg-gt-bg overflow-y-auto">
      {/* Main nav */}
      <nav className="p-3 space-y-0.5">
        {MAIN_NAV.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 px-2 py-2 rounded-md text-xs font-medium transition-colors ${
              pathname === item.href
                ? 'bg-gt-accent/15 text-gt-accent'
                : 'text-gt-muted hover:text-gt-text hover:bg-gt-surface'
            }`}
          >
            <span className="text-sm leading-none w-4 text-center">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <div className="border-t border-gt-border mx-3" />

      {/* Sports */}
      <div className="p-3 flex-1">
        {favSports.length > 0 && (
          <>
            <div className="text-[10px] uppercase tracking-widest text-gt-muted mb-1.5 px-2">Pinned</div>
            <div className="space-y-0.5 mb-3">
              {favSports.map(s => (
                <SportNavItem key={s.id} sport={s.id} label={s.label} icon={s.emoji} />
              ))}
            </div>
            <div className="border-t border-gt-border mb-2" />
          </>
        )}

        <div className="text-[10px] uppercase tracking-widest text-gt-muted mb-1.5 px-2">All Sports</div>
        <div className="space-y-0.5">
          {otherSports.map(s => (
            <SportNavItem key={s.id} sport={s.id} label={s.label} icon={s.emoji} />
          ))}
        </div>
      </div>

      {/* Settings footer */}
      <div className="p-3 border-t border-gt-border space-y-1">
        <button
          onClick={() => dispatch({ type: 'TOGGLE_THEME' })}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-gt-muted hover:text-gt-text hover:bg-gt-surface transition-colors"
        >
          <span>{prefs.theme === 'dark' ? '☀' : '🌙'}</span>
          <span>{prefs.theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>
        <Link
          href="/search"
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-gt-muted hover:text-gt-text hover:bg-gt-surface transition-colors"
        >
          <span>⌕</span>
          <span>Search</span>
        </Link>
      </div>
    </aside>
  );
}
