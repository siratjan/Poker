import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distribute } from './distribute';

describe('distribute', () => {
  it('returns an empty result for an empty want list', () => {
    expect(distribute(1000, [])).toEqual([]);
  });

  it('returns zeros when every want is zero', () => {
    expect(distribute(1000, [0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('returns zeros when the box is empty', () => {
    expect(distribute(0, [100, 200, 0])).toEqual([0, 0, 0]);
  });

  it('serves every want fully when the box covers the sum', () => {
    expect(distribute(300, [100, 200])).toEqual([100, 200]);
    expect(distribute(301, [100, 200])).toEqual([100, 200]);
  });

  it('splits proportionally and hands the remainder to the largest remainders', () => {
    // TV8: three equal wants of 100.00 EUR share 200.00 EUR.
    expect(distribute(20000, [10000, 10000, 10000])).toEqual([6667, 6667, 6666]);
  });

  it('breaks equal remainders by input order', () => {
    expect(distribute(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(distribute(1, [1, 1])).toEqual([1, 0]);
  });

  it('ignores zero wants when handing out the remainder', () => {
    expect(distribute(5, [0, 3, 3, 0])).toEqual([0, 3, 2, 0]);
  });

  it('prefers the larger remainder over the input order', () => {
    // box 4 of 6 wanted: shares 0.66, 1.33, 2.0 -> floors 0, 1, 2, rest 1.
    // remainders 4/6, 2/6, 0 -> the largest remainder wins, not the input order.
    expect(distribute(4, [1, 2, 3])).toEqual([1, 1, 2]);
    expect(distribute(4, [2, 1, 3])).toEqual([1, 1, 2]);
  });

  it('stays exact far beyond the float-safe integer range', () => {
    const want = 10 ** 15;
    const got = distribute(want, [want, want + 1]);

    expect(got[0] + got[1]).toBe(want);
    expect(got[0]).toBeLessThanOrEqual(want);
    expect(got[1]).toBeLessThanOrEqual(want + 1);
    expect(got.every((value) => Number.isInteger(value))).toBe(true);
  });

  it.each([
    ['a negative box', -1, [10], 'NEGATIVE_AMOUNT'],
    ['a non-integer box', 1.5, [10], 'NON_INTEGER_AMOUNT'],
    ['a negative want', 10, [-1], 'NEGATIVE_AMOUNT'],
    ['a non-integer want', 10, [1.5], 'NON_INTEGER_AMOUNT'],
  ])('rejects %s', (_label, box, wants, code) => {
    expect(() => distribute(box as number, wants as number[])).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it('keeps its invariant for random inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.array(fc.integer({ min: 0, max: 200_000 }), { minLength: 0, maxLength: 12 }),
        (box, wants) => {
          const got = distribute(box, wants);
          const totalWant = wants.reduce((sum, want) => sum + want, 0);
          const totalGot = got.reduce((sum, value) => sum + value, 0);

          expect(got).toHaveLength(wants.length);
          expect(totalGot).toBe(Math.min(box, totalWant));
          got.forEach((value, index) => {
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(wants[index]);
          });
        },
      ),
      { numRuns: 500 },
    );
  });
});
