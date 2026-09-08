'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Tab = {
  href: string;
  label: string;
  icon: 'sessions' | 'players' | 'log' | 'admin';
};

const BASE_TABS: readonly Tab[] = [
  { href: '/', label: 'Sessions', icon: 'sessions' },
  { href: '/players', label: 'Spieler', icon: 'players' },
  { href: '/log', label: 'Log', icon: 'log' },
];

const ADMIN_TAB: Tab = { href: '/admin', label: 'Admin', icon: 'admin' };

/**
 * Bottom tab bar, mobile first. Every target is at least 44 px high
 * (SPEC: „Handy hochkant am Tisch“), the Admin tab only appears for admins —
 * the page behind it is protected on the server as well.
 */
export function TabBar({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = showAdmin ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS;

  return (
    <nav
      aria-label="Hauptnavigation"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-black/10 bg-[var(--background)]/95 backdrop-blur dark:border-white/10"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="mx-auto flex max-w-2xl">
        {tabs.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-1 px-2 py-2 text-[11px] font-medium transition ${
                  active ? 'text-emerald-600 dark:text-emerald-400' : 'opacity-60'
                }`}
              >
                <TabIcon name={tab.icon} />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname.startsWith('/sessions');
  return pathname === href || pathname.startsWith(`${href}/`);
}

function TabIcon({ name }: { name: Tab['icon'] }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (name) {
    case 'sessions':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M3 9h18M8 4v3M16 4v3" />
        </svg>
      );
    case 'players':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 19c.6-3 2.9-4.6 5.5-4.6S13.9 16 14.5 19M16 11.2A3 3 0 1 0 16 5.4M17.5 19c-.2-1.6-.7-2.9-1.6-3.8 2.3-.3 4.3 1.2 4.8 3.8" />
        </svg>
      );
    case 'log':
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M9 9h6M9 13h6M9 17h4" />
        </svg>
      );
    case 'admin':
      return (
        <svg {...common}>
          <path d="M12 3 5 6v5.5c0 4 2.9 7.6 7 9.5 4.1-1.9 7-5.5 7-9.5V6z" />
          <path d="m9.5 12 1.8 1.8 3.4-3.6" />
        </svg>
      );
  }
}
