'use client';

import { Input } from '@/components/ui/Input';
import { formatCents } from '@/lib/money';
import { amountFromInput, amountHint, euroValue } from '@/lib/session/amountInput';

/**
 * Amount entry for the buy-in / cash-out / payout sheets
 * (docs/ARBEITSPAKETE.md WP5, step 4).
 *
 * The typed euro string is parsed into integer cents by
 * `@/lib/session/amountInput` (tested there); a float never enters a
 * calculation path (CLAUDE.md). Quick amounts are big buttons, so the usual
 * buy-in stays at „Spieler → Betrag → Bar/Liste“.
 */
export function AmountField({
  label,
  value,
  onChange,
  quickAmountsCents = [],
  allowZero = false,
  autoFocus = false,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  quickAmountsCents?: readonly number[];
  allowZero?: boolean;
  autoFocus?: boolean;
  hint?: string;
  error?: string | null;
}) {
  const selectedCents = amountFromInput(value, allowZero);

  return (
    <div className="flex flex-col gap-3">
      {quickAmountsCents.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {quickAmountsCents.map((cents) => {
            const active = selectedCents === cents;
            return (
              <button
                key={cents}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(euroValue(cents))}
                className={
                  'min-h-[56px] rounded-xl border text-base font-semibold transition ' +
                  (active
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10')
                }
              >
                {formatCents(cents)}
              </button>
            );
          })}
        </div>
      ) : null}

      <Input
        label={label}
        name="amount"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="z. B. 100"
        value={value}
        hint={hint}
        error={error ?? amountHint(value, allowZero)}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
