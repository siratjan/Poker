/**
 * Guard for the project-wide import alias "@/*" from inside tests/gaby/.
 *
 * Round 1 of the WP0 review (finding F1) showed that a test file living under
 * tests/** could not import production code through the alias at all. The fix
 * (resolve.alias in vitest.config.mts) is global, but the location that broke
 * was this one, so the guard belongs here as well as in src/.
 */
import { describe, expect, it } from 'vitest';
import { formatCents, parseEuroInput } from '@/lib/money';
import * as relative from '../../src/lib/money';

describe('import alias "@/*" from tests/gaby', () => {
  it('resolves to src/ and yields the very same module instance', () => {
    expect(formatCents).toBe(relative.formatCents);
    expect(parseEuroInput).toBe(relative.parseEuroInput);
  });

  it('parses and formats through the aliased import', () => {
    expect(parseEuroInput('1.000,00')).toBe(100000);
    expect(formatCents(100000)).toBe('1.000,00 €');
  });
});
