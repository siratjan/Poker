import { describe, expect, it } from 'vitest';
import { deriveParticipants, type SessionEntry } from './derive';
import { buyInLabel, buyInToast, describeEntry, formatSignedCents, stackLabel } from './labels';

/** German wording of the session detail screen (docs/ARBEITSPAKETE.md WP5). */

const ALI = '11111111-1111-4111-8111-111111111111';

function participantWith(entries: SessionEntry[]) {
  return deriveParticipants([{ playerId: ALI, name: 'Ali', position: 1 }], entries)[0];
}

function entry(fields: Partial<SessionEntry>): SessionEntry {
  return {
    id: 'e1',
    playerId: ALI,
    type: 'buy_in',
    amountCents: 10000,
    payment: 'cash',
    createdAt: '2026-09-09T19:14:00.000Z',
    createdByName: 'Sirat',
    ...fields,
  };
}

describe('formatSignedCents', () => {
  it('marks a win with a plus and keeps the minus of a loss', () => {
    expect(formatSignedCents(5000)).toBe('+50,00 €');
    expect(formatSignedCents(-5000)).toBe('-50,00 €');
    expect(formatSignedCents(0)).toBe('0,00 €');
  });
});

describe('buyInLabel', () => {
  it('shows cash and list side by side', () => {
    const participant = participantWith([
      entry({ id: 'a', amountCents: 10000, payment: 'cash' }),
      entry({ id: 'b', amountCents: 5000, payment: 'credit' }),
    ]);

    expect(buyInLabel(participant)).toBe('100,00 € bar + 50,00 € Liste');
  });

  it('omits the part that is zero', () => {
    expect(buyInLabel(participantWith([entry({ payment: 'cash' })]))).toBe('100,00 € bar');
    expect(buyInLabel(participantWith([entry({ payment: 'credit' })]))).toBe('100,00 € Liste');
  });

  it('says so when nothing was bought in yet', () => {
    expect(buyInLabel(participantWith([]))).toBe('noch kein Buy-in');
  });
});

describe('stackLabel', () => {
  it('says „spielt noch“ without a cash-out and shows a stack of 0 as an amount', () => {
    expect(stackLabel(participantWith([]))).toBe('spielt noch');
    expect(
      stackLabel(participantWith([entry({ type: 'cash_out', amountCents: 0, payment: null })])),
    ).toBe('Stack 0,00 €');
  });
});

describe('describeEntry', () => {
  it('names type, amount and payment method', () => {
    expect(describeEntry({ type: 'buy_in', amountCents: 10000, payment: 'cash' })).toBe(
      'Buy-in 100,00 € bar',
    );
    expect(describeEntry({ type: 'buy_in', amountCents: 10000, payment: 'credit' })).toBe(
      'Buy-in 100,00 € Liste',
    );
    expect(describeEntry({ type: 'cash_out', amountCents: 25000, payment: null })).toBe(
      'Stack 250,00 €',
    );
    expect(describeEntry({ type: 'payout', amountCents: 18000, payment: null })).toBe(
      'Bar-Auszahlung 180,00 €',
    );
  });
});

describe('buyInToast', () => {
  it('reads like the example of the work package', () => {
    expect(buyInToast(10000, 'cash', 'Ali')).toBe('100,00 € bar für Ali eingetragen');
    expect(buyInToast(10000, 'credit', 'Ali')).toBe('100,00 € auf Liste für Ali eingetragen');
  });
});
