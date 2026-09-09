import { describe, expect, it } from 'vitest';
import { amountTone, amountToneClasses } from '@/lib/ui/amountTone';

/**
 * The interesting part of this file is not the mapping — it is the contrast.
 * WP9 step 4 asks for WCAG AA in light *and* dark, and a colour token is easy
 * to change without noticing that it drops below 4.5:1. So the ratio is
 * computed here from the actual Tailwind hex values, exactly as WCAG 2.1
 * defines it (relative luminance, then (L1 + 0.05) / (L2 + 0.05)).
 */

/** Tailwind v4 palette values used by `amountToneClasses`. */
const HEX = {
  'emerald-700': '#047857',
  'emerald-400': '#34d399',
  'red-700': '#b91c1c',
  'red-400': '#f87171',
  /** Only for the comparison in the table below — not used by the app. */
  'emerald-600': '#059669',
} as const;

/** Page backgrounds from src/app/globals.css. */
const BACKGROUND = { light: '#ffffff', dark: '#0a0a0a' } as const;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = channel((value >> 16) & 0xff);
  const g = channel((value >> 8) & 0xff);
  const b = channel(value & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const AA_NORMAL_TEXT = 4.5;

describe('amountTone', () => {
  it.each([
    [1, 'plus'],
    [123456, 'plus'],
    [-1, 'minus'],
    [-123456, 'minus'],
    [0, 'zero'],
  ] as const)('maps %i to %s', (cents, expected) => {
    expect(amountTone(cents)).toBe(expected);
  });
});

describe('amountToneClasses', () => {
  it('uses the AA-safe green in light mode and the bright one in dark mode', () => {
    expect(amountToneClasses(500)).toBe('text-emerald-700 dark:text-emerald-400');
  });

  it('uses the AA-safe red in light mode and the bright one in dark mode', () => {
    expect(amountToneClasses(-500)).toBe('text-red-700 dark:text-red-400');
  });

  it('leaves zero uncoloured', () => {
    expect(amountToneClasses(0)).toBe('opacity-70');
  });

  it('never colours an amount with the light green that fails AA', () => {
    for (const cents of [-1, 0, 1, -9999, 9999]) {
      expect(amountToneClasses(cents)).not.toContain('text-emerald-600');
      expect(amountToneClasses(cents)).not.toContain('text-red-600');
    }
  });
});

describe('WCAG AA contrast of the plus/minus colours', () => {
  it.each([
    ['plus, light', HEX['emerald-700'], BACKGROUND.light],
    ['plus, dark', HEX['emerald-400'], BACKGROUND.dark],
    ['minus, light', HEX['red-700'], BACKGROUND.light],
    ['minus, dark', HEX['red-400'], BACKGROUND.dark],
  ])('%s clears 4.5:1', (_label, foreground, background) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  it('documents why emerald-600 is not used on white', () => {
    // 3.77:1 — enough for large text, not for the amounts on a player card.
    expect(contrast(HEX['emerald-600'], BACKGROUND.light)).toBeLessThan(AA_NORMAL_TEXT);
  });

  it('computes the reference ratios of the WCAG examples correctly', () => {
    // Sanity check of the formula itself: black on white is exactly 21:1.
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});
