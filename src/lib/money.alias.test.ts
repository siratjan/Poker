/**
 * Guard for the project-wide import alias "@/*".
 *
 * This file imports production code through the alias on purpose: if the
 * resolve.alias entry in vitest.config.mts is ever removed, this test fails to
 * load instead of the breakage staying invisible until a tested module happens
 * to use the alias internally.
 */
import { describe, expect, it } from 'vitest';
import { formatCents, parseEuroInput } from '@/lib/money';

describe('import alias "@/*"', () => {
  it('resolves to src/ inside vitest', () => {
    expect(formatCents(123450)).toBe('1.234,50 €');
    expect(parseEuroInput('1.234,50')).toBe(123450);
  });
});
