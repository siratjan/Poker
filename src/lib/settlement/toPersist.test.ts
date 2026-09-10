import { describe, expect, it } from 'vitest';
import { computeSettlement } from './index';
import {
  fromSettlementPayload,
  fromStoredRows,
  toSettlementPayload,
  toStoredRows,
  type SettlementPayload,
} from './toPersist';
import type { SettlementParticipant, SettlementResult } from './types';

/**
 * The mapping between a computed settlement, the RPC JSON and the stored rows
 * must be lossless in both directions (docs/ARBEITSPAKETE.md WP6, step 6).
 *
 * A closed session is displayed from the stored rows and never recomputed
 * (CLAUDE.md), so a swapped or dropped column here would document the evening
 * wrong forever — and nothing downstream would notice.
 */

const SESSION = '33333333-3333-4333-8333-333333333333';

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

/** Cases that cover all three signs of the difference plus rounding. */
const CASES: readonly (readonly [string, SettlementResult])[] = [
  [
    'TV1 – pure cash round',
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
    'TV2 – cash payer before the list winner',
    computeSettlement(
      participants([
        { playerId: 'Ali', cashIn: 10000, stack: 20000 },
        { playerId: 'Ben', cashIn: 10000, stack: 4000 },
        { playerId: 'Can', creditIn: 10000, stack: 6000 },
      ]),
    ),
  ],
  [
    'TV8 – largest remainder rounding',
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
    'TV9 – chips missing, cash stays in the box',
    computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 9000 },
        { playerId: 'B', cashIn: 10000, stack: 10000 },
      ]),
    ),
  ],
  [
    'TV9b – debt without a creditor',
    computeSettlement(
      participants([
        { playerId: 'A', creditIn: 10000 },
        { playerId: 'B', creditIn: 10000, stack: 10000 },
      ]),
    ),
  ],
  [
    'TV10 – claim without cover',
    computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 12000 },
        { playerId: 'B', creditIn: 10000, stack: 9000 },
      ]),
    ),
  ],
  [
    'TV5 – early leaver took his cash',
    computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 15000, payout: 15000 },
        { playerId: 'B', cashIn: 10000, stack: 5000 },
        { playerId: 'C', creditIn: 10000, stack: 10000 },
      ]),
    ),
  ],
];

describe('Result <-> RPC JSON', () => {
  for (const [label, result] of CASES) {
    it(`${label}: round trip changes nothing`, () => {
      expect(fromSettlementPayload(toSettlementPayload(result))).toEqual(result);
    });
  }

  it('survives a JSON round trip (that is how it reaches Postgres)', () => {
    const [, result] = CASES[2];
    const payload = toSettlementPayload(result);
    const parsed: SettlementPayload = JSON.parse(JSON.stringify(payload));

    expect(parsed).toEqual(payload);
    expect(fromSettlementPayload(parsed)).toEqual(result);
  });

  it('carries exactly the keys close_session reads', () => {
    const [, result] = CASES[1];
    const payload = toSettlementPayload(result);

    expect(Object.keys(payload).sort()).toEqual(
      [
        'algorithmVersion',
        'cashBoxAfterPayouts',
        'cashBoxStart',
        'discrepancy',
        'isManual',
        'lines',
        'totalBuyIn',
        'totalStack',
        'transfers',
        'unallocatedCash',
        'uncoveredClaims',
        'uncoveredDebts',
      ].sort(),
    );
    expect(Object.keys(payload.lines[0]).sort()).toEqual(
      [
        'cashFromBox',
        'cashIn',
        'cashTier1',
        'cashTier2',
        'cashTier3',
        'claim',
        'creditIn',
        'isCashPlayer',
        'netResult',
        'payout',
        'playerId',
        'residual',
        'stack',
      ].sort(),
    );
    expect(Object.keys(payload.transfers[0]).sort()).toEqual(
      ['amount', 'fromPlayerId', 'toPlayerId'].sort(),
    );
  });

  it('does not alias the arrays of the source result', () => {
    const [, result] = CASES[1];
    const payload = toSettlementPayload(result);
    payload.lines[0].cashFromBox = 1;
    payload.transfers[0].amount = 1;

    expect(result.lines[0].cashFromBox).not.toBe(1);
    expect(result.transfers[0].amount).not.toBe(1);
  });
});

describe('Result <-> stored rows', () => {
  const positions = new Map<string, number>();

  for (const [label, result] of CASES) {
    it(`${label}: round trip changes nothing`, () => {
      const rows = toStoredRows(result, SESSION, positions);
      expect(fromStoredRows(rows)).toEqual(result);
    });
  }

  it('keeps the join order of the lines, whatever order the rows arrive in', () => {
    const [, result] = CASES[0];
    const rows = toStoredRows(result, SESSION, positions);

    const shuffled = {
      ...rows,
      lines: [...rows.lines].reverse(),
      transfers: [...rows.transfers].reverse(),
    };
    expect(fromStoredRows(shuffled)).toEqual(result);
  });

  it('uses the given join order, not the array index', () => {
    const result = computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 20000 },
        { playerId: 'B', cashIn: 10000, stack: 0 },
      ]),
    );
    const rows = toStoredRows(result, SESSION, new Map([['A', 7], ['B', 4]]));

    expect(rows.lines.map((line) => [line.player_id, line.position])).toEqual([
      ['A', 7],
      ['B', 4],
    ]);
    // Sorting by that position is what fromStoredRows does — B first now.
    expect(fromStoredRows(rows).lines.map((line) => line.playerId)).toEqual(['B', 'A']);
  });

  it('maps every money column of a line, none crossed', () => {
    const result = computeSettlement(
      participants([
        { playerId: 'A', cashIn: 1000, creditIn: 2000, stack: 4000, payout: 500 },
        { playerId: 'B', cashIn: 3000, stack: 500 },
      ]),
    );
    const [row] = toStoredRows(result, SESSION, positions).lines;
    const [line] = result.lines;

    expect(row).toEqual({
      session_id: SESSION,
      player_id: line.playerId,
      position: 0,
      cash_in_cents: line.cashIn,
      credit_in_cents: line.creditIn,
      stack_cents: line.stack,
      payout_cents: line.payout,
      is_cash_player: line.isCashPlayer,
      claim_cents: line.claim,
      cash_tier1_cents: line.cashTier1,
      cash_tier2_cents: line.cashTier2,
      cash_tier3_cents: line.cashTier3,
      cash_from_box_cents: line.cashFromBox,
      net_result_cents: line.netResult,
      residual_cents: line.residual,
    });
    // The four values that would look plausible if swapped are all different.
    expect(new Set([line.cashIn, line.creditIn, line.stack, line.payout]).size).toBe(4);
  });

  it('keeps a stored algorithm version this build would not produce', () => {
    const [, result] = CASES[0];
    const rows = toStoredRows(result, SESSION, positions);
    rows.settlement.algorithm_version = 99;

    expect(fromStoredRows(rows).algorithmVersion).toBe(99);
  });

  it('carries the automatic isManual = false through both round trips (WP11)', () => {
    const [, result] = CASES[1];
    expect(result.isManual).toBe(false);

    expect(fromSettlementPayload(toSettlementPayload(result)).isManual).toBe(false);
    expect(fromStoredRows(toStoredRows(result, SESSION, positions)).isManual).toBe(false);
    expect(toStoredRows(result, SESSION, positions).settlement.is_manual).toBe(false);
  });

  it('carries a manual isManual = true through both round trips (WP11)', () => {
    const [, base] = CASES[1];
    // A hand-edited settlement: same shape, but flagged manual and with an
    // unreconciled cash amount and transfer — exactly what WP11 must preserve.
    const manual: SettlementResult = {
      ...base,
      isManual: true,
      lines: base.lines.map((line) => ({ ...line, cashFromBox: 12345 })),
      transfers: [{ fromPlayerId: base.lines[1].playerId, toPlayerId: base.lines[0].playerId, amount: 777 }],
    };

    const viaPayload = fromSettlementPayload(toSettlementPayload(manual));
    expect(viaPayload.isManual).toBe(true);
    expect(viaPayload.lines[0].cashFromBox).toBe(12345);
    expect(viaPayload.transfers).toEqual(manual.transfers);

    const rows = toStoredRows(manual, SESSION, positions);
    expect(rows.settlement.is_manual).toBe(true);
    expect(fromStoredRows(rows)).toEqual(manual);
  });
});
