/**
 * Gaby / WP0 – edge cases for src/lib/money.ts.
 *
 * Test order for WP0 (docs/ARBEITSPAKETE.md): more than two decimal places must
 * be rejected, surrounding whitespace must be tolerated, and long grouped
 * amounts must parse exactly.
 *
 * Note: the import is relative on purpose. The `@/*` alias from tsconfig.json is
 * not registered in vitest.config.mts, so `import ... from '@/lib/money'` fails
 * to resolve inside Vitest (see finding F1 in qa/reports/WP0-gaby.md). Once the
 * alias is configured this import may be switched to '@/lib/money'.
 */
import { describe, expect, it } from 'vitest';
import { formatCents, parseEuroInput } from '../../src/lib/money';

describe('parseEuroInput – rules from the WP0 test order', () => {
  it('rejects more than two decimal places instead of rounding', () => {
    // Not a valid amount -> null. Never silently round to cents.
    for (const input of [
      '100,555',
      '0,001',
      '1.000,001',
      '99,999',
      '1.234.567,891',
      '0,00001',
    ]) {
      expect(parseEuroInput(input), input).toBeNull();
    }
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseEuroInput(' 100 ')).toBe(10000);
    expect(parseEuroInput('\t100\n')).toBe(10000);
    expect(parseEuroInput('\u00a0100\u00a0')).toBe(10000); // non-breaking space (paste)
    expect(parseEuroInput('  1.234,56  ')).toBe(123456);
  });

  it('parses long grouped amounts exactly', () => {
    expect(parseEuroInput('1.234.567,89')).toBe(123456789);
    expect(parseEuroInput('1,234,567.89')).toBe(123456789);
    expect(parseEuroInput('100.000.000,00')).toBe(10000000000);
  });
});

describe('parseEuroInput – hostile input', () => {
  it('rejects whitespace inside the number', () => {
    for (const input of ['1 000', '1 000,00', '10 0', '1\u00a0000']) {
      expect(parseEuroInput(input), input).toBeNull();
    }
  });

  it('rejects non-ASCII digits', () => {
    expect(parseEuroInput('\u0661\u0660\u0660')).toBeNull(); // Arabic-Indic 100
    expect(parseEuroInput('\uff11\uff10\uff10')).toBeNull(); // full-width 100
  });

  it('rejects numeric literals that are not plain amounts', () => {
    for (const input of ['1e3', '1E3', '0x10', 'Infinity', 'NaN', '1_000', '+100', '-100', '- 5']) {
      expect(parseEuroInput(input), input).toBeNull();
    }
  });

  it('rejects currency symbols and stray characters', () => {
    for (const input of ['100 €', '€100', '100EUR', '1.000,00 €', '100,00%']) {
      expect(parseEuroInput(input), input).toBeNull();
    }
  });

  it('rejects dangling or duplicated separators', () => {
    for (const input of ['', ' ', '.', ',', '1.', '1,', ',5', '.5', '1..5', '1,,5', '1.,5', '1,.5']) {
      expect(parseEuroInput(input), input).toBeNull();
    }
  });

  it('rejects malformed thousands grouping', () => {
    for (const input of ['1.2.3', '12.34.567,89', '1.00,00', '1,00,000.00', '12345.678,90']) {
      expect(parseEuroInput(input), input).toBeNull();
    }
  });

  it('accepts leading zeros', () => {
    expect(parseEuroInput('007')).toBe(700);
    expect(parseEuroInput('00,50')).toBe(50);
    expect(parseEuroInput('0')).toBe(0);
    expect(parseEuroInput('0,00')).toBe(0);
  });

  it('stays inside the safe integer range', () => {
    // 9007199254740991 cents is Number.MAX_SAFE_INTEGER.
    expect(parseEuroInput('90071992547409,91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseEuroInput('90071992547409,92')).toBeNull();
    expect(parseEuroInput('99999999999999999999')).toBeNull();
    expect(parseEuroInput('99.999.999.999.999.999,99')).toBeNull();
  });

  it('is pure: the same input always yields the same result', () => {
    for (const input of ['100', '1.234,56', '100,555', ' 100 ']) {
      expect(parseEuroInput(input)).toBe(parseEuroInput(input));
    }
  });
});

describe('parseEuroInput – documented separator rules (regression pins)', () => {
  it.each([
    ['1.000', 100000], // single dot + exactly three digits = thousands separator
    ['1.000.000', 100000000],
    ['0.000', 0],
    ['1.23', 123], // single dot + two digits = decimal separator
    ['1.2', 120],
    ['1.234', 123400],
    // Consequence of the rule above: "100.555" is read as one hundred thousand
    // five hundred fifty-five euros, NOT as an invalid three-decimal amount.
    // Deliberate and documented in src/lib/money.ts; see finding F2.
    ['100.555', 10055500],
    ['12.345,6', 1234560],
    ['1.234,5', 123450],
    ['5,0', 500],
    ['5,00', 500],
  ])('%j -> %j', (input, expected) => {
    expect(parseEuroInput(input as string)).toBe(expected);
  });
});

describe('formatCents', () => {
  it.each([
    [0, '0,00 €'],
    [1, '0,01 €'],
    [-1, '-0,01 €'],
    [99, '0,99 €'],
    [100, '1,00 €'],
    [-100, '-1,00 €'],
    [99999, '999,99 €'],
    [100000, '1.000,00 €'],
    [-123456789, '-1.234.567,89 €'],
    [Number.MAX_SAFE_INTEGER, '90.071.992.547.409,91 €'],
  ])('formats %j as %j', (cents, expected) => {
    expect(formatCents(cents as number)).toBe(expected);
  });

  it('never renders a negative zero', () => {
    expect(formatCents(-0)).toBe('0,00 €');
  });

  it('groups thousands only, never the decimals', () => {
    expect(formatCents(1234567890)).toBe('12.345.678,90 €');
  });
});

describe('money round-trip is exact (no float drift)', () => {
  it('formatCents -> parseEuroInput is lossless for a dense cent range', () => {
    for (let cents = 0; cents <= 5000; cents += 1) {
      const text = formatCents(cents).replace(' €', '');
      expect(parseEuroInput(text), text).toBe(cents);
    }
  });

  it('formatCents -> parseEuroInput is lossless for large grouped amounts', () => {
    for (const cents of [100000, 100050, 999999, 1000000, 123456789, 987654321]) {
      const text = formatCents(cents).replace(' €', '');
      expect(parseEuroInput(text), text).toBe(cents);
    }
  });

  it('classic float traps stay exact', () => {
    // 8.20 * 100 === 819.9999999999999 in float arithmetic.
    expect(parseEuroInput('8,20')).toBe(820);
    expect(parseEuroInput('1,10')).toBe(110);
    expect(parseEuroInput('2,30')).toBe(230);
    expect(parseEuroInput('29,97')).toBe(2997);
    expect(parseEuroInput('1.000,07')).toBe(100007);
  });
});
