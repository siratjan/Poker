import { describe, expect, it } from 'vitest';
import { computeSettlement } from './index';
import type { FrozenSettlement, SettlementParticipant } from './types';
import { verifyManual } from './verifyManual';

/**
 * Basic-integrity check for a manual override (docs/ARBEITSPAKETE.md WP11,
 * step 4; docs/SPEC.md §6.1).
 *
 * The point of these tests is the deliberate asymmetry with `verifySettlement`:
 * the reconciliation against buy-ins/stacks/residuals is **gone**, but the few
 * rules that keep the stored rows well-formed still bite.
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const STRANGER = '99999999-9999-4999-8999-999999999999';

const PARTS: SettlementParticipant[] = [
  { playerId: A, name: 'A', position: 0, cashIn: 10000, creditIn: 0, stack: 20000, payout: 0 },
  { playerId: B, name: 'B', position: 1, cashIn: 10000, creditIn: 0, stack: 4000, payout: 0 },
  { playerId: C, name: 'C', position: 2, cashIn: 0, creditIn: 10000, stack: 6000, payout: 0 },
];

const IDS = new Set([A, B, C]);

/** The automatic base flagged manual, with optional overrides applied. */
function manual(patch: Partial<FrozenSettlement> = {}): FrozenSettlement {
  return { ...computeSettlement(PARTS), isManual: true, ...patch };
}

describe('verifyManual', () => {
  it('accepts the untouched automatic settlement', () => {
    expect(verifyManual(manual(), IDS)).toEqual([]);
  });

  it('does NOT reconcile: unstimmige Beträge und Paarungen sind erlaubt', () => {
    const edited = manual({
      lines: computeSettlement(PARTS).lines.map((line) => ({ ...line, cashFromBox: 999 })),
      transfers: [{ fromPlayerId: C, toPlayerId: A, amount: 424242 }],
    });
    // Cash sum, transfer sum and residuals are all inconsistent now — and that
    // is fine for a manual override.
    expect(verifyManual(edited, IDS)).toEqual([]);
  });

  it('rejects a negative cash-from-box amount', () => {
    const bad = manual({
      lines: computeSettlement(PARTS).lines.map((line, index) =>
        index === 0 ? { ...line, cashFromBox: -1 } : line,
      ),
    });
    expect(verifyManual(bad, IDS)).toContain('CASH_FROM_BOX_NEGATIVE');
  });

  it('rejects a non-integer amount', () => {
    const bad = manual({
      lines: computeSettlement(PARTS).lines.map((line, index) =>
        index === 0 ? { ...line, cashFromBox: 10.5 } : line,
      ),
    });
    expect(verifyManual(bad, IDS)).toContain('NON_INTEGER_AMOUNT');
  });

  it('rejects a transfer amount of 0 or negative', () => {
    expect(verifyManual(manual({ transfers: [{ fromPlayerId: C, toPlayerId: A, amount: 0 }] }), IDS)).toContain(
      'TRANSFER_AMOUNT_INVALID',
    );
    expect(
      verifyManual(manual({ transfers: [{ fromPlayerId: C, toPlayerId: A, amount: -5 }] }), IDS),
    ).toContain('TRANSFER_AMOUNT_INVALID');
  });

  it('rejects a self-transfer', () => {
    expect(
      verifyManual(manual({ transfers: [{ fromPlayerId: A, toPlayerId: A, amount: 100 }] }), IDS),
    ).toContain('TRANSFER_TO_SELF');
  });

  it('rejects a transfer to or from a non-participant', () => {
    expect(
      verifyManual(manual({ transfers: [{ fromPlayerId: STRANGER, toPlayerId: A, amount: 100 }] }), IDS),
    ).toContain('TRANSFER_PLAYER_UNKNOWN');
  });

  it('rejects a line for a non-participant and a missing line', () => {
    const withStranger = manual({
      lines: [
        ...computeSettlement(PARTS).lines,
        { ...computeSettlement(PARTS).lines[0], playerId: STRANGER },
      ],
    });
    const problems = verifyManual(withStranger, IDS);
    expect(problems).toContain('LINE_PLAYER_UNKNOWN');
    expect(problems).toContain('LINE_COUNT_MISMATCH');

    const missing = manual({ lines: computeSettlement(PARTS).lines.slice(0, 2) });
    expect(verifyManual(missing, IDS)).toContain('LINE_COUNT_MISMATCH');
  });
});
