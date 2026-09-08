import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { distribute } from '@/lib/settlement/distribute';
import { computeSettlement } from '@/lib/settlement';
import type { SettlementParticipant, SettlementResult } from '@/lib/settlement/types';

/**
 * Gaby's counter-examples for WP3 (docs/ARBEITSPAKETE.md, "Testauftrag Gaby").
 *
 * Every expected value in this file was derived by hand from docs/SETTLEMENT.md
 * (stage 1 / stage 2 / stage 3, residuals, greedy transfers) BEFORE running the
 * implementation. The derivation is written out in the comment above each case
 * so a later reader can re-check it without re-running the algorithm.
 *
 * These tests belong to Gaby: they must never be deleted or weakened (CLAUDE.md).
 */

type Row = {
  playerId: string;
  cashIn?: number;
  creditIn?: number;
  stack?: number;
  payout?: number;
};

function participants(rows: readonly Row[]): SettlementParticipant[] {
  return rows.map((row, index) => ({
    playerId: row.playerId,
    name: row.playerId,
    position: index,
    cashIn: row.cashIn ?? 0,
    creditIn: row.creditIn ?? 0,
    stack: row.stack ?? 0,
    payout: row.payout ?? 0,
  }));
}

function tiers(result: SettlementResult): Array<[number, number, number, number, number]> {
  return result.lines.map((line) => [
    line.cashTier1,
    line.cashTier2,
    line.cashTier3,
    line.cashFromBox,
    line.residual,
  ]);
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

/**
 * Structural cross-check that must hold for every result, independent of the
 * hand-derived numbers: the cash box is fully accounted for and no player ever
 * receives more cash than his claim (docs/SETTLEMENT.md, invariants 2 and 4).
 */
function assertBooksBalance(
  rows: readonly SettlementParticipant[],
  result: SettlementResult,
): void {
  const totalPayout = sum(rows.map((row) => row.payout));
  expect(sum(result.lines.map((line) => line.cashFromBox)) + result.unallocatedCash).toBe(
    result.cashBoxStart - totalPayout,
  );
  for (const line of result.lines) {
    expect(line.cashFromBox).toBeLessThanOrEqual(line.claim);
  }
}

describe('(a) three cash payers with stakes of 50 / 100 / 200 EUR', () => {
  // A 50,00 bar / Stack 100,00 · B 100,00 bar / Stack 150,00 · C 200,00 bar / Stack 100,00
  // Buy-ins 350,00 = Stacks 350,00 -> discrepancy 0. box = 350,00.
  // Stage 1: want1 = min(cashIn, stack) = A 50,00 · B 100,00 · C 100,00, sum 250,00 <= box
  //          -> served in full, box = 100,00.
  // Stage 2: want2 = claim - tier1 = A 50,00 · B 50,00 · C 0, sum 100,00 = box
  //          -> served in full, box = 0.
  // Everybody is paid from the box, all residuals 0, no transfers.
  it('pays every stake back and settles fully in cash when the box suffices', () => {
    const rows = participants([
      { playerId: 'A', cashIn: 5000, stack: 10000 },
      { playerId: 'B', cashIn: 10000, stack: 15000 },
      { playerId: 'C', cashIn: 20000, stack: 10000 },
    ]);
    const result = computeSettlement(rows);

    expect(result.discrepancy).toBe(0);
    expect(tiers(result)).toEqual([
      [5000, 5000, 0, 10000, 0],
      [10000, 5000, 0, 15000, 0],
      [10000, 0, 0, 10000, 0],
    ]);
    expect(result.transfers).toEqual([]);
    expect(result.unallocatedCash).toBe(0);
    assertBooksBalance(rows, result);
  });

  // Same three stakes, but a credit player makes stage 2 run short, so the
  // proportional split over *unequal* stakes becomes visible.
  // A 50,00 bar / Stack 200,00 · B 100,00 bar / Stack 200,00 · C 200,00 bar / Stack 50,00
  // D 100,00 Liste / Stack 0. Buy-ins 450,00 = Stacks 450,00 -> discrepancy 0.
  // box = 350,00 (only cash counts).
  // Stage 1: want1 = A 50,00 · B 100,00 · C min(200,00; 50,00) = 50,00, sum 200,00 <= 350,00
  //          -> full, box = 150,00.
  // Stage 2: want2 = A 200,00-50,00 = 150,00 · B 200,00-100,00 = 100,00 · C 50,00-50,00 = 0,
  //          sum 250,00 > box 150,00 -> ration:
  //          A 15000*15000/25000 = 9000 exactly, B 10000*15000/25000 = 6000 exactly,
  //          no remainder left. box = 0.
  // cashFromBox: A 140,00 · B 160,00 · C 50,00 (sum 350,00 = box).
  // residual = claim - cashFromBox - creditIn:
  //          A +60,00 · B +40,00 · C 0 · D 0-0-100,00 = -100,00. Sum 0.
  // Transfers greedy (largest creditor first): D -> A 60,00, D -> B 40,00.
  it('rations stage 2 proportionally over unequal stakes', () => {
    const rows = participants([
      { playerId: 'A', cashIn: 5000, stack: 20000 },
      { playerId: 'B', cashIn: 10000, stack: 20000 },
      { playerId: 'C', cashIn: 20000, stack: 5000 },
      { playerId: 'D', creditIn: 10000, stack: 0 },
    ]);
    const result = computeSettlement(rows);

    expect(result.discrepancy).toBe(0);
    expect(tiers(result)).toEqual([
      [5000, 9000, 0, 14000, 6000],
      [10000, 6000, 0, 16000, 4000],
      [5000, 0, 0, 5000, 0],
      [0, 0, 0, 0, -10000],
    ]);
    expect(result.transfers).toEqual([
      { fromPlayerId: 'D', toPlayerId: 'A', amount: 6000 },
      { fromPlayerId: 'D', toPlayerId: 'B', amount: 4000 },
    ]);
    expect(result.unallocatedCash).toBe(0);
    expect(result.uncoveredClaims).toBe(0);
    assertBooksBalance(rows, result);
  });
});

describe('(b) early leaver whose payout is smaller than his claim', () => {
  // A 100,00 bar / Stack 150,00 / bereits 50,00 bar entnommen (Anspruch waere 150,00).
  // B 100,00 bar / Stack 50,00 · C 100,00 Liste / Stack 100,00.
  // Buy-ins 300,00 = Stacks 300,00 -> discrepancy 0.
  // box = 200,00 - 50,00 = 150,00. claims: A 100,00 · B 50,00 · C 100,00.
  // Stage 1: want1 = A max(0, min(100,00; 150,00) - 50,00) = 50,00 · B 50,00 · C 0,
  //          sum 100,00 <= 150,00 -> full, box = 50,00.
  // Stage 2: want2 = A 100,00-50,00 = 50,00 · B 0, sum 50,00 = box -> full, box = 0.
  // Stage 3: C wants 100,00, box 0 -> nothing.
  // cashFromBox: A 100,00 · B 50,00 · C 0. A has now 50,00 payout + 100,00 = 150,00 = stack.
  // residual: A 100,00-100,00 = 0 · B 0 · C 100,00-0-100,00 = 0 -> no transfers.
  it('tops the early leaver up to his stack out of the remaining box', () => {
    const rows = participants([
      { playerId: 'A', cashIn: 10000, stack: 15000, payout: 5000 },
      { playerId: 'B', cashIn: 10000, stack: 5000 },
      { playerId: 'C', creditIn: 10000, stack: 10000 },
    ]);
    const result = computeSettlement(rows);

    expect(result.cashBoxStart).toBe(20000);
    expect(result.cashBoxAfterPayouts).toBe(15000);
    expect(tiers(result)).toEqual([
      [5000, 5000, 0, 10000, 0],
      [5000, 0, 0, 5000, 0],
      [0, 0, 0, 0, 0],
    ]);
    expect(result.transfers).toEqual([]);
    expect(result.lines[0].netResult).toBe(5000);
    assertBooksBalance(rows, result);
  });

  // Same idea, but the box cannot cover the rest of his claim, so the missing
  // part has to come back as a debt of the credit player.
  // A 100,00 bar / Stack 300,00 / payout 50,00 · B 100,00 bar / Stack 0 ·
  // C 100,00 Liste / Stack 0. Buy-ins 300,00 = Stacks 300,00 -> discrepancy 0.
  // box = 200,00 - 50,00 = 150,00. claims: A 250,00 · B 0 · C 0.
  // Stage 1: want1 = A min(100,00; 300,00) - 50,00 = 50,00 · B min(100,00; 0) = 0,
  //          sum 50,00 <= 150,00 -> full, box = 100,00.
  // Stage 2: want2 = A 250,00-50,00 = 200,00, sum 200,00 > box 100,00 ->
  //          A 20000*10000/20000 = 10000, box = 0.
  // cashFromBox A 150,00 -> A has 50,00 + 150,00 = 200,00 of his 300,00 stack.
  // residual: A 250,00-150,00 = +100,00 · B 0 · C 0-0-100,00 = -100,00.
  // Transfer C -> A 100,00; A then holds 300,00 in total.
  it('turns the uncovered part of his claim into a debt of the credit player', () => {
    const rows = participants([
      { playerId: 'A', cashIn: 10000, stack: 30000, payout: 5000 },
      { playerId: 'B', cashIn: 10000, stack: 0 },
      { playerId: 'C', creditIn: 10000, stack: 0 },
    ]);
    const result = computeSettlement(rows);

    expect(result.discrepancy).toBe(0);
    expect(tiers(result)).toEqual([
      [5000, 10000, 0, 15000, 10000],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, -10000],
    ]);
    expect(result.transfers).toEqual([
      { fromPlayerId: 'C', toPlayerId: 'A', amount: 10000 },
    ]);
    assertBooksBalance(rows, result);
  });
});

describe('(c) everybody on the credit list, no cash at all', () => {
  // A 100,00 Liste / Stack 250,00 · B 100,00 Liste / Stack 100,00 ·
  // C 100,00 Liste / Stack 50,00 · D 100,00 Liste / Stack 0.
  // Buy-ins 400,00 = Stacks 400,00 -> discrepancy 0. cashBoxStart = 0, box = 0.
  // Nobody is a cash player, so stages 1 and 2 are empty; stage 3 wants
  // 250,00 / 100,00 / 50,00 / 0 out of an empty box -> everybody gets 0.
  // residual = claim - 0 - creditIn: A +150,00 · B 0 · C -50,00 · D -100,00.
  // Transfers greedy, largest debtor first: D -> A 100,00, then C -> A 50,00.
  it('produces pure transfers and no cash payouts', () => {
    const rows = participants([
      { playerId: 'A', creditIn: 10000, stack: 25000 },
      { playerId: 'B', creditIn: 10000, stack: 10000 },
      { playerId: 'C', creditIn: 10000, stack: 5000 },
      { playerId: 'D', creditIn: 10000, stack: 0 },
    ]);
    const result = computeSettlement(rows);

    expect(result.discrepancy).toBe(0);
    expect(result.cashBoxStart).toBe(0);
    expect(result.cashBoxAfterPayouts).toBe(0);
    expect(result.unallocatedCash).toBe(0);
    expect(result.uncoveredClaims).toBe(0);
    expect(result.lines.every((line) => line.cashFromBox === 0)).toBe(true);
    expect(result.lines.map((line) => line.residual)).toEqual([15000, 0, -5000, -10000]);
    expect(result.transfers).toEqual([
      { fromPlayerId: 'D', toPlayerId: 'A', amount: 10000 },
      { fromPlayerId: 'C', toPlayerId: 'A', amount: 5000 },
    ]);
    assertBooksBalance(rows, result);
  });
});

describe('(d) nine players with odd cent amounts', () => {
  // Cash: P1 11,11 · P2 22,22 · P3 33,33 · P4 44,44 · P5 55,55 · P6 66,67 = 233,32
  // Credit: P7 12,34 · P8 43,21 · P9 34,56 = 90,11 -> Buy-ins 323,43
  // Stacks: P1..P3 100,00 each, P9 23,43, rest 0 -> 323,43 -> discrepancy 0.
  // box = 233,32 (no payouts).
  // Stage 1: want1 = min(cashIn, stack): P1 1111 · P2 2222 · P3 3333 · P4..P6 0
  //          (their stack is 0), sum 6666 <= 23332 -> full, box = 16666.
  // Stage 2: want2 = claim - tier1: P1 8889 · P2 7778 · P3 6667, sum 23334 > 16666:
  //          P1  8889*16666 = 148 144 074 ; /23334 -> 6348 rest 19 842
  //          P2  7778*16666 = 129 628 148 ; /23334 -> 5555 rest  7 778
  //          P3  6667*16666 = 111 112 222 ; /23334 -> 4761 rest 19 048
  //          assigned 16 664, remainder 2 -> largest remainders P1 (19 842) and
  //          P3 (19 048) get one cent each -> 6349 / 5555 / 4762 (sum 16 666). box = 0.
  // cashFromBox: P1 7460 · P2 7777 · P3 8095 (sum 23 332 = box), rest 0.
  // residual = claim - cashFromBox - creditIn:
  //          P1 +2540 · P2 +2223 · P3 +1905 · P4..P6 0
  //          P7 -1234 · P8 -4321 · P9 2343-3456 = -1113. Sum 0.
  // Transfers greedy (largest debtor vs largest creditor):
  //          P8 4321 -> P1 2540 (P1 done, P8 has 1781)
  //          P8 1781 -> P2 (P8 done, P2 has 442 left)
  //          P7 1234 -> P2 442  (P2 done, P7 has 792)
  //          P7  792 -> P3      (P7 done, P3 has 1113 left)
  //          P9 1113 -> P3      (both done). Sum 6668 = sum of positive residuals.
  const rows: Row[] = [
    { playerId: 'P1', cashIn: 1111, stack: 10000 },
    { playerId: 'P2', cashIn: 2222, stack: 10000 },
    { playerId: 'P3', cashIn: 3333, stack: 10000 },
    { playerId: 'P4', cashIn: 4444, stack: 0 },
    { playerId: 'P5', cashIn: 5555, stack: 0 },
    { playerId: 'P6', cashIn: 6667, stack: 0 },
    { playerId: 'P7', creditIn: 1234, stack: 0 },
    { playerId: 'P8', creditIn: 4321, stack: 0 },
    { playerId: 'P9', creditIn: 3456, stack: 2343 },
  ];

  it('splits the box to the cent and settles the rest by transfers', () => {
    const input = participants(rows);
    const result = computeSettlement(input);

    expect(result.totalBuyIn).toBe(32343);
    expect(result.totalStack).toBe(32343);
    expect(result.discrepancy).toBe(0);
    expect(result.cashBoxStart).toBe(23332);

    expect(result.lines.map((line) => line.cashTier1)).toEqual([
      1111, 2222, 3333, 0, 0, 0, 0, 0, 0,
    ]);
    expect(result.lines.map((line) => line.cashTier2)).toEqual([
      6349, 5555, 4762, 0, 0, 0, 0, 0, 0,
    ]);
    expect(result.lines.map((line) => line.cashTier3)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(result.lines.map((line) => line.cashFromBox)).toEqual([
      7460, 7777, 8095, 0, 0, 0, 0, 0, 0,
    ]);
    expect(result.lines.map((line) => line.residual)).toEqual([
      2540, 2223, 1905, 0, 0, 0, -1234, -4321, -1113,
    ]);
    expect(result.transfers).toEqual([
      { fromPlayerId: 'P8', toPlayerId: 'P1', amount: 2540 },
      { fromPlayerId: 'P8', toPlayerId: 'P2', amount: 1781 },
      { fromPlayerId: 'P7', toPlayerId: 'P2', amount: 442 },
      { fromPlayerId: 'P7', toPlayerId: 'P3', amount: 792 },
      { fromPlayerId: 'P9', toPlayerId: 'P3', amount: 1113 },
    ]);
    expect(sum(result.transfers.map((entry) => entry.amount))).toBe(6668);
    expect(result.unallocatedCash).toBe(0);
    expect(result.uncoveredClaims).toBe(0);
    assertBooksBalance(input, result);
  });

  it('is deterministic: the same input twice gives the identical result', () => {
    const first = computeSettlement(participants(rows));
    const second = computeSettlement(participants(rows));

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('(e) permutation of the input', () => {
  const rows: Row[] = [
    { playerId: 'P1', cashIn: 1111, stack: 10000 },
    { playerId: 'P2', cashIn: 2222, stack: 10000 },
    { playerId: 'P3', cashIn: 3333, stack: 10000 },
    { playerId: 'P4', creditIn: 4444, stack: 0 },
    { playerId: 'P5', creditIn: 5555, stack: 6665 },
  ];

  /** All 120 permutations of five participants. */
  function permutations<T>(items: readonly T[]): T[][] {
    if (items.length <= 1) return [[...items]];
    const out: T[][] = [];
    items.forEach((item, index) => {
      const rest = [...items.slice(0, index), ...items.slice(index + 1)];
      for (const tail of permutations(rest)) out.push([item, ...tail]);
    });
    return out;
  }

  it('gives the identical result for every one of the 120 orderings', () => {
    const base = participants(rows);
    const expected = computeSettlement(base);

    const all = permutations(base);
    expect(all).toHaveLength(120);
    for (const permuted of all) {
      expect(computeSettlement(permuted)).toEqual(expected);
    }
  });

  it('also holds for random permutations of random sessions (invariant 7)', () => {
    fc.assert(
      fc.property(
        fc
          .array(
            fc.record({
              cashIn: fc.integer({ min: 0, max: 40000 }),
              creditIn: fc.integer({ min: 0, max: 40000 }),
              stack: fc.integer({ min: 0, max: 60000 }),
            }),
            { minLength: 2, maxLength: 8 },
          )
          .chain((base) =>
            fc.record({
              base: fc.constant(base),
              order: fc.array(fc.integer({ min: 0, max: 1_000_000 }), {
                minLength: base.length,
                maxLength: base.length,
              }),
            }),
          ),
        ({ base, order }) => {
          const input: SettlementParticipant[] = base.map((row, index) => ({
            playerId: `p${index}`,
            name: `Spieler ${index}`,
            position: index,
            cashIn: row.cashIn,
            creditIn: row.creditIn,
            stack: row.stack,
            payout: 0,
          }));
          const shuffled = input
            .map((row, index) => ({ row, key: order[index] }))
            .sort((a, b) => a.key - b.key)
            .map((entry) => entry.row);

          expect(computeSettlement(shuffled)).toEqual(computeSettlement(input));
        },
      ),
      { numRuns: 500 },
    );
  });
});

/**
 * Attack on invariant 6: is there ANY valid input where a credit player gets
 * cash out of the box while a cash payer still has an open claim?
 *
 * The generator is deliberately wider than the one in
 * src/lib/settlement/settlement.property.test.ts: stacks are unconstrained
 * (missing and surplus chips), payouts are pushed to the limit of both
 * preconditions (payout <= stack, sum payout <= sum cashIn), and pure credit
 * rounds as well as pure cash rounds occur.
 */
describe('invariant 6 under attack: cash payers before credit players', () => {
  const sessionArbitrary = fc
    .integer({ min: 2, max: 9 })
    .chain((size) =>
      fc.record({
        cash: fc.array(fc.integer({ min: 0, max: 30000 }), { minLength: size, maxLength: size }),
        credit: fc.array(fc.integer({ min: 0, max: 30000 }), { minLength: size, maxLength: size }),
        stack: fc.array(fc.integer({ min: 0, max: 60000 }), { minLength: size, maxLength: size }),
        payoutSeed: fc.array(fc.integer({ min: 0, max: 4_000_000 }), {
          minLength: size,
          maxLength: size,
        }),
        // Drives *who* takes cash out first, which is what can starve stage 1.
        payoutOrder: fc.array(fc.integer({ min: 0, max: 1_000_000 }), {
          minLength: size,
          maxLength: size,
        }),
      }),
    )
    .map(({ cash, credit, stack, payoutSeed, payoutOrder }) => {
      let boxLeft = sum(cash);
      const payout = new Array<number>(cash.length).fill(0);
      const order = cash
        .map((_, index) => index)
        .sort((a, b) => payoutOrder[a] - payoutOrder[b]);
      for (const index of order) {
        const wanted = stack[index] === 0 ? 0 : payoutSeed[index] % (stack[index] + 1);
        const granted = Math.min(wanted, boxLeft);
        payout[index] = granted;
        boxLeft -= granted;
      }
      return cash.map((cashIn, index) => ({
        playerId: `p${index}`,
        name: `Spieler ${index}`,
        position: index,
        cashIn,
        creditIn: credit[index],
        stack: stack[index],
        payout: payout[index],
      }));
    });

  it('never hands cash to a credit player while a cash payer is still open', () => {
    fc.assert(
      fc.property(sessionArbitrary, (input) => {
        const result = computeSettlement(input);
        const totalTier3 = sum(result.lines.map((line) => line.cashTier3));
        if (totalTier3 === 0) return;

        for (const line of result.lines) {
          if (line.isCashPlayer) {
            // Every cash payer must be fully served out of the box first.
            expect(line.cashTier1 + line.cashTier2).toBe(line.claim);
            expect(line.cashTier3).toBe(0);
          } else {
            expect(line.cashTier1).toBe(0);
            expect(line.cashTier2).toBe(0);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('keeps the tier structure clean: no cash payer is served out of tier 3', () => {
    fc.assert(
      fc.property(sessionArbitrary, (input) => {
        const result = computeSettlement(input);
        for (const line of result.lines) {
          expect(line.isCashPlayer).toBe(line.cashIn > 0);
          if (line.isCashPlayer) expect(line.cashTier3).toBe(0);
          else expect(line.cashTier1 + line.cashTier2).toBe(0);
        }
        assertBooksBalance(input, result);
      }),
      { numRuns: 1000 },
    );
  });

  // Invariant 5 in the sharpened wording of docs/SETTLEMENT.md (the planner's
  // current version): a cash payer with stack >= cashIn and payout == 0 gets at
  // least his cashIn back, provided NO player took more cash out of the box
  // than he paid in himself (payout_j <= cashIn_j for all j).
  it('serves stage 1 in full as long as nobody overdrew his own cash-in', () => {
    fc.assert(
      fc.property(sessionArbitrary, (input) => {
        if (input.some((row) => row.payout > row.cashIn)) return;
        const result = computeSettlement(input);
        for (const line of result.lines) {
          if (line.isCashPlayer && line.stack >= line.cashIn && line.payout === 0) {
            expect(line.cashFromBox).toBeGreaterThanOrEqual(line.cashIn);
          }
        }
      }),
      { numRuns: 2000 },
    );
  });

  // The counter-example to the OLD wording of invariant 5, kept as a regression
  // guard for the sharpened rule: the box is drained by a CASH player who took
  // more than his own cash-in, and stage 1 is rationed to zero all the same.
  // A 100,00 bar / Stack 100,00 · C 50,00 bar / Stack 150,00 / payout 150,00 ·
  // D 100,00 Liste / Stack 0. box = 150,00 - 150,00 = 0.
  // claims: A 100,00 · C 0 · D 0. Stage 1 want A 100,00, box 0 -> A gets 0.
  // residual: A +100,00 · C 0 · D 0-0-100,00 = -100,00 -> D owes A 100,00.
  it('rations stage 1 when a cash player overdrew the box (sharpened invariant 5)', () => {
    const rows = participants([
      { playerId: 'A', cashIn: 10000, stack: 10000 },
      { playerId: 'C', cashIn: 5000, stack: 15000, payout: 15000 },
      { playerId: 'D', creditIn: 10000, stack: 0 },
    ]);
    const result = computeSettlement(rows);

    expect(result.cashBoxAfterPayouts).toBe(0);
    expect(tiers(result)).toEqual([
      [0, 0, 0, 0, 10000],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, -10000],
    ]);
    expect(result.transfers).toEqual([
      { fromPlayerId: 'D', toPlayerId: 'A', amount: 10000 },
    ]);
    assertBooksBalance(rows, result);
  });
});

describe('distribute: largest remainder and its tie-break in input order', () => {
  // Three receivers with identical wants therefore have identical fractional
  // parts; the leftover cents must go to the earliest entries.
  it('gives the single leftover cent to the first of three equal receivers', () => {
    // wants 30/30/30, sum 90, box 88: 30*88/90 = 29.333... -> floor 29 each,
    // remainders all 30/90, assigned 87, exactly one cent left -> first wins.
    expect(distribute(88, [30, 30, 30])).toEqual([30, 29, 29]);
  });

  it('gives two leftover cents to the first two of three equal receivers', () => {
    // box 89: 30*89/90 = 29.666... -> floor 29 each, assigned 87, two cents
    // left, identical remainders -> the two earliest receivers win.
    expect(distribute(89, [30, 30, 30])).toEqual([30, 30, 29]);
  });

  it('breaks the tie by input order even when the wants differ', () => {
    // wants 1/1/4, sum 6, box 4: numerators 4, 4, 16; modulo 6 all three leave
    // the same remainder 4, floors are 0, 0, 2 -> two cents left, and the two
    // earliest receivers win, not the largest want.
    expect(distribute(4, [1, 1, 4])).toEqual([1, 1, 2]);
    // Reordered input: the same three equal fractional parts, other winners.
    expect(distribute(4, [4, 1, 1])).toEqual([3, 1, 0]);
  });

  it('prefers a strictly larger remainder over the input order', () => {
    // wants 1/2/3, sum 6, box 4: floors 0, 1, 2, remainders 4/6, 2/6, 0 ->
    // the single leftover cent goes to the first, which also has the largest
    // remainder; with 2/1/3 it must follow the remainder, not the position.
    expect(distribute(4, [2, 1, 3])).toEqual([1, 1, 2]);
  });

  // Exactness beyond the float-safe range: want*box is about 2.8e18 here, far
  // above Number.MAX_SAFE_INTEGER, so the naive float term
  // `Math.floor(want * box / total)` floors to 768 155 624 while the exact
  // share is 768 155 625. The BigInt implementation must return the exact value.
  // (At realistic money magnitudes a float version would still pass, because
  // the largest-remainder step repairs single-cent errors; the real proof of
  // float freedom is that the only division in distribute.ts is on bigint.)
  it('stays exact where a float product would already have lost precision', () => {
    const want = 1_796_508_745;
    const box = 1_536_311_250;
    const exactShare = 768_155_625;
    const naiveFloor = Math.floor((want * box) / (2 * want));

    expect(box).toBeLessThan(2 * want); // the box really has to be rationed
    expect(want * box).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(distribute(box, [want, want])).toEqual([exactShare, exactShare]);
    expect(naiveFloor).toBe(exactShare - 1);
  });

  it('never hands out more than the box or more than a want', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.array(fc.integer({ min: 0, max: 500_000 }), { minLength: 0, maxLength: 15 }),
        (box, wants) => {
          const got = distribute(box, wants);
          expect(sum(got)).toBe(Math.min(box, sum(wants)));
          got.forEach((value, index) => {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(wants[index]);
            expect(Number.isInteger(value)).toBe(true);
          });
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe('further attacks', () => {
  it('does not mutate the given participants or the given array', () => {
    const input = participants([
      { playerId: 'A', cashIn: 10000, stack: 20000 },
      { playerId: 'B', cashIn: 10000, stack: 4000 },
      { playerId: 'C', creditIn: 10000, stack: 6000 },
    ]);
    const frozen = input.map((row) => Object.freeze({ ...row }));
    const snapshot = JSON.stringify(frozen);

    expect(() => computeSettlement(frozen)).not.toThrow();
    expect(JSON.stringify(frozen)).toBe(snapshot);
    expect(frozen.map((row) => row.playerId)).toEqual(['A', 'B', 'C']);
  });

  // A missing-chips session where the credit player's debt has no creditor at
  // all. docs/SETTLEMENT.md, step 5, says a remaining debtor rest "is already
  // visible as unallocatedCash" - here unallocatedCash is 0 while a debt of
  // 100,00 EUR stays unassigned, so the sentence is only a rough description.
  // A 100,00 bar / Stack 50,00 · B 100,00 Liste / Stack 50,00.
  // Buy-ins 200,00, Stacks 100,00 -> discrepancy -100,00. box = 100,00.
  // Stage 1: A wants min(100,00; 50,00) = 50,00 -> full, box = 50,00.
  // Stage 2: A wants 50,00-50,00 = 0. Stage 3: B wants 50,00 <= box -> full, box = 0.
  // residual: A 0 · B 50,00-50,00-100,00 = -100,00. No creditor -> no transfers.
  it('absorbs an unassigned debt when chips are missing', () => {
    const rows = participants([
      { playerId: 'A', cashIn: 10000, stack: 5000 },
      { playerId: 'B', creditIn: 10000, stack: 5000 },
    ]);
    const result = computeSettlement(rows);

    expect(result.discrepancy).toBe(-10000);
    expect(tiers(result)).toEqual([
      [5000, 0, 0, 5000, 0],
      [0, 0, 5000, 5000, -10000],
    ]);
    expect(result.unallocatedCash).toBe(0);
    expect(result.uncoveredClaims).toBe(0);
    expect(result.transfers).toEqual([]);
    assertBooksBalance(rows, result);
  });
});

/**
 * docs/SETTLEMENT.md, step 5, calls the transfer matching "greedy, minimale
 * Anzahl". The greedy is exactly what the document prescribes and what the
 * implementation does, but it does NOT always produce the minimal number of
 * transfers. This test pins the specified (greedy) behaviour down and documents
 * the shorter solution, so a later change is a conscious decision.
 */
describe('greedy transfers are the specified ones, but not always the fewest', () => {
  // Pure credit round, so the box is empty and residual = stack - creditIn.
  // A 100,00 Liste / Stack 400,00 -> +300,00
  // B 100,00 Liste / Stack 300,00 -> +200,00
  // C 100,00 Liste / Stack 300,00 -> +200,00
  // D 400,00 Liste / Stack 100,00 -> -300,00
  // E 500,00 Liste / Stack 100,00 -> -400,00
  // Buy-ins 1.200,00 = Stacks 1.200,00 -> discrepancy 0.
  // Greedy (largest debtor vs largest creditor) needs four transfers:
  //   E -> A 300,00 (A done, E has 100,00)
  //   E -> B 100,00 (E done, B has 100,00 left)
  //   D -> B 100,00 (B done, D has 200,00)
  //   D -> C 200,00 (both done)
  // Three would be enough: D -> A 300,00, E -> B 200,00, E -> C 200,00.
  it('needs four transfers where three would settle the same residuals', () => {
    const rows = participants([
      { playerId: 'A', creditIn: 10000, stack: 40000 },
      { playerId: 'B', creditIn: 10000, stack: 30000 },
      { playerId: 'C', creditIn: 10000, stack: 30000 },
      { playerId: 'D', creditIn: 40000, stack: 10000 },
      { playerId: 'E', creditIn: 50000, stack: 10000 },
    ]);
    const result = computeSettlement(rows);

    expect(result.discrepancy).toBe(0);
    expect(result.lines.map((line) => line.residual)).toEqual([
      30000, 20000, 20000, -30000, -40000,
    ]);
    expect(result.transfers).toEqual([
      { fromPlayerId: 'E', toPlayerId: 'A', amount: 30000 },
      { fromPlayerId: 'E', toPlayerId: 'B', amount: 10000 },
      { fromPlayerId: 'D', toPlayerId: 'B', amount: 10000 },
      { fromPlayerId: 'D', toPlayerId: 'C', amount: 20000 },
    ]);
    expect(result.transfers).toHaveLength(4);
    expect(sum(result.transfers.map((entry) => entry.amount))).toBe(70000);
  });
});
