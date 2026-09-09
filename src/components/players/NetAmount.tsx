import { clsx } from 'clsx';
import { formatSignedCents } from '@/lib/money';
import { amountToneClasses } from '@/lib/ui/amountTone';

/**
 * A balance, coloured: green above zero, red below, neutral at zero
 * (docs/ARBEITSPAKETE.md WP7, step 2). `tabular-nums` keeps the digits in
 * column across rows.
 *
 * The colours come from `amountToneClasses`, which is where their WCAG AA
 * contrast in light and dark is documented and tested (WP9, step 4).
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
    // opacity-60 rather than 50: 4.77:1 on white, still AA (WP9, step 4).
    return (
      <span className={clsx('text-sm opacity-60', className)} aria-label="kein Ergebnis">
        –
      </span>
    );
  }

  return (
    <span className={clsx('shrink-0 font-semibold tabular-nums', amountToneClasses(cents), className)}>
      {formatSignedCents(cents)}
    </span>
  );
}
