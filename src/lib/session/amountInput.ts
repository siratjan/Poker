import { formatCents, parseEuroInput } from '@/lib/money';
import { MAX_AMOUNT_CENTS } from '@/lib/validation/entries';

/**
 * Pure helpers behind the amount field of the entry sheets
 * (`src/components/sessions/AmountField.tsx`). They live here so the rules the
 * user actually sees — what counts as a valid amount, which German hint appears
 * — are unit-tested instead of hidden in a component.
 */

/**
 * Integer cents for a typed euro string, or `null` while it is not a usable
 * amount (unparsable, above the typo guard, or 0 where 0 is not allowed).
 */
export function amountFromInput(value: string, allowZero: boolean): number | null {
  const cents = parseEuroInput(value);
  if (cents === null) return null;
  if (cents > MAX_AMOUNT_CENTS) return null;
  if (!allowZero && cents === 0) return null;
  return cents;
}

/**
 * German hint for a value that cannot be used, or `null` if it is fine. An
 * empty field is not an error — it is simply not filled in yet.
 */
export function amountHint(value: string, allowZero: boolean): string | null {
  if (value.trim().length === 0) return null;

  const cents = parseEuroInput(value);
  if (cents === null) return 'Bitte einen gültigen Betrag eingeben, z. B. 100 oder 99,50.';
  if (cents > MAX_AMOUNT_CENTS) return `Höchstens ${formatCents(MAX_AMOUNT_CENTS)}.`;
  if (!allowZero && cents === 0) return 'Der Betrag muss größer als 0 sein.';
  return null;
}

/** `10000` -> `"100"`, `9950` -> `"99,50"` — what a quick button puts into the field. */
export function euroValue(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  return rest === 0 ? `${sign}${euros}` : `${sign}${euros},${String(rest).padStart(2, '0')}`;
}
