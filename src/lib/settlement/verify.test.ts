import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeSettlement } from './index';
import { verifySettlement } from './verify';
import type { FrozenSettlement, SettlementParticipant, SettlementResult } from './types';

/**
 * `verifySettlement` is the last gate before a settlement is frozen
 * (docs/ARBEITSPAKETE.md WP6, Testauftrag Gaby). Two things have to hold:
 *
 * 1. **No false alarm.** Every settlement `computeSettlement` produces must pass
 *    — otherwise the table cannot close its evening, which is the expensive
 *    failure.
 * 2. **It catches what the database lets through.** The two documented gaps of
 *    `close_session` (`tests/gaby/wp1-close-session.gaby.test.ts`, section
 *    „bekannte Restlücken“) are reproduced here and must be rejected.
 */

function participants(
  rows: readonly {
    playerId: string;
    cashIn?: number;
    creditIn?: number;
    stack?: number;
    payout?: number;
  }[],
): SettlementParticipant[] {
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

function clone(result: FrozenSettlement): FrozenSettlement {
  return {
    ...result,
    lines: result.lines.map((line) => ({ ...line })),
    transfers: result.transfers.map((transfer) => ({ ...transfer })),
  };
}

const MANDATORY: readonly (readonly [string, SettlementResult])[] = [
  [
    'TV1',
    computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 25000 },
        { playerId: 'B', cashIn: 10000, stack: 15000 },
        { playerId: 'C', cashIn: 10000, stack: 10000 },
        { playerId: 'D', cashIn: 10000 },
        { playerId: 'E', cashIn: 10000 },
      ]),
    ),
  ],
  [
    'TV2',
    computeSettlement(
      participants([
        { playerId: 'Ali', cashIn: 10000, stack: 20000 },
        { playerId: 'Ben', cashIn: 10000, stack: 4000 },
        { playerId: 'Can', creditIn: 10000, stack: 6000 },
      ]),
    ),
  ],
  [
    'TV5 – Frühgeher',
    computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 15000, payout: 15000 },
        { playerId: 'B', cashIn: 10000, stack: 5000 },
        { playerId: 'C', creditIn: 10000, stack: 10000 },
      ]),
    ),
  ],
  [
    'TV6 – Listen-Spieler hat Bargeld entnommen',
    computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 10000 },
        { playerId: 'B', creditIn: 10000, stack: 10000, payout: 10000 },
      ]),
    ),
  ],
  [
    'TV8 – Rundung',
    computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 20000 },
        { playerId: 'B', cashIn: 10000, stack: 20000 },
        { playerId: 'C', cashIn: 10000, stack: 20000 },
        { playerId: 'D', cashIn: 10000 },
        { playerId: 'E', cashIn: 10000 },
        { playerId: 'F', creditIn: 10000 },
      ]),
    ),
  ],
  [
    'TV9 – Differenz negativ',
    computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 9000 },
        { playerId: 'B', cashIn: 10000, stack: 10000 },
      ]),
    ),
  ],
  [
    'TV9b – Schuld ohne Gläubiger',
    computeSettlement(
      participants([
        { playerId: 'A', creditIn: 10000 },
        { playerId: 'B', creditIn: 10000, stack: 10000 },
      ]),
    ),
  ],
  [
    'TV10 – Differenz positiv',
    computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 12000 },
        { playerId: 'B', creditIn: 10000, stack: 9000 },
      ]),
    ),
  ],
  ['TV11 – ein Spieler', computeSettlement(participants([{ playerId: 'A', cashIn: 10000, stack: 10000 }]))],
  ['TV11 – alles null', computeSettlement(participants([{ playerId: 'A' }, { playerId: 'B' }]))],
];

describe('kein Fehlalarm: jede echte Abrechnung geht durch', () => {
  for (const [label, result] of MANDATORY) {
    it(label, () => {
      expect(verifySettlement(result)).toEqual([]);
    });
  }

  /**
   * Random sessions under the preconditions of `docs/SETTLEMENT.md`
   * (`payout <= stack`, `Σ payout <= Σ cashIn`), so all three signs of the
   * difference occur.
   */
  const sessions = fc
    .integer({ min: 1, max: 8 })
    .chain((size) =>
      fc.record({
        cash: fc.array(fc.integer({ min: 0, max: 30000 }), { minLength: size, maxLength: size }),
        credit: fc.array(fc.integer({ min: 0, max: 30000 }), { minLength: size, maxLength: size }),
        stack: fc.array(fc.integer({ min: 0, max: 60000 }), { minLength: size, maxLength: size }),
        payoutSeed: fc.array(fc.integer({ min: 0, max: 4_000_000 }), {
          minLength: size,
          maxLength: size,
        }),
      }),
    )
    .map(({ cash, credit, stack, payoutSeed }) => {
      let boxLeft = cash.reduce((acc, value) => acc + value, 0);
      const payout = cash.map((_, index) => {
        const wanted = stack[index] === 0 ? 0 : payoutSeed[index] % (stack[index] + 1);
        const granted = Math.min(wanted, boxLeft);
        boxLeft -= granted;
        return granted;
      });
      return participants(
        cash.map((cashIn, index) => ({
          playerId: `p${index}`,
          cashIn,
          creditIn: credit[index],
          stack: stack[index],
          payout: payout[index],
        })),
      );
    });

  it('nimmt 1000 zufällige Sessions an', () => {
    fc.assert(
      fc.property(sessions, (input) => {
        expect(verifySettlement(computeSettlement(input))).toEqual([]);
      }),
      { numRuns: 1000 },
    );
  });
});

describe('die Lücken, die close_session offen lässt', () => {
  it('Invariante 5: Stufe 1 einseitig statt anteilig bedient', () => {
    // Gabys Reproduktion (tests/gaby/wp1-close-session.gaby.test.ts): die Kasse
    // reicht nicht für beide Bar-Zahler, weil C mehr entnommen hat, als er bar
    // eingezahlt hat. Richtig ist die anteilige Kürzung auf je 50 €.
    const input = participants([
      { playerId: 'A', cashIn: 10000, stack: 10000 },
      { playerId: 'B', cashIn: 10000, stack: 10000 },
      { playerId: 'C', creditIn: 10000, stack: 10000, payout: 10000 },
    ]);
    const honest = computeSettlement(input);
    expect(honest.lines.map((line) => line.cashFromBox)).toEqual([5000, 5000, 0]);
    expect(verifySettlement(honest)).toEqual([]);

    const tampered = clone(honest);
    const [a, b] = tampered.lines;
    a.cashTier1 = 10000;
    a.cashFromBox = 10000;
    a.residual = 0;
    b.cashTier1 = 0;
    b.cashFromBox = 0;
    b.residual = 10000;
    tampered.transfers = [{ fromPlayerId: 'C', toPlayerId: 'B', amount: 10000 }];

    // The database accepts this payload; here it must not pass.
    expect(verifySettlement(tampered)).toContain('TIER1_NOT_PROPORTIONAL');
  });

  it('Deckung je Schuldner: einer zahlt für den anderen mit', () => {
    const input = participants([
      { playerId: 'A', creditIn: 20000, stack: 10000 },
      { playerId: 'B', creditIn: 20000, stack: 10000 },
      { playerId: 'C', creditIn: 10000, stack: 20000 },
      { playerId: 'D', creditIn: 10000, stack: 20000 },
    ]);
    const honest = computeSettlement(input);
    expect(verifySettlement(honest)).toEqual([]);

    const tampered = clone(honest);
    tampered.transfers = [
      { fromPlayerId: 'A', toPlayerId: 'C', amount: 10000 },
      { fromPlayerId: 'A', toPlayerId: 'D', amount: 10000 },
    ];
    // Sums, direction and min() all still match — only A pays twice his debt.
    expect(verifySettlement(tampered)).toContain('DEBTOR_OVERPAYS');
  });

  it('eine Stufe wird falsch beschriftet, ohne dass Geld fließt', () => {
    const input = participants([
      { playerId: 'A', cashIn: 10000, stack: 10000 },
      { playerId: 'B', creditIn: 10000, stack: 10000 },
    ]);
    const tampered = clone(computeSettlement(input));
    const a = tampered.lines[0];
    a.cashTier3 = a.cashTier1 + a.cashTier2;
    a.cashTier1 = 0;
    a.cashTier2 = 0;

    // cashFromBox is unchanged, so the database sees nothing — but the
    // „Rechenweg“ of WP6 would show a cash payer served from stage 3.
    expect(verifySettlement(tampered).length).toBeGreaterThan(0);
  });
});

describe('klassische Manipulationen', () => {
  const tv2 = MANDATORY[1][1];

  it('Bargeld an den Listen-Spieler, während ein Bar-Zahler offen ist', () => {
    const tampered = clone(tv2);
    const ali = tampered.lines[0];
    const can = tampered.lines[2];
    ali.cashTier2 -= 6000;
    ali.cashFromBox -= 6000;
    ali.residual += 6000;
    can.cashTier3 += 6000;
    can.cashFromBox += 6000;
    can.residual -= 6000;
    tampered.transfers = [{ fromPlayerId: 'Can', toPlayerId: 'Ali', amount: 10000 }];

    const problems = verifySettlement(tampered);
    expect(problems).toContain('CASH_FIRST_VIOLATED');
    expect(problems).toContain('TIER2_WRONG');
  });

  it('Richtung umgedreht: der Gläubiger überweist', () => {
    const tampered = clone(tv2);
    tampered.transfers = tampered.transfers.map((transfer) => ({
      fromPlayerId: transfer.toPlayerId,
      toPlayerId: transfer.fromPlayerId,
      amount: transfer.amount,
    }));

    expect(verifySettlement(tampered)).toContain('TRANSFER_DIRECTION_WRONG');
  });

  it('Empfänger ist gar kein Spieler dieser Abrechnung', () => {
    const tampered = clone(tv2);
    tampered.transfers = [{ fromPlayerId: 'Can', toPlayerId: 'Fremder', amount: 4000 }];

    expect(verifySettlement(tampered)).toContain('TRANSFER_PLAYER_UNKNOWN');
  });

  it('Überweisung an sich selbst und Beträge <= 0', () => {
    const toSelf = clone(tv2);
    toSelf.transfers = [{ fromPlayerId: 'Can', toPlayerId: 'Can', amount: 4000 }];
    expect(verifySettlement(toSelf)).toContain('TRANSFER_TO_SELF');

    for (const amount of [0, -100]) {
      const tampered = clone(tv2);
      tampered.transfers = [{ fromPlayerId: 'Can', toPlayerId: 'Ali', amount }];
      expect(verifySettlement(tampered)).toContain('TRANSFER_AMOUNT_INVALID');
    }
  });

  it('Überweisungen weggelassen, obwohl beide Seiten offen sind', () => {
    const tampered = clone(tv2);
    tampered.transfers = [];
    tampered.uncoveredClaims = 4000;
    tampered.uncoveredDebts = 4000;

    const problems = verifySettlement(tampered);
    expect(problems).toContain('TRANSFER_TOTAL_WRONG');
    expect(problems).toContain('CLEAN_SESSION_HAS_LEFTOVERS');
  });

  it('jemand bekommt mehr aus der Kasse, als er zu bekommen hat', () => {
    const tampered = clone(tv2);
    const ben = tampered.lines[1];
    ben.cashTier1 += 1000;
    ben.cashFromBox += 1000;
    ben.residual -= 1000;

    const problems = verifySettlement(tampered);
    expect(problems).toContain('CASH_ABOVE_CLAIM');
    expect(problems).toContain('CASH_BOX_DOES_NOT_ADD_UP');
  });

  it('die Kopfzahlen passen nicht zu den Zeilen', () => {
    const tampered = clone(tv2);
    tampered.totalStack += 100;
    expect(verifySettlement(tampered)).toContain('TOTAL_STACK_WRONG');

    const box = clone(tv2);
    box.cashBoxStart += 100;
    expect(verifySettlement(box)).toContain('CASH_BOX_START_WRONG');
  });

  it('krumme oder negative Beträge', () => {
    const fraction = clone(tv2);
    fraction.lines[0].cashTier1 = 100.5;
    expect(verifySettlement(fraction)).toContain('NON_INTEGER_AMOUNT');

    const negative = clone(tv2);
    negative.unallocatedCash = -1;
    expect(verifySettlement(negative)).toContain('NEGATIVE_AMOUNT');
  });

  it('ein Spieler steht zweimal in der Abrechnung', () => {
    const tampered = clone(tv2);
    tampered.lines.push({ ...tampered.lines[0] });
    expect(verifySettlement(tampered)).toContain('DUPLICATE_PLAYER');
  });

  it('uncoveredDebts wird verschwiegen (TV9b)', () => {
    const tampered = clone(MANDATORY[6][1]);
    tampered.uncoveredDebts = 0;

    const problems = verifySettlement(tampered);
    expect(problems).toContain('UNCOVERED_DEBTS_WRONG');
    expect(problems).toContain('NEGATIVE_DISCREPANCY_UNEXPLAINED');
  });

  it('uncoveredClaims als unallocatedCash getarnt (TV10)', () => {
    const tampered = clone(MANDATORY[7][1]);
    tampered.uncoveredClaims = 0;
    tampered.unallocatedCash = 1000;

    expect(verifySettlement(tampered).length).toBeGreaterThan(0);
  });

  it('meldet jeden Verstoß nur einmal', () => {
    const tampered = clone(MANDATORY[0][1]);
    for (const line of tampered.lines) line.claim += 1;

    const problems = verifySettlement(tampered);
    expect(problems).toContain('CLAIM_WRONG');
    expect(new Set(problems).size).toBe(problems.length);
  });
});
