/**
 * The colour of an amount (docs/ARBEITSPAKETE.md WP9, step 4).
 *
 * One place for it, because the plus/minus pair has to clear WCAG AA (4.5:1 for
 * normal text) in *both* schemes and it is easy to get one of the four values
 * wrong when every component picks its own. Measured against the page
 * backgrounds `#ffffff` (light) and `#0a0a0a` (dark):
 *
 * | Rolle | Light          | Ratio  | Dark             | Ratio   |
 * |-------|----------------|--------|------------------|---------|
 * | plus  | emerald-700 #047857 | 5.55:1 | emerald-400 #34d399 | 10.33:1 |
 * | minus | red-700     #b91c1c | 6.49:1 | red-400     #f87171 |  7.16:1 |
 *
 * emerald-600 (#059669) was the previous light value and reaches only 3.77:1 —
 * it fails AA and is the reason this helper exists.
 *
 * Zero is neither a win nor a loss, so it stays in the text colour at reduced
 * opacity (`opacity-70` = 4.77:1 on white, 5.4:1 on the dark ground — still AA).
 */

export type AmountTone = 'plus' | 'minus' | 'zero';

export function amountTone(cents: number): AmountTone {
  if (cents > 0) return 'plus';
  if (cents < 0) return 'minus';
  return 'zero';
}

const TONE_CLASSES: Record<AmountTone, string> = {
  plus: 'text-emerald-700 dark:text-emerald-400',
  minus: 'text-red-700 dark:text-red-400',
  zero: 'opacity-70',
};

/** Tailwind classes for the colour of `cents`. Never includes a font size. */
export function amountToneClasses(cents: number): string {
  return TONE_CLASSES[amountTone(cents)];
}
