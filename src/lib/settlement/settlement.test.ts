import { describe, expect, it } from 'vitest';
import { SettlementError } from './errors';
import { describeTransfer } from './format';
import { computeSettlement } from './index';
import type { SettlementParticipant, SettlementResult, Transfer } from './types';

/**
 * The mandatory test vectors TV1-TV12 of `docs/SETTLEMENT.md`. All amounts are
 * integer cents, taken from the euro amounts of the document (100 EUR = 10000).
 * The expected values are written down by hand from the document, never copied
 * from the implementation.
 */

type Row = {
  playerId: string;
  cashIn?: number;
  creditIn?: number;
  stack?: number;
  payout?: number;
};

type ExpectedLine = {
  playerId: string;
  cashTier1: number;
  cashTier2: number;
  cashTier3: number;
  cashFromBox: number;
  residual: number;
};

type Vector = {
  name: string;
  rows: Row[];
  discrepancy: number;
  unallocatedCash: number;
  uncoveredClaims: number;
  uncoveredDebts: number;
  lines: ExpectedLine[];
  transfers: Transfer[];
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

function transfer(fromPlayerId: string, toPlayerId: string, amount: number): Transfer {
  return { fromPlayerId, toPlayerId, amount };
}

const vectors: Vector[] = [
  {
    name: 'TV1 - pure cash round',
    rows: [
      { playerId: 'A', cashIn: 10000, stack: 25000 },
      { playerId: 'B', cashIn: 10000, stack: 15000 },
      { playerId: 'C', cashIn: 10000, stack: 10000 },
      { playerId: 'D', cashIn: 10000, stack: 0 },
      { playerId: 'E', cashIn: 10000, stack: 0 },
    ],
    discrepancy: 0,
    unallocatedCash: 0,
    uncoveredClaims: 0,
    uncoveredDebts: 0,
    lines: [
      { playerId: 'A', cashTier1: 10000, cashTier2: 15000, cashTier3: 0, cashFromBox: 25000, residual: 0 },
      { playerId: 'B', cashTier1: 10000, cashTier2: 5000, cashTier3: 0, cashFromBox: 15000, residual: 0 },
      { playerId: 'C', cashTier1: 10000, cashTier2: 0, cashTier3: 0, cashFromBox: 10000, residual: 0 },
      { playerId: 'D', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: 0 },
      { playerId: 'E', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: 0 },
    ],
    transfers: [],
  },
  {
    name: 'TV2 - cash payers before a credit winner',
    rows: [
      { playerId: 'Ali', cashIn: 10000, stack: 20000 },
      { playerId: 'Ben', cashIn: 10000, stack: 4000 },
      { playerId: 'Can', creditIn: 10000, stack: 6000 },
    ],
    discrepancy: 0,
    unallocatedCash: 0,
    uncoveredClaims: 0,
    uncoveredDebts: 0,
    lines: [
      { playerId: 'Ali', cashTier1: 10000, cashTier2: 6000, cashTier3: 0, cashFromBox: 16000, residual: 4000 },
      { playerId: 'Ben', cashTier1: 4000, cashTier2: 0, cashTier3: 0, cashFromBox: 4000, residual: 0 },
      { playerId: 'Can', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: -4000 },
    ],
    transfers: [transfer('Can', 'Ali', 4000)],
  },
  {
    name: 'TV3 - mixed with two credit players',
    rows: [
      { playerId: 'Ali', cashIn: 10000, stack: 25000 },
      { playerId: 'Ben', cashIn: 10000, stack: 5000 },
      { playerId: 'Can', creditIn: 10000, stack: 0 },
      { playerId: 'Dai', creditIn: 20000, stack: 20000 },
    ],
    discrepancy: 0,
    unallocatedCash: 0,
    uncoveredClaims: 0,
    uncoveredDebts: 0,
    lines: [
      { playerId: 'Ali', cashTier1: 10000, cashTier2: 5000, cashTier3: 0, cashFromBox: 15000, residual: 10000 },
      { playerId: 'Ben', cashTier1: 5000, cashTier2: 0, cashTier3: 0, cashFromBox: 5000, residual: 0 },
      { playerId: 'Can', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: -10000 },
      { playerId: 'Dai', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: 0 },
    ],
    transfers: [transfer('Can', 'Ali', 10000)],
  },
  {
    name: 'TV4 - winner takes the whole cash box',
    rows: [
      { playerId: 'A', cashIn: 10000, stack: 30000 },
      { playerId: 'B', cashIn: 10000, stack: 0 },
      { playerId: 'C', creditIn: 10000, stack: 5000 },
      { playerId: 'D', creditIn: 10000, stack: 5000 },
    ],
    discrepancy: 0,
    unallocatedCash: 0,
    uncoveredClaims: 0,
    uncoveredDebts: 0,
    lines: [
      { playerId: 'A', cashTier1: 10000, cashTier2: 10000, cashTier3: 0, cashFromBox: 20000, residual: 10000 },
      { playerId: 'B', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: 0 },
      { playerId: 'C', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: -5000 },
      { playerId: 'D', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: -5000 },
    ],
    transfers: [transfer('C', 'A', 5000), transfer('D', 'A', 5000)],
  },
  {
    name: 'TV5 - early leaver takes his claim in cash',
    rows: [
      { playerId: 'A', cashIn: 10000, stack: 15000, payout: 15000 },
      { playerId: 'B', cashIn: 10000, stack: 5000 },
      { playerId: 'C', creditIn: 10000, stack: 10000 },
    ],
    discrepancy: 0,
    unallocatedCash: 0,
    uncoveredClaims: 0,
    uncoveredDebts: 0,
    lines: [
      { playerId: 'A', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: 0 },
      { playerId: 'B', cashTier1: 5000, cashTier2: 0, cashTier3: 0, cashFromBox: 5000, residual: 0 },
      { playerId: 'C', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: 0 },
    ],
    transfers: [],
  },
  {
    name: 'TV6 - credit player took cash, stage 1 runs dry',
    rows: [
      { playerId: 'A', cashIn: 10000, stack: 10000 },
      { playerId: 'B', creditIn: 10000, stack: 10000, payout: 10000 },
    ],
    discrepancy: 0,
    unallocatedCash: 0,
    uncoveredClaims: 0,
    uncoveredDebts: 0,
    lines: [
      { playerId: 'A', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: 10000 },
      { playerId: 'B', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: -10000 },
    ],
    transfers: [transfer('B', 'A', 10000)],
  },
  {
    name: 'TV7 - one player buys cash and on credit',
    rows: [
      { playerId: 'A', cashIn: 10000, creditIn: 10000, stack: 40000 },
      { playerId: 'B', cashIn: 10000, stack: 0 },
      { playerId: 'C', creditIn: 10000, stack: 0 },
    ],
    discrepancy: 0,
    unallocatedCash: 0,
    uncoveredClaims: 0,
    uncoveredDebts: 0,
    lines: [
      { playerId: 'A', cashTier1: 10000, cashTier2: 10000, cashTier3: 0, cashFromBox: 20000, residual: 10000 },
      { playerId: 'B', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: 0 },
      { playerId: 'C', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: -10000 },
    ],
    transfers: [transfer('C', 'A', 10000)],
  },
  {
    name: 'TV8 - cent rounding with largest remainder',
    rows: [
      { playerId: 'A', cashIn: 10000, stack: 20000 },
      { playerId: 'B', cashIn: 10000, stack: 20000 },
      { playerId: 'C', cashIn: 10000, stack: 20000 },
      { playerId: 'D', cashIn: 10000, stack: 0 },
      { playerId: 'E', cashIn: 10000, stack: 0 },
      { playerId: 'F', creditIn: 10000, stack: 0 },
    ],
    discrepancy: 0,
    unallocatedCash: 0,
    uncoveredClaims: 0,
    uncoveredDebts: 0,
    lines: [
      { playerId: 'A', cashTier1: 10000, cashTier2: 6667, cashTier3: 0, cashFromBox: 16667, residual: 3333 },
      { playerId: 'B', cashTier1: 10000, cashTier2: 6667, cashTier3: 0, cashFromBox: 16667, residual: 3333 },
      { playerId: 'C', cashTier1: 10000, cashTier2: 6666, cashTier3: 0, cashFromBox: 16666, residual: 3334 },
      { playerId: 'D', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: 0 },
      { playerId: 'E', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: 0 },
      { playerId: 'F', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: -10000 },
    ],
    transfers: [
      transfer('F', 'C', 3334),
      transfer('F', 'A', 3333),
      transfer('F', 'B', 3333),
    ],
  },
  {
    name: 'TV9 - chips missing (stacks below buy-ins)',
    rows: [
      { playerId: 'A', cashIn: 10000, stack: 9000 },
      { playerId: 'B', cashIn: 10000, stack: 10000 },
    ],
    discrepancy: -1000,
    unallocatedCash: 1000,
    uncoveredClaims: 0,
    uncoveredDebts: 0,
    lines: [
      { playerId: 'A', cashTier1: 9000, cashTier2: 0, cashTier3: 0, cashFromBox: 9000, residual: 0 },
      { playerId: 'B', cashTier1: 10000, cashTier2: 0, cashTier3: 0, cashFromBox: 10000, residual: 0 },
    ],
    transfers: [],
  },
  {
    // TV9b: both players are on the credit list, so the box is empty and stage
    // 3 has nothing to hand out. A owes 100,00 EUR, but nobody has a claim -
    // the chips are simply missing. unallocatedCash 0 + uncoveredDebts 10000
    // == -discrepancy (docs/SETTLEMENT.md, step 5).
    name: 'TV9b - chips missing, credit players only',
    rows: [
      { playerId: 'A', creditIn: 10000, stack: 0 },
      { playerId: 'B', creditIn: 10000, stack: 10000 },
    ],
    discrepancy: -10000,
    unallocatedCash: 0,
    uncoveredClaims: 0,
    uncoveredDebts: 10000,
    lines: [
      { playerId: 'A', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: -10000 },
      { playerId: 'B', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: 0 },
    ],
    transfers: [],
  },
  {
    name: 'TV10 - too many chips counted (stacks above buy-ins)',
    rows: [
      { playerId: 'A', cashIn: 10000, stack: 12000 },
      { playerId: 'B', creditIn: 10000, stack: 9000 },
    ],
    discrepancy: 1000,
    unallocatedCash: 0,
    uncoveredClaims: 1000,
    uncoveredDebts: 0,
    lines: [
      { playerId: 'A', cashTier1: 10000, cashTier2: 0, cashTier3: 0, cashFromBox: 10000, residual: 2000 },
      { playerId: 'B', cashTier1: 0, cashTier2: 0, cashTier3: 0, cashFromBox: 0, residual: -1000 },
    ],
    transfers: [transfer('B', 'A', 1000)],
  },
];

describe('computeSettlement - mandatory test vectors (docs/SETTLEMENT.md)', () => {
  it.each(vectors)('$name', (vector) => {
    const result = computeSettlement(participants(vector.rows));

    expect(result.algorithmVersion).toBe(1);
    expect(result.discrepancy).toBe(vector.discrepancy);
    expect(result.unallocatedCash).toBe(vector.unallocatedCash);
    expect(result.uncoveredClaims).toBe(vector.uncoveredClaims);
    expect(result.uncoveredDebts).toBe(vector.uncoveredDebts);
    expect(result.transfers).toEqual(vector.transfers);

    expect(
      result.lines.map((line) => ({
        playerId: line.playerId,
        cashTier1: line.cashTier1,
        cashTier2: line.cashTier2,
        cashTier3: line.cashTier3,
        cashFromBox: line.cashFromBox,
        residual: line.residual,
      })),
    ).toEqual(vector.lines);
  });

  it('TV1 reports the aggregates of the session', () => {
    const result = computeSettlement(participants(vectors[0].rows));

    expect(result.totalBuyIn).toBe(50000);
    expect(result.totalStack).toBe(50000);
    expect(result.cashBoxStart).toBe(50000);
    expect(result.cashBoxAfterPayouts).toBe(50000);
  });

  it('TV5 reports the cash box after the early payout', () => {
    const result = computeSettlement(participants(vectors[4].rows));

    expect(result.cashBoxStart).toBe(20000);
    expect(result.cashBoxAfterPayouts).toBe(5000);
  });

  it('TV8 transfers add up to the credit players debt', () => {
    const result = computeSettlement(participants(vectors[7].rows));
    const transferred = result.transfers.reduce((sum, entry) => sum + entry.amount, 0);

    expect(transferred).toBe(10000);
  });

  it('reports isCashPlayer, claim and netResult per line (TV7)', () => {
    const result = computeSettlement(participants(vectors[6].rows));

    expect(result.lines.map((line) => line.isCashPlayer)).toEqual([true, true, false]);
    expect(result.lines.map((line) => line.claim)).toEqual([40000, 0, 0]);
    expect(result.lines.map((line) => line.netResult)).toEqual([20000, -10000, -10000]);
  });
});

describe('TV11 - edge cases', () => {
  it('rejects an empty participant list with NO_PARTICIPANTS', () => {
    expect(() => computeSettlement([])).toThrowError(
      expect.objectContaining({ code: 'NO_PARTICIPANTS' }),
    );
  });

  it('pays a single cash player his whole stack without transfers', () => {
    const result = computeSettlement(participants([{ playerId: 'A', cashIn: 10000, stack: 10000 }]));

    expect(result.lines[0].cashFromBox).toBe(10000);
    expect(result.lines[0].residual).toBe(0);
    expect(result.transfers).toEqual([]);
    expect(result.discrepancy).toBe(0);
  });

  it('returns zeros for an all-zero session without throwing', () => {
    const result = computeSettlement(participants([{ playerId: 'A' }, { playerId: 'B' }]));

    expect(result.totalBuyIn).toBe(0);
    expect(result.totalStack).toBe(0);
    expect(result.discrepancy).toBe(0);
    expect(result.cashBoxStart).toBe(0);
    expect(result.cashBoxAfterPayouts).toBe(0);
    expect(result.unallocatedCash).toBe(0);
    expect(result.uncoveredClaims).toBe(0);
    expect(result.transfers).toEqual([]);
    expect(result.lines.every((line) => line.cashFromBox === 0 && line.residual === 0)).toBe(true);
    expect(result.lines.map((line) => line.isCashPlayer)).toEqual([false, false]);
  });
});

describe('TV12 - violated preconditions', () => {
  it('rejects payout > stack with PAYOUT_EXCEEDS_STACK', () => {
    expect(() =>
      computeSettlement(
        participants([
          { playerId: 'A', cashIn: 10000, stack: 5000, payout: 6000 },
          { playerId: 'B', cashIn: 10000, stack: 15000 },
        ]),
      ),
    ).toThrowError(expect.objectContaining({ code: 'PAYOUT_EXCEEDS_STACK', playerId: 'A' }));
  });

  it('rejects a total payout above the cash box with PAYOUT_EXCEEDS_CASHBOX', () => {
    expect(() =>
      computeSettlement(
        participants([
          { playerId: 'A', cashIn: 5000, stack: 8000, payout: 8000 },
          { playerId: 'B', creditIn: 10000, stack: 7000 },
        ]),
      ),
    ).toThrowError(expect.objectContaining({ code: 'PAYOUT_EXCEEDS_CASHBOX' }));
  });

  it.each([
    ['cashIn', { playerId: 'A', cashIn: -100 }],
    ['creditIn', { playerId: 'A', creditIn: -100 }],
    ['stack', { playerId: 'A', stack: -100 }],
    ['payout', { playerId: 'A', payout: -100 }],
  ])('rejects a negative %s with NEGATIVE_AMOUNT', (_field, row) => {
    expect(() => computeSettlement(participants([row]))).toThrowError(
      expect.objectContaining({ code: 'NEGATIVE_AMOUNT', playerId: 'A' }),
    );
  });

  it.each([
    ['cashIn', { playerId: 'A', cashIn: 100.5 }],
    ['creditIn', { playerId: 'A', creditIn: 100.5 }],
    ['stack', { playerId: 'A', stack: 100.5 }],
    ['payout', { playerId: 'A', stack: 200, payout: 100.5 }],
  ])('rejects a non-integer %s with NON_INTEGER_AMOUNT', (_field, row) => {
    expect(() => computeSettlement(participants([row]))).toThrowError(
      expect.objectContaining({ code: 'NON_INTEGER_AMOUNT', playerId: 'A' }),
    );
  });

  it('rejects a duplicated playerId with DUPLICATE_PLAYER', () => {
    expect(() =>
      computeSettlement(
        participants([
          { playerId: 'A', cashIn: 10000, stack: 10000 },
          { playerId: 'A', cashIn: 10000, stack: 10000 },
        ]),
      ),
    ).toThrowError(expect.objectContaining({ code: 'DUPLICATE_PLAYER', playerId: 'A' }));
  });

  it('rejects a missing position with INVALID_POSITION', () => {
    const withoutPosition = [
      { playerId: 'A', cashIn: 10000, creditIn: 0, stack: 10000, payout: 0 },
    ] as unknown as SettlementParticipant[];

    expect(() => computeSettlement(withoutPosition)).toThrowError(
      expect.objectContaining({ code: 'INVALID_POSITION', playerId: 'A' }),
    );
  });

  it('rejects a non-integer position with INVALID_POSITION', () => {
    expect(() =>
      computeSettlement([
        { playerId: 'A', position: 0.5, cashIn: 10000, creditIn: 0, stack: 10000, payout: 0 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_POSITION', playerId: 'A' }));
  });

  it('rejects a duplicated position with INVALID_POSITION', () => {
    expect(() =>
      computeSettlement([
        { playerId: 'A', position: 1, cashIn: 10000, creditIn: 0, stack: 10000, payout: 0 },
        { playerId: 'B', position: 1, cashIn: 10000, creditIn: 0, stack: 10000, payout: 0 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_POSITION', playerId: 'B' }));
  });

  it('throws SettlementError instances that carry name and code', () => {
    let caught: unknown;
    try {
      computeSettlement([]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SettlementError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as SettlementError).name).toBe('SettlementError');
    expect((caught as SettlementError).playerId).toBeUndefined();
  });
});

describe('invariant 5 - stage 1 depends on who drained the box', () => {
  // Invariant 5 of docs/SETTLEMENT.md holds exactly while `payout_j <= cashIn_j`
  // for every j. Here C breaks that condition - a *cash* player who took more
  // cash out of the box than he paid in - so stage 1 is rationed and A gets
  // nothing although stack >= cashIn and payout == 0. The document covers this
  // explicitly ("no matter whether cash or credit player"); the shortfall comes
  // back as a debt from the credit debtor D.
  const rows: Row[] = [
    { playerId: 'A', cashIn: 10000, stack: 10000 },
    { playerId: 'C', cashIn: 5000, stack: 15000, payout: 15000 },
    { playerId: 'D', creditIn: 10000, stack: 0 },
  ];

  it('leaves stage 1 unserved when a cash player overdrew the box', () => {
    const result = computeSettlement(participants(rows));

    expect(result.cashBoxAfterPayouts).toBe(0);
    expect(result.lines[0].cashFromBox).toBe(0);
    expect(result.lines[0].residual).toBe(10000);
    expect(result.transfers).toEqual([transfer('D', 'A', 10000)]);
  });

  it('serves stage 1 fully when every payout is covered by the own cash-in', () => {
    const result = computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 10000 },
        { playerId: 'B', cashIn: 10000, stack: 10000, payout: 10000 },
      ]),
    );

    expect(result.lines[0].cashTier1).toBe(10000);
  });
});

describe('sorting and determinism', () => {
  const rows: Row[] = [
    { playerId: 'p1', cashIn: 10000, stack: 20000 },
    { playerId: 'p2', cashIn: 10000, stack: 4000 },
    { playerId: 'p3', creditIn: 10000, stack: 6000 },
  ];

  function withoutOrder(result: SettlementResult): unknown {
    return { lines: result.lines, transfers: result.transfers };
  }

  it('sorts by position, so a permuted input yields the identical result', () => {
    const inOrder = computeSettlement(participants(rows));
    const shuffled = computeSettlement([
      { playerId: 'p3', name: 'p3', position: 2, cashIn: 0, creditIn: 10000, stack: 6000, payout: 0 },
      { playerId: 'p1', name: 'p1', position: 0, cashIn: 10000, creditIn: 0, stack: 20000, payout: 0 },
      { playerId: 'p2', name: 'p2', position: 1, cashIn: 10000, creditIn: 0, stack: 4000, payout: 0 },
    ]);

    expect(withoutOrder(shuffled)).toEqual(withoutOrder(inOrder));
  });

  it('sorts by position, not by the array index', () => {
    const result = computeSettlement([
      { playerId: 'z', name: 'Zoe', position: 7, cashIn: 10000, creditIn: 0, stack: 10000, payout: 0 },
      { playerId: 'a', name: 'Ali', position: 3, cashIn: 10000, creditIn: 0, stack: 10000, payout: 0 },
    ]);

    expect(result.lines.map((line) => line.playerId)).toEqual(['a', 'z']);
  });

  it('does not mutate the given input array', () => {
    const input = participants(rows).reverse();
    const before = [...input];

    computeSettlement(input);

    expect(input).toEqual(before);
  });

  it('returns the identical result when run twice', () => {
    const first = computeSettlement(participants(vectors[7].rows));
    const second = computeSettlement(participants(vectors[7].rows));

    expect(first).toEqual(second);
  });
});

describe('describeTransfer', () => {
  it('renders the German debt sentence', () => {
    expect(
      describeTransfer(transfer('can', 'ali', 4000), { can: 'Can', ali: 'Ali' }),
    ).toBe('Can schuldet Ali 40,00 €');
  });

  it('falls back to "Unbekannt" for unknown players', () => {
    expect(describeTransfer(transfer('x', 'y', 123456), {})).toBe(
      'Unbekannt schuldet Unbekannt 1.234,56 €',
    );
  });
});
