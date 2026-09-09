import { clsx } from 'clsx';
import { formatSignedCents } from '@/lib/money';

/**
 * A balance, coloured: green above zero, red below, neutral at zero
 * (docs/ARBEITSPAKETE.md WP7, step 2). `tabular-nums` keeps the digits in
 * column across rows.
 *
 * `played = false` means the player has not finished a single evening yet — the
 * amount then reads „–“ instead of a `0,00 €` that would look like a result.
 *
 * Presentational only — no hooks — so both the server pages and the client list
 * can render it.
 */
export function NetAmount({
  cents,
  played = true,
  className,
}: {
  cents: number;
  played?: boolean;
  className?: string;
}) {
  if (!played) {
    return <span className={clsx('text-sm opacity-50', className)}>–</span>;
  }

  return (
    <span
      className={clsx(
        'shrink-0 font-semibold tabular-nums',
        cents > 0
          ? 'text-emerald-600 dark:text-emerald-400'
          : cents < 0
            ? 'text-red-600 dark:text-red-400'
            : 'opacity-70',
        className,
      )}
    >
      {formatSignedCents(cents)}
    </span>
  );
}
