'use client';

import Link from 'next/link';
import { useApp, usePrefs } from '@/lib/gametime/context/AppContext';
import { getTimezoneAbbreviation } from '@/lib/gametime/time';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard' },
  { href: '/today', label: 'Today' },
  { href: '/week', label: 'Week' },
  { href: '/guide', label: 'Guide' },
];

export function TopBar() {
  const { dispatch } = useApp();
  const prefs = usePrefs();
  const pathname = usePathname();
  const tzAbbr = getTimezoneAbbreviation(prefs.timezone || 'UTC');

  return (
    <header className="sticky top-0 z-30 h-12 border-b border-gt-border bg-gt-bg/90 backdrop-blur-md flex items-center gap-4 px-4">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-1.5 shrink-0">
        <span className="text-gt-accent font-extrabold tracking-tight text-base leading-none">GameTime</span>
        <span className="text-gt-muted font-light text-base leading-none">Grid</span>
      </Link>

      {/* Desktop nav */}
      <nav className="hidden md:flex items-center gap-1 ml-2">
        {NAV_ITEMS.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              pathname === item.href
                ? 'bg-gt-accent/15 text-gt-accent'
                : 'text-gt-muted hover:text-gt-text hover:bg-gt-surface'
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Timezone indicator */}
        <button
          className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md bg-gt-surface border border-gt-border text-xs text-gt-muted hover:text-gt-text transition-colors"
          onClick={() => {
            const newTz = prompt('Enter timezone (e.g. Europe/London, America/New_York):', prefs.timezone);
            if (newTz) dispatch({ type: 'SET_TIMEZONE', payload: newTz });
          }}
          title="Click to change timezone"
        >
          🌐 {tzAbbr}
        </button>

        {/* Dense mode toggle */}
        <button
          onClick={() => dispatch({ type: 'SET_DENSE_MODE', payload: !prefs.denseMode })}
          className={`hidden sm:flex size-7 items-center justify-center rounded-md border text-xs transition-colors ${
            prefs.denseMode
              ? 'bg-gt-accent/15 border-gt-accent/50 text-gt-accent'
              : 'bg-gt-surface border-gt-border text-gt-muted hover:text-gt-text'
          }`}
          title={prefs.denseMode ? 'Comfortable mode' : 'Dense mode'}
        >
          ☰
        </button>

        {/* Spoiler safe */}
        <button
          onClick={() => dispatch({ type: 'SET_SPOILER_SAFE', payload: !prefs.spoilerSafe })}
          className={`hidden sm:flex size-7 items-center justify-center rounded-md border text-xs transition-colors ${
            prefs.spoilerSafe
              ? 'bg-amber-500/15 border-amber-500/50 text-amber-400'
              : 'bg-gt-surface border-gt-border text-gt-muted hover:text-gt-text'
          }`}
          title="Spoiler-safe mode"
        >
          👁
        </button>

        {/* Theme toggle */}
        <button
          onClick={() => dispatch({ type: 'TOGGLE_THEME' })}
          className="size-7 flex items-center justify-center rounded-md border border-gt-border bg-gt-surface text-xs text-gt-muted hover:text-gt-text transition-colors"
          title="Toggle theme"
        >
          {prefs.theme === 'dark' ? '☀' : '🌙'}
        </button>

        {/* Search */}
        <button
          onClick={() => dispatch({ type: 'OPEN_SEARCH' })}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-gt-border bg-gt-surface text-xs text-gt-muted hover:text-gt-text hover:border-gt-accent/50 transition-colors"
          title="Search (press /)"
        >
          <span>⌕</span>
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden sm:inline px-1 py-0.5 rounded bg-gt-bg border border-gt-border text-[10px]">/</kbd>
        </button>
      </div>
    </header>
  );
}
