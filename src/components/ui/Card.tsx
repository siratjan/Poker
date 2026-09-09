import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

/**
 * Card container (docs/ARBEITSPAKETE.md WP4, step 7). A rounded, bordered
 * surface used for session and player rows. Presentational only.
 */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx(
        'rounded-2xl border border-black/10 bg-[var(--background)] dark:border-white/10',
        className,
      )}
      {...rest}
    />
  );
}
