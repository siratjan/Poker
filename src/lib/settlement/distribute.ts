import { assertAmount } from './errors';

// The project targets ES2017, where BigInt *literals* (`0n`) are not available;
// the BigInt() constructor is. These two constants keep the code below readable.
const ZERO = BigInt(0);
const ONE = BigInt(1);

/**
 * Distributes `min(box, Σ wants)` proportionally to `wants` onto integer cents,
 * without rounding errors (`docs/SETTLEMENT.md`, "Hilfsfunktion distribute").
 *
 * 1. `Σ wants <= box`: everybody receives exactly `want_i`.
 * 2. Otherwise `share_i = want_i * box / Σ wants` is computed as an exact
 *    fraction in BigInt arithmetic, `got_i = floor(share_i)`. The remainder
 *    `box - Σ got_i` (always smaller than the number of receivers) is handed
 *    out in whole cents by the largest-remainder method; on equal remainders
 *    the earlier entry in the input order wins.
 *
 * Invariant: `Σ got === min(box, Σ wants)` exactly.
 *
 * There is deliberately no float arithmetic in this file: the only division is
 * BigInt division, which truncates towards zero and is exact for the
 * non-negative values guarded above.
 */
export function distribute(box: number, wants: readonly number[]): number[] {
  assertAmount(box, 'box');
  for (const want of wants) {
    assertAmount(want, 'want');
  }

  const boxBig = BigInt(box);
  let totalWant = ZERO;
  for (const want of wants) {
    totalWant += BigInt(want);
  }

  // Case 1: the box covers every want, nothing has to be rationed.
  if (totalWant <= boxBig) {
    return [...wants];
  }

  // Case 2: proportional share plus largest remainder. `totalWant > boxBig >= 0`
  // implies `totalWant > 0`, so the division below is always defined.
  const got: bigint[] = [];
  const remainders: bigint[] = [];
  let assigned = ZERO;
  for (const want of wants) {
    const numerator = BigInt(want) * boxBig;
    const share = numerator / totalWant;
    got.push(share);
    remainders.push(numerator % totalWant);
    assigned += share;
  }

  let rest = boxBig - assigned;
  const byRemainder = wants.map((_, index) => index).sort((a, b) => {
    if (remainders[a] !== remainders[b]) {
      return remainders[a] > remainders[b] ? -1 : 1;
    }
    return a - b; // tie-break: input order
  });

  for (const index of byRemainder) {
    if (rest === ZERO) break;
    got[index] += ONE;
    rest -= ONE;
  }

  // `rest` is now zero: it is smaller than the number of receivers with a
  // non-zero want, so every cent found a receiver above.
  return got.map((value) => Number(value));
}
