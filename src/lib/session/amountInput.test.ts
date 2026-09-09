import { describe, expect, it } from 'vitest';
import { amountFromInput, amountHint, euroValue } from './amountInput';

/** The amount rules the sheets show the user (docs/ARBEITSPAKETE.md WP5). */

describe('amountFromInput', () => {
  it('parses the German and the English notation into cents', () => {
    expect(amountFromInput('100', false)).toBe(10000);
    expect(amountFromInput('99,50', false)).toBe(9950);
    expect(amountFromInput('1.000,00', false)).toBe(100000);
    expect(amountFromInput(' 100 ', false)).toBe(10000);
  });

  it('rejects anything that is not a plain positive amount', () => {
    for (const value of ['', 'abc', '-5', '100,555', '1e3']) {
      expect(amountFromInput(value, false), value).toBeNull();
    }
  });

  it('rejects an amount above the typo guard, accepts exactly the limit', () => {
    expect(amountFromInput('10000', false)).toBe(1_000_000);
    expect(amountFromInput('10000,01', false)).toBeNull();
  });

  it('allows 0 only where a stack of 0 makes sense', () => {
    expect(amountFromInput('0', false)).toBeNull();
    expect(amountFromInput('0', true)).toBe(0);
    expect(amountFromInput('0,00', true)).toBe(0);
  });
});

describe('amountHint', () => {
  it('says nothing about an empty field', () => {
    expect(amountHint('', false)).toBeNull();
    expect(amountHint('   ', false)).toBeNull();
  });

  it('says nothing about a valid amount', () => {
    expect(amountHint('100', false)).toBeNull();
    expect(amountHint('0', true)).toBeNull();
  });

  it('names the limit in German when the amount is too large', () => {
    expect(amountHint('10001', false)).toBe('Höchstens 10.000,00 €.');
  });

  it('explains an unparsable value', () => {
    expect(amountHint('abc', false)).toContain('gültigen Betrag');
  });

  it('explains a zero where zero is not allowed', () => {
    expect(amountHint('0', false)).toContain('größer als 0');
  });
});

describe('euroValue', () => {
  it('renders whole euros without decimals and cents with two', () => {
    expect(euroValue(10000)).toBe('100');
    expect(euroValue(9950)).toBe('99,50');
    expect(euroValue(5)).toBe('0,05');
    expect(euroValue(0)).toBe('0');
  });

  it('round-trips through parseEuroInput', () => {
    for (const cents of [0, 5, 50, 999, 10000, 123456, 1_000_000]) {
      expect(amountFromInput(euroValue(cents), true)).toBe(cents);
    }
  });
});
