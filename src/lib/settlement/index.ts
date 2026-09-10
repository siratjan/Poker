import { distribute } from './distribute';
import { SettlementError, assertAmount } from './errors';
import { computeTransfers, type Residual } from './transfers';
import type {
  SettlementInput,
  SettlementLine,
  SettlementParticipant,
  SettlementResult,
} from './types';

export { distribute } from './distribute';
export { SettlementError, type SettlementErrorCode } from './errors';
export { computeTransfers, type Residual, type TransfersResult } from './transfers';
export { describeTransfer } from './format';
export type {
  SettlementInput,
  SettlementLine,
  SettlementParticipant,
  SettlementResult,
  Transfer,
} from './types';

/** Version of the algorithm, stored with every frozen settlement. */
export const ALGORITHM_VERSION = 1;

/**
 * Computes the settlement of one session exactly as specified in
 * `docs/SETTLEMENT.md` (version 1). Pure function, no I/O, integer cents only.
 *
 * Throws a `SettlementError` when a precondition is violated; the caller maps
 * `error.code` to a German message.
 */
export function computeSettlement(participants: SettlementInput): SettlementResult {
  const sorted = validateAndSort(participants);

  const cashBoxStart = sum(sorted, (p) => p.cashIn);
  const totalPayout = sum(sorted, (p) => p.payout);
  const totalBuyIn = cashBoxStart + sum(sorted, (p) => p.creditIn);
  const totalStack = sum(sorted, (p) => p.stack);
  const cashBoxAfterPayouts = cashBoxStart - totalPayout;

  const claims = sorted.map((p) => p.stack - p.payout);
  const isCashPlayer = sorted.map((p) => p.cashIn > 0);
  let box = cashBoxAfterPayouts;

  // Stage 1 – cash stake back, capped by the own stack and already taken cash.
  const want1 = sorted.map((p, i) =>
    isCashPlayer[i] ? Math.max(0, Math.min(p.cashIn, p.stack) - p.payout) : 0,
  );
  const cashTier1 = distribute(box, want1);
  box -= total(cashTier1);

  // Stage 2 – remaining cash to the open claims of the cash payers.
  const want2 = sorted.map((_, i) => (isCashPlayer[i] ? claims[i] - cashTier1[i] : 0));
  const cashTier2 = distribute(box, want2);
  box -= total(cashTier2);

  // Stage 3 – only what is then left goes to the credit players.
  const want3 = sorted.map((_, i) => (isCashPlayer[i] ? 0 : claims[i]));
  const cashTier3 = distribute(box, want3);
  box -= total(cashTier3);

  const lines: SettlementLine[] = sorted.map((p, i) => {
    const cashFromBox = cashTier1[i] + cashTier2[i] + cashTier3[i];
    return {
      playerId: p.playerId,
      cashIn: p.cashIn,
      creditIn: p.creditIn,
      stack: p.stack,
      payout: p.payout,
      isCashPlayer: isCashPlayer[i],
      claim: claims[i],
      cashTier1: cashTier1[i],
      cashTier2: cashTier2[i],
      cashTier3: cashTier3[i],
      cashFromBox,
      netResult: p.stack - p.cashIn - p.creditIn,
      residual: claims[i] - cashFromBox - p.creditIn,
    };
  });

  const residuals: Residual[] = lines.map((line) => ({
    playerId: line.playerId,
    residual: line.residual,
  }));
  const { transfers, uncoveredClaims, uncoveredDebts } = computeTransfers(residuals);

  return {
    algorithmVersion: ALGORITHM_VERSION,
    totalBuyIn,
    totalStack,
    discrepancy: totalStack - totalBuyIn,
    cashBoxStart,
    cashBoxAfterPayouts,
    lines,
    transfers,
    unallocatedCash: box,
    uncoveredClaims,
    uncoveredDebts,
    // The automatic path is never a manual override (docs/SPEC.md §6.1).
    isManual: false,
  };
}

/**
 * Checks the preconditions of `docs/SETTLEMENT.md` and returns the
 * participants sorted by join order, so that every tie-break downstream is
 * deterministic. `position` is mandatory and must be a unique integer: there is
 * no fallback to the array index, because mixing real positions with array
 * indices would sort silently wrong (TV12).
 */
function validateAndSort(participants: SettlementInput): SettlementParticipant[] {
  if (participants.length === 0) {
    throw new SettlementError('NO_PARTICIPANTS', 'A settlement needs at least one participant');
  }

  const seen = new Set<string>();
  const seenPositions = new Set<number>();
  let totalPayout = 0;
  let totalCashIn = 0;

  for (const p of participants) {
    assertAmount(p.cashIn, 'cashIn', p.playerId);
    assertAmount(p.creditIn, 'creditIn', p.playerId);
    assertAmount(p.stack, 'stack', p.playerId);
    assertAmount(p.payout, 'payout', p.playerId);

    if (seen.has(p.playerId)) {
      throw new SettlementError(
        'DUPLICATE_PLAYER',
        `Player appears more than once: ${p.playerId}`,
        p.playerId,
      );
    }
    seen.add(p.playerId);

    assertPosition(p, seenPositions);

    if (p.payout > p.stack) {
      throw new SettlementError(
        'PAYOUT_EXCEEDS_STACK',
        `payout (${p.payout}) exceeds stack (${p.stack})`,
        p.playerId,
      );
    }

    totalPayout += p.payout;
    totalCashIn += p.cashIn;
  }

  if (totalPayout > totalCashIn) {
    throw new SettlementError(
      'PAYOUT_EXCEEDS_CASHBOX',
      `total payout (${totalPayout}) exceeds the cash box (${totalCashIn})`,
    );
  }

  // `position` is a unique integer after the check above, so the join order
  // alone decides every comparison. The secondary and tertiary keys of
  // `docs/SETTLEMENT.md` ("Eingabe") - name, then `playerId` - can therefore
  // never apply: a duplicated position is rejected instead of being tie-broken
  // silently. Sorting a copy keeps the caller's array untouched.
  return [...participants].sort((a, b) => a.position - b.position);
}

/**
 * `position` is the join order from `session_players`. It is mandatory so that
 * a partially filled preview array cannot mix real positions with array
 * indices; duplicates would make the sort order depend on the input order.
 */
function assertPosition(participant: SettlementParticipant, seenPositions: Set<number>): void {
  const { position, playerId } = participant;

  if (!Number.isInteger(position)) {
    throw new SettlementError(
      'INVALID_POSITION',
      `position must be an integer join order, received: ${String(position)}`,
      playerId,
    );
  }

  if (seenPositions.has(position)) {
    throw new SettlementError(
      'INVALID_POSITION',
      `position ${position} is used by more than one participant`,
      playerId,
    );
  }

  seenPositions.add(position);
}

function sum(
  participants: readonly SettlementParticipant[],
  pick: (participant: SettlementParticipant) => number,
): number {
  return participants.reduce((acc, participant) => acc + pick(participant), 0);
}

function total(amounts: readonly number[]): number {
  return amounts.reduce((acc, amount) => acc + amount, 0);
}
