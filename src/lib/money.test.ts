import { describe, expect, it } from 'vitest';
import { formatCents, parseEuroInput } from './money';

describe('parseEuroInput', () => {
  // Cases required by docs/ARBEITSPAKETE.md, WP0 step 6.
  it.each([
    ['100', 10000],
    ['100,5', 10050],
    ['100.50', 10050],
    ['1.000,00', 100000],
    ['1,000.50', 100050],
    ['abc', null],
    ['-5', null],
    ['', null],
    ['0', 0],
  ])('parses %j as %j', (input, expected) => {
    expect(parseEuroInput(input)).toBe(expected);
  });

  it('trims surrounding whitespace', () => {
    expect(parseEuroInput(' 100 ')).toBe(10000);
  });

  it('reads a single dot before three digits as a thousands separator', () => {
    expect(parseEuroInput('1.000')).toBe(100000);
    expect(parseEuroInput('1.000.000')).toBe(100000000);
  });

  it('handles both separators, last one wins as decimal separator', () => {
    expect(parseEuroInput('1.234.567,89')).toBe(123456789);
    expect(parseEuroInput('1,234,567.89')).toBe(123456789);
  });

  it('rejects more than two decimal places', () => {
    expect(parseEuroInput('100,555')).toBeNull();
    expect(parseEuroInput('100.5555')).toBeNull();
    expect(parseEuroInput('1.000,001')).toBeNull();
  });

  it('rejects malformed thousands grouping', () => {
    expect(parseEuroInput('1.00,00')).toBeNull();
    expect(parseEuroInput('12345.678,90')).toBeNull();
    expect(parseEuroInput('1.234,567.89')).toBeNull();
  });

  it('rejects signs, currency symbols and stray characters', () => {
    expect(parseEuroInput('+5')).toBeNull();
    expect(parseEuroInput('5 €')).toBeNull();
    expect(parseEuroInput('1 000')).toBeNull();
    expect(parseEuroInput(',50')).toBeNull();
    expect(parseEuroInput('100,')).toBeNull();
    expect(parseEuroInput('.')).toBeNull();
  });

  it('accepts a single decimal digit and pads it', () => {
    expect(parseEuroInput('0,5')).toBe(50);
    expect(parseEuroInput('0,05')).toBe(5);
  });
});

describe('formatCents', () => {
  it.each([
    [0, '0,00 €'],
    [5, '0,05 €'],
    [50, '0,50 €'],
    [10000, '100,00 €'],
    [123450, '1.234,50 €'],
    [123456789, '1.234.567,89 €'],
    [-1234, '-12,34 €'],
  ])('formats %j as %j', (cents, expected) => {
    expect(formatCents(cents)).toBe(expected);
  });

  it('throws on non-integer, NaN and Infinity instead of showing 0,00 €', () => {
    expect(() => formatCents(NaN)).toThrow(/integer cents/);
    expect(() => formatCents(Infinity)).toThrow(/integer cents/);
    expect(() => formatCents(-Infinity)).toThrow(/integer cents/);
    expect(() => formatCents(10.5)).toThrow(/integer cents/);
    expect(() => formatCents(-0.01)).toThrow(/integer cents/);
  });

  it('accepts negative zero as zero', () => {
    expect(formatCents(-0)).toBe('0,00 €');
  });

  it('round-trips with parseEuroInput', () => {
    for (const cents of [0, 1, 99, 100, 250050, 123456789]) {
      expect(parseEuroInput(formatCents(cents).replace(' €', ''))).toBe(cents);
    }
  });
});
