import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeSettlement } from './index';
import type { SettlementParticipant, SettlementResult } from './types';

/**
 * Property tests for the nine invariants of `docs/SETTLEMENT.md`.
 *
 * The generator builds realistic sessions: 2-10 participants, buy-ins between
 * 0 and 1.000,00 EUR in 50 cent steps, payouts never above the own stack and
 * never above the cash box. The main generator additionally spreads the stacks
 * so that `discrepancy === 0` (a clean evening); a second generator drops that
 * constraint to cover missing and surplus chips.
 *
 * All helpers below use integer arithmetic only.
 */

const NUM_RUNS = 500;

type Seed = {
  size: number;
  cash: number[];
  credit: number[];
  stackSeeds: number[];
  stackSelfSeeds: number[];
  payoutSeeds: number[];
};

const seedArbitrary = fc
  .integer({ min: 2, max: 10 })
  .chain((size) =>
    fc.record({
      size: fc.constant(size),
      // 0 .. 100000 cents in 50 cent steps
      cash: fc.array(fc.integer({ min: 0, max: 2000 }).map((n) => n * 50), {
        minLength: size,
        maxLength: size,
      }),
      credit: fc.array(fc.integer({ min: 0, max: 2000 }).map((n) => n * 50), {
        minLength: size,
        maxLength: size,
      }),
      stackSeeds: fc.array(fc.integer({ min: 0, max: 4_000_000 }), {
        minLength: size,
        maxLength: size,
      }),
      stackSelfSeeds: fc.array(fc.integer({ min: 0, max: 4_000_000 }), {
        minLength: size,
        maxLength: size,
      }),
      payoutSeeds: fc.array(fc.integer({ min: 0, max: 4_000_000 }), {
        minLength: size,
        maxLength: size,
      }),
    }),
  );

/** Splits `total` onto `seeds.length` non-negative integer parts, exactly. */
function splitExact(total: number, seeds: readonly number[]): number[] {
  const parts: number[] = [];
  let remaining = total;
  for (let i = 0; i < seeds.length - 1; i += 1) {
    const share = seeds[i] % (remaining + 1);
    parts.push(share);
    remaining -= share;
  }
  parts.push(remaining);
  return parts;
}

/** Session with `discrepancy === 0`: the stacks add up to the buy-ins. */
function buildBalanced(seed: Seed): SettlementParticipant[] {
  const totalBuyIn = sum(seed.cash) + sum(seed.credit);
  const stacks = splitExact(totalBuyIn, seed.stackSeeds);
  return assemble(seed, stacks);
}

/** Session with arbitrary stacks, so chips may be missing or surplus. */
function buildUnbalanced(seed: Seed): SettlementParticipant[] {
  const stacks = seed.stackSelfSeeds.map((value) => value % 200_001);
  return assemble(seed, stacks);
}

/**
 * Session with a deliberately chosen discrepancy: the stacks add up to the
 * buy-ins plus `delta`, so both signs of `discrepancy` are hit on purpose
 * instead of by chance. `delta` is clamped when it would drive the total below
 * zero; the assertions read `result.discrepancy`, never `delta`.
 */
function buildWithDiscrepancy(seed: Seed, delta: number): SettlementParticipant[] {
  const totalBuyIn = sum(seed.cash) + sum(seed.credit);
  const stacks = splitExact(Math.max(0, totalBuyIn + delta), seed.stackSeeds);
  return assemble(seed, stacks);
}

function assemble(seed: Seed, stacks: readonly number[]): SettlementParticipant[] {
  let boxLeft = sum(seed.cash);
  const payouts = stacks.map((stack, index) => {
    const wanted = stack === 0 ? 0 : seed.payoutSeeds[index] % (stack + 1);
    const payout = Math.min(wanted, boxLeft);
    boxLeft -= payout;
    return payout;
  });

  return stacks.map((stack, index) => ({
    playerId: `p${index}`,
    name: `Spieler ${index}`,
    position: index,
    cashIn: seed.cash[index],
    creditIn: seed.credit[index],
    stack,
    payout: payouts[index],
  }));
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

/** Invariants that hold for every valid input, no matter the discrepancy. */
function checkGeneralInvariants(
  participants: readonly SettlementParticipant[],
  result: SettlementResult,
): void {
  // 1 – integers, and non-negative except residual / netResult / discrepancy.
  const nonNegative = [
    result.totalBuyIn,
    result.totalStack,
    result.cashBoxStart,
    result.cashBoxAfterPayouts,
    result.unallocatedCash,
    result.uncoveredClaims,
    result.uncoveredDebts,
    ...result.lines.flatMap((line) => [
      line.cashTier1,
      line.cashTier2,
      line.cashTier3,
      line.cashFromBox,
      line.claim,
    ]),
    ...result.transfers.map((entry) => entry.amount),
  ];
  for (const value of nonNegative) {
    expect(Number.isInteger(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
  }
  for (const line of result.lines) {
    expect(Number.isInteger(line.residual)).toBe(true);
    expect(Number.isInteger(line.netResult)).toBe(true);
  }
  expect(Number.isInteger(result.discrepancy)).toBe(true);

  // 2 – the cash box is fully accounted for.
  const totalPayout = sum(participants.map((p) => p.payout));
  expect(sum(result.lines.map((line) => line.cashFromBox)) + result.unallocatedCash).toBe(
    result.cashBoxStart - totalPayout,
  );
  expect(result.cashBoxAfterPayouts).toBe(result.cashBoxStart - totalPayout);

  // 4 – nobody receives more cash than his claim.
  for (const line of result.lines) {
    expect(line.cashFromBox).toBeLessThanOrEqual(line.claim);
    expect(line.cashTier1 + line.cashTier2 + line.cashTier3).toBe(line.cashFromBox);
  }

  // 6 – credit players only get cash once every cash payer is served.
  const totalTier3 = sum(result.lines.map((line) => line.cashTier3));
  if (totalTier3 > 0) {
    for (const line of result.lines) {
      if (line.isCashPlayer) {
        expect(line.cashTier1 + line.cashTier2).toBe(line.claim);
      } else {
        expect(line.cashTier1).toBe(0);
        expect(line.cashTier2).toBe(0);
      }
    }
  }

  // 8 – no self transfers, no zero transfers.
  for (const entry of result.transfers) {
    expect(entry.fromPlayerId).not.toBe(entry.toPlayerId);
    expect(entry.amount).toBeGreaterThan(0);
  }

  // 9 – transfers never exceed either side of the residuals.
  const positive = sum(result.lines.map((line) => Math.max(0, line.residual)));
  const negative = sum(result.lines.map((line) => Math.max(0, -line.residual)));
  expect(sum(result.transfers.map((entry) => entry.amount))).toBeLessThanOrEqual(
    Math.min(positive, negative),
  );

  // Step 5 – the discrepancy is explained completely and only by the two
  // uncovered sums plus the cash left in the box. Nothing is silently dropped.
  if (result.discrepancy < 0) {
    expect(result.unallocatedCash + result.uncoveredDebts).toBe(-result.discrepancy);
    expect(result.uncoveredClaims).toBe(0);
  } else if (result.discrepancy > 0) {
    expect(result.uncoveredClaims).toBe(result.discrepancy);
    expect(result.unallocatedCash).toBe(0);
    expect(result.uncoveredDebts).toBe(0);
  } else {
    expect(result.unallocatedCash).toBe(0);
    expect(result.uncoveredClaims).toBe(0);
    expect(result.uncoveredDebts).toBe(0);
  }

  // 5 – a cash payer with stack >= cashIn and payout 0 gets his stake back, as
  // long as nobody has taken more cash out of the box than he put in himself.
  // This is the condition of docs/SETTLEMENT.md verbatim (`payout_j <= cashIn_j`
  // for all j); the counterexample of a cash player draining the box is kept as
  // a regression test in settlement.test.ts ("invariant 5 - stage 1 depends on
  // who drained the box").
  const overdrawn = participants.some((p) => p.payout > p.cashIn);
  if (!overdrawn) {
    for (const line of result.lines) {
      if (line.isCashPlayer && line.stack >= line.cashIn && line.payout === 0) {
        expect(line.cashFromBox).toBeGreaterThanOrEqual(line.cashIn);
      }
    }
  }
}

describe('computeSettlement - properties (docs/SETTLEMENT.md, invariants 1-9)', () => {
  it('holds all invariants for balanced sessions (discrepancy = 0)', () => {
    fc.assert(
      fc.property(seedArbitrary, (seed) => {
        const input = buildBalanced(seed);
        const result = computeSettlement(input);

        expect(result.discrepancy).toBe(0);
        checkGeneralInvariants(input, result);

        // 3 – a clean evening settles completely.
        expect(sum(result.lines.map((line) => line.residual))).toBe(0);
        expect(result.unallocatedCash).toBe(0);
        expect(result.uncoveredClaims).toBe(0);
        const positive = sum(result.lines.map((line) => Math.max(0, line.residual)));
        expect(sum(result.transfers.map((entry) => entry.amount))).toBe(positive);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('holds the general invariants for missing and surplus chips', () => {
    fc.assert(
      fc.property(seedArbitrary, (seed) => {
        const input = buildUnbalanced(seed);
        const result = computeSettlement(input);

        checkGeneralInvariants(input, result);
        expect(result.discrepancy).toBe(result.totalStack - result.totalBuyIn);
        if (result.discrepancy >= 0) {
          expect(result.unallocatedCash).toBe(0);
        }
        if (result.discrepancy <= 0) {
          expect(result.uncoveredClaims).toBe(0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('explains a deliberately produced discrepancy by the step 5 equations', () => {
    const seenSigns = new Set<number>();
    // Missing and surplus chips get their own branch instead of being left to
    // chance; `discrepancy === 0` is already covered by the balanced property.
    const deltaArbitrary = fc.oneof(
      fc.integer({ min: -50_000, max: -1 }),
      fc.integer({ min: 1, max: 50_000 }),
    );

    fc.assert(
      fc.property(seedArbitrary, deltaArbitrary, (seed, delta) => {
        const input = buildWithDiscrepancy(seed, delta);
        const result = computeSettlement(input);

        seenSigns.add(Math.sign(result.discrepancy));
        checkGeneralInvariants(input, result);
      }),
      { numRuns: NUM_RUNS },
    );

    // The generator is only useful if it really produces both signs.
    expect(seenSigns.has(-1)).toBe(true);
    expect(seenSigns.has(1)).toBe(true);
  });

  it('reports an uncovered debt when no creditor is left (TV9b generalised)', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.integer({ min: 0, max: 2000 }).map((n) => n * 50), {
            minLength: 2,
            maxLength: 8,
          })
          .filter((credits) => sum(credits) > 0),
        (credits) => {
          // Everybody is on the credit list and every stack is zero: the box is
          // empty, so nobody can be paid and every buy-in is a missing chip.
          const input: SettlementParticipant[] = credits.map((creditIn, index) => ({
            playerId: `p${index}`,
            name: `Spieler ${index}`,
            position: index,
            cashIn: 0,
            creditIn,
            stack: 0,
            payout: 0,
          }));
          const result = computeSettlement(input);

          expect(result.discrepancy).toBe(-sum(credits));
          expect(result.transfers).toEqual([]);
          expect(result.unallocatedCash).toBe(0);
          expect(result.uncoveredClaims).toBe(0);
          expect(result.uncoveredDebts).toBe(sum(credits));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('is deterministic and independent of the input permutation (invariant 7)', () => {
    fc.assert(
      fc.property(seedArbitrary, (seed) => {
        const input = buildBalanced(seed);
        const first = computeSettlement(input);
        const again = computeSettlement(input);
        const reversed = computeSettlement([...input].reverse());
        const rotated = computeSettlement([...input.slice(1), input[0]]);

        expect(again).toEqual(first);
        expect(reversed).toEqual(first);
        expect(rotated).toEqual(first);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
