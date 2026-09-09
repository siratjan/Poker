import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { Enums } from '@/lib/database.types';

/**
 * Badge (docs/ARBEITSPAKETE.md WP4, step 7). Small status pill.
 */

export type BadgeTone = 'success' | 'muted' | 'neutral';

const TONES: Record<BadgeTone, string> = {
  success:
    'bg-emerald-600/15 text-emerald-700 dark:text-emerald-300',
  muted: 'bg-black/8 text-neutral-600 dark:bg-white/10 dark:text-neutral-300',
  neutral: 'bg-sky-600/15 text-sky-700 dark:text-sky-300',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** Session status badge: open = green, closed = grey (SPEC §7). */
export function SessionStatusBadge({ status }: { status: Enums<'session_status'> }) {
  return status === 'open' ? (
    <Badge tone="success">Offen</Badge>
  ) : (
    <Badge tone="muted">Abgeschlossen</Badge>
  );
}
