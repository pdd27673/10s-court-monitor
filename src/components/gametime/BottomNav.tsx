'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp } from '@/lib/gametime/context/AppContext';

const ITEMS = [
  { href: '/', label: 'Home', icon: '◈' },
  { href: '/today', label: 'Today', icon: '☀' },
  { href: '/guide', label: 'Guide', icon: '▤' },
  { href: '/saved', label: 'Saved', icon: '★' },
  { href: '/search', label: 'Search', icon: '⌕' },
];

export function BottomNav() {
  const pathname = usePathname();
  const { dispatch } = useApp();

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-14 bg-gt-bg/95 backdrop-blur-sm border-t border-gt-border flex items-stretch">
      {ITEMS.map(item => {
        const isSearch = item.href === '/search';
        const isActive = pathname === item.href;
        return isSearch ? (
          <button
            key={item.href}
            onClick={() => dispatch({ type: 'OPEN_SEARCH' })}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
              isActive ? 'text-gt-accent' : 'text-gt-muted hover:text-gt-text'
            }`}
          >
            <span className="text-base leading-none">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ) : (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
              isActive ? 'text-gt-accent' : 'text-gt-muted hover:text-gt-text'
            }`}
          >
            <span className={`text-base leading-none ${isActive ? 'text-gt-accent' : ''}`}>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
