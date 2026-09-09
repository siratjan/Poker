import { describe, expect, it } from 'vitest';
import {
  deriveParticipants,
  deriveSession,
  deriveTotals,
  previewCashEntitlement,
  previewParticipants,
  sortEntriesNewestFirst,
  type SessionEntry,
  type SessionParticipant,
} from './derive';

/**
 * Unit tests for the pure session derivation (docs/ARBEITSPAKETE.md WP5,
 * step 6): sums, `canClose`, the cash box after payouts, players without a
 * stack, stack 0 and several payouts. All amounts are integer cents.
 */

const ALI = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CEM = '33333333-3333-4333-8333-333333333333';

function participants(...ids: string[]): SessionParticipant[] {
  const names: Record<string, string> = { [ALI]: 'Ali', [BEN]: 'Ben', [CEM]: 'Cem' };
  return ids.map((playerId, index) => ({
    playerId,
    name: names[playerId] ?? playerId,
    position: index + 1,
  }));
}

let entrySeq = 0;

function buyIn(playerId: string, amountCents: number, payment: 'cash' | 'credit'): SessionEntry {
  return entry({ playerId, type: 'buy_in', amountCents, payment });
}

function cashOut(playerId: string, amountCents: number): SessionEntry {
  return entry({ playerId, type: 'cash_out', amountCents, payment: null });
}

function payout(playerId: string, amountCents: number): SessionEntry {
  return entry({ playerId, type: 'payout', amountCents, payment: null });
}

function entry(fields: Omit<SessionEntry, 'id' | 'createdAt' | 'createdByName'>): SessionEntry {
  entrySeq += 1;
  const minute = String(entrySeq).padStart(2, '0');
  return {
    id: `entry-${entrySeq}`,
    createdAt: `2026-09-09T19:${minute}:00.000Z`,
    createdByName: 'Sirat',
    ...fields,
  };
}

describe('deriveParticipants', () => {
  it('splits buy-ins into cash and credit and keeps the join order', () => {
    const rows = deriveParticipants(participants(ALI, BEN), [
      buyIn(BEN, 5000, 'credit'),
      buyIn(ALI, 10000, 'cash'),
      buyIn(ALI, 10000, 'credit'),
    ]);

    expect(rows.map((row) => row.name)).toEqual(['Ali', 'Ben']);
    expect(rows[0]).toMatchObject({ cashIn: 10000, creditIn: 10000, buyIn: 20000 });
    expect(rows[1]).toMatchObject({ cashIn: 0, creditIn: 5000, buyIn: 5000 });
  });

  it('sorts by position, not by array order', () => {
    const unsorted: SessionParticipant[] = [
      { playerId: BEN, name: 'Ben', position: 2 },
      { playerId: ALI, name: 'Ali', position: 1 },
    ];
    expect(deriveParticipants(unsorted, []).map((row) => row.name)).toEqual(['Ali', 'Ben']);
  });

  it('leaves stack and net null while a player is still playing', () => {
    const [ali] = deriveParticipants(participants(ALI), [buyIn(ALI, 10000, 'cash')]);

    expect(ali.stack).toBeNull();
    expect(ali.net).toBeNull();
    expect(ali.hasEntries).toBe(true);
  });

  it('treats a stack of 0 as a real stack, not as "still playing"', () => {
    const [ali] = deriveParticipants(participants(ALI), [
      buyIn(ALI, 10000, 'cash'),
      cashOut(ALI, 0),
    ]);

    expect(ali.stack).toBe(0);
    expect(ali.net).toBe(-10000);
  });

  it('sums several payouts of one player', () => {
    const [ali] = deriveParticipants(participants(ALI), [
      buyIn(ALI, 20000, 'cash'),
      cashOut(ALI, 20000),
      payout(ALI, 5000),
      payout(ALI, 7500),
    ]);

    expect(ali.payout).toBe(12500);
    expect(ali.net).toBe(0);
  });

  it('remembers the payment method of the last buy-in', () => {
    const [ali] = deriveParticipants(participants(ALI), [
      buyIn(ALI, 10000, 'cash'),
      buyIn(ALI, 10000, 'credit'),
    ]);

    expect(ali.lastPayment).toBe('credit');
  });

  it('reports a participant without any entry as removable', () => {
    const [ali] = deriveParticipants(participants(ALI), []);

    expect(ali).toMatchObject({ cashIn: 0, creditIn: 0, buyIn: 0, payout: 0, hasEntries: false });
  });

  it('ignores entries of players that are not participants', () => {
    const rows = deriveParticipants(participants(ALI), [buyIn(BEN, 10000, 'cash')]);

    expect(rows).toHaveLength(1);
    expect(rows[0].buyIn).toBe(0);
  });
});

describe('deriveTotals', () => {
  it('sums buy-ins, stacks and the cash box after payouts', () => {
    const rows = deriveParticipants(participants(ALI, BEN), [
      buyIn(ALI, 20000, 'cash'),
      buyIn(BEN, 10000, 'credit'),
      cashOut(ALI, 25000),
      payout(ALI, 15000),
      cashOut(BEN, 5000),
    ]);
    const totals = deriveTotals(rows);

    expect(totals).toMatchObject({
      totalCash: 20000,
      totalCredit: 10000,
      totalBuyIn: 30000,
      totalStack: 30000,
      totalPayout: 15000,
      cashBox: 5000,
      participantCount: 2,
      stackCount: 2,
      openParticipants: 0,
      canClose: true,
      discrepancy: 0,
    });
  });

  it('reports a discrepancy when fewer chips were counted than bought in', () => {
    const { totals } = deriveSession(participants(ALI, BEN), [
      buyIn(ALI, 10000, 'cash'),
      buyIn(BEN, 10000, 'cash'),
      cashOut(ALI, 10000),
      cashOut(BEN, 8000),
    ]);

    expect(totals.discrepancy).toBe(-2000);
    expect(totals.canClose).toBe(true);
  });

  it('blocks closing while one participant has no stack', () => {
    const { totals } = deriveSession(participants(ALI, BEN), [
      buyIn(ALI, 10000, 'cash'),
      cashOut(ALI, 10000),
    ]);

    expect(totals.stackCount).toBe(1);
    expect(totals.openParticipants).toBe(1);
    expect(totals.canClose).toBe(false);
  });

  it('blocks closing a session without participants', () => {
    expect(deriveTotals([]).canClose).toBe(false);
  });

  it('counts a stack of 0 towards canClose', () => {
    const { totals } = deriveSession(participants(ALI), [
      buyIn(ALI, 10000, 'cash'),
      cashOut(ALI, 0),
    ]);

    expect(totals.canClose).toBe(true);
    expect(totals.totalStack).toBe(0);
    expect(totals.discrepancy).toBe(-10000);
  });

  it('keeps the cash box at 0 when everything was bought on the list', () => {
    const { totals } = deriveSession(participants(ALI), [buyIn(ALI, 10000, 'credit')]);

    expect(totals.cashBox).toBe(0);
    expect(totals.totalCash).toBe(0);
  });

  it('reduces the cash box by every payout of the session', () => {
    const { totals } = deriveSession(participants(ALI, BEN), [
      buyIn(ALI, 20000, 'cash'),
      buyIn(BEN, 20000, 'cash'),
      cashOut(ALI, 30000),
      payout(ALI, 10000),
      payout(ALI, 5000),
    ]);

    expect(totals.cashBox).toBe(40000 - 15000);
  });
});

describe('previewParticipants', () => {
  it('assumes the buy-in as the stack of a player who is still playing', () => {
    const rows = deriveParticipants(participants(ALI, BEN), [
      buyIn(ALI, 10000, 'cash'),
      buyIn(BEN, 10000, 'cash'),
      cashOut(ALI, 15000),
    ]);
    const preview = previewParticipants(rows);

    expect(preview[0].stack).toBe(15000);
    expect(preview[1].stack).toBe(10000);
  });

  it('never assumes a stack below what a player already took in cash', () => {
    // Not reachable through the triggers, but the algorithm must not be fed a
    // violated precondition even if the data arrives mid-write.
    const rows = deriveParticipants(participants(ALI), [
      buyIn(ALI, 10000, 'cash'),
      payout(ALI, 8000),
    ]);
    // strip the stack to simulate a deleted cash_out arriving before the payout
    const withoutStack = rows.map((row) => ({ ...row, stack: null, net: null }));

    expect(previewParticipants(withoutStack)[0].stack).toBe(10000);
  });
});

describe('previewCashEntitlement', () => {
  it('gives a cash payer his stake back before a credit player gets anything', () => {
    const rows = deriveParticipants(participants(ALI, BEN), [
      buyIn(ALI, 10000, 'cash'),
      buyIn(BEN, 10000, 'credit'),
      cashOut(ALI, 5000),
      cashOut(BEN, 15000),
    ]);

    // Box = 10.000 cash. Stage 1: Ali gets min(cashIn, stack) = 5.000.
    // Stage 2: no open claim of a cash player left. Stage 3: Ben gets 5.000.
    expect(previewCashEntitlement(rows, ALI)).toEqual({
      cashFromBoxCents: 5000,
      provisional: false,
    });
    expect(previewCashEntitlement(rows, BEN)).toEqual({
      cashFromBoxCents: 5000,
      provisional: false,
    });
  });

  it('marks the preview as provisional while somebody is still playing', () => {
    const rows = deriveParticipants(participants(ALI, BEN), [
      buyIn(ALI, 10000, 'cash'),
      buyIn(BEN, 10000, 'cash'),
      cashOut(ALI, 12000),
    ]);
    const preview = previewCashEntitlement(rows, ALI);

    expect(preview).not.toBeNull();
    // Box = 20.000. Stage 1 gives both cash payers their stake back (10.000
    // each, Ben with the assumed stack), so nothing is left for Ali's win.
    expect(preview?.provisional).toBe(true);
    expect(preview?.cashFromBoxCents).toBe(10000);
  });

  it('counts cash already taken as received', () => {
    const rows = deriveParticipants(participants(ALI, BEN), [
      buyIn(ALI, 10000, 'cash'),
      buyIn(BEN, 10000, 'cash'),
      cashOut(ALI, 10000),
      payout(ALI, 4000),
      cashOut(BEN, 10000),
    ]);

    expect(previewCashEntitlement(rows, ALI)?.cashFromBoxCents).toBe(6000);
    expect(previewCashEntitlement(rows, BEN)?.cashFromBoxCents).toBe(10000);
  });

  it('returns null for an unknown player', () => {
    const rows = deriveParticipants(participants(ALI), [buyIn(ALI, 10000, 'cash')]);

    expect(previewCashEntitlement(rows, CEM)).toBeNull();
  });

  it('returns null instead of throwing when the input has no participants', () => {
    expect(previewCashEntitlement([], ALI)).toBeNull();
  });
});

describe('sortEntriesNewestFirst', () => {
  it('puts the newest entry first and breaks ties stably', () => {
    const first = buyIn(ALI, 10000, 'cash');
    const second = buyIn(BEN, 10000, 'cash');
    const sameTime: SessionEntry = { ...second, id: 'a-entry', createdAt: first.createdAt };

    const sorted = sortEntriesNewestFirst([first, second, sameTime]);

    expect(sorted[0].id).toBe(second.id);
    // equal timestamps: the larger id comes first (reverse of the stable asc order)
    expect(sorted.slice(1).map((row) => row.id)).toEqual([first.id, 'a-entry']);
  });

  it('does not modify the input array', () => {
    const input = [buyIn(ALI, 10000, 'cash'), buyIn(BEN, 10000, 'cash')];
    const copy = [...input];

    sortEntriesNewestFirst(input);

    expect(input).toEqual(copy);
  });
});
