import { distribute } from './distribute';
import type { FrozenSettlement } from './types';

/**
 * Independent re-check of a settlement against every invariant of
 * `docs/SETTLEMENT.md` (docs/ARBEITSPAKETE.md WP6, Testauftrag Gaby).
 *
 * Why this exists although `closeSession` computes the settlement itself:
 * `close_session` in the database validates a lot, but Gaby's
 * `tests/gaby/wp1-close-session.gaby.test.ts` documents two gaps it deliberately
 * does **not** close — the proportional truncation of stage 1 (invariant 5) and
 * the coverage of every single debtor inside the transfer list. For those two,
 * the server action is the only line of defence, so the payload is verified once
 * more right before the RPC is called. A second reason: this module derives its
 * expectations from the *lines*, not from `computeSettlement`'s internals, so a
 * regression in the algorithm itself would be caught here instead of being
 * frozen into the database forever (CLAUDE.md: a closed session never changes).
 *
 * Returns the list of violated rules; an empty list means „sound“. The codes are
 * English on purpose — they go into the server log, never onto the screen.
 */
export function verifySettlement(settlement: FrozenSettlement): string[] {
  const problems: string[] = [];
  const report = (code: string) => {
    if (!problems.includes(code)) problems.push(code);
  };

  const { lines, transfers } = settlement;

  // --- invariant 1: integers, and only three fields may be negative ---------
  for (const value of [
    settlement.totalBuyIn,
    settlement.totalStack,
    settlement.discrepancy,
    settlement.cashBoxStart,
    settlement.cashBoxAfterPayouts,
    settlement.unallocatedCash,
    settlement.uncoveredClaims,
    settlement.uncoveredDebts,
  ]) {
    if (!Number.isInteger(value)) report('NON_INTEGER_AMOUNT');
  }
  for (const value of [
    settlement.totalBuyIn,
    settlement.totalStack,
    settlement.cashBoxStart,
    settlement.cashBoxAfterPayouts,
    settlement.unallocatedCash,
    settlement.uncoveredClaims,
    settlement.uncoveredDebts,
  ]) {
    if (value < 0) report('NEGATIVE_AMOUNT');
  }

  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.playerId)) report('DUPLICATE_PLAYER');
    seen.add(line.playerId);

    for (const value of [
      line.cashIn,
      line.creditIn,
      line.stack,
      line.payout,
      line.claim,
      line.cashTier1,
      line.cashTier2,
      line.cashTier3,
      line.cashFromBox,
    ]) {
      if (!Number.isInteger(value)) report('NON_INTEGER_AMOUNT');
      if (value < 0) report('NEGATIVE_AMOUNT');
    }
    if (!Number.isInteger(line.netResult) || !Number.isInteger(line.residual)) {
      report('NON_INTEGER_AMOUNT');
    }

    // --- per line: everything that is a definition, not a decision ----------
    if (line.payout > line.stack) report('PAYOUT_EXCEEDS_STACK');
    if (line.isCashPlayer !== line.cashIn > 0) report('IS_CASH_PLAYER_WRONG');
    if (line.claim !== line.stack - line.payout) report('CLAIM_WRONG');
    if (line.netResult !== line.stack - line.cashIn - line.creditIn) report('NET_RESULT_WRONG');
    if (line.cashFromBox !== line.cashTier1 + line.cashTier2 + line.cashTier3) {
      report('CASH_FROM_BOX_WRONG');
    }
    if (line.residual !== line.claim - line.cashFromBox - line.creditIn) report('RESIDUAL_WRONG');
    // invariant 4: nobody gets more out of the box than he still has to receive
    if (line.cashFromBox > line.claim) report('CASH_ABOVE_CLAIM');
  }

  // --- header totals must follow from the lines ----------------------------
  const totalCash = sum(lines.map((line) => line.cashIn));
  const totalCredit = sum(lines.map((line) => line.creditIn));
  const totalStack = sum(lines.map((line) => line.stack));
  const totalPayout = sum(lines.map((line) => line.payout));

  if (settlement.totalBuyIn !== totalCash + totalCredit) report('TOTAL_BUY_IN_WRONG');
  if (settlement.totalStack !== totalStack) report('TOTAL_STACK_WRONG');
  if (settlement.discrepancy !== totalStack - (totalCash + totalCredit)) {
    report('DISCREPANCY_WRONG');
  }
  if (settlement.cashBoxStart !== totalCash) report('CASH_BOX_START_WRONG');
  if (settlement.cashBoxAfterPayouts !== totalCash - totalPayout) {
    report('CASH_BOX_AFTER_PAYOUTS_WRONG');
  }
  if (totalPayout > totalCash) report('PAYOUT_EXCEEDS_CASHBOX');

  // --- the three stages, recomputed exactly as docs/SETTLEMENT.md says ------
  // This is what catches the two gaps of the RPC: an unfair (non-proportional)
  // truncation in stage 1 (invariant 5) and cash to a list player while a cash
  // payer is still open (invariant 6) both change these arrays.
  let box = totalCash - totalPayout;

  const want1 = lines.map((line) =>
    line.isCashPlayer ? Math.max(0, Math.min(line.cashIn, line.stack) - line.payout) : 0,
  );
  const tier1 = safeDistribute(box, want1);
  if (tier1 === null) {
    report('STAGE_INPUT_INVALID');
  } else {
    if (!sameAmounts(tier1, lines.map((line) => line.cashTier1))) report('TIER1_NOT_PROPORTIONAL');
    box -= sum(tier1);

    const want2 = lines.map((line, index) => (line.isCashPlayer ? line.claim - tier1[index] : 0));
    const tier2 = safeDistribute(box, want2);
    if (tier2 === null) {
      report('STAGE_INPUT_INVALID');
    } else {
      if (!sameAmounts(tier2, lines.map((line) => line.cashTier2))) report('TIER2_WRONG');
      box -= sum(tier2);

      const want3 = lines.map((line) => (line.isCashPlayer ? 0 : line.claim));
      const tier3 = safeDistribute(box, want3);
      if (tier3 === null) {
        report('STAGE_INPUT_INVALID');
      } else {
        if (!sameAmounts(tier3, lines.map((line) => line.cashTier3))) report('TIER3_WRONG');
        box -= sum(tier3);

        if (settlement.unallocatedCash !== box) report('UNALLOCATED_CASH_WRONG');
      }
    }
  }

  // invariant 2: the cash box adds up
  const fromBox = sum(lines.map((line) => line.cashFromBox));
  if (fromBox + settlement.unallocatedCash !== totalCash - totalPayout) {
    report('CASH_BOX_DOES_NOT_ADD_UP');
  }

  // invariant 6, stated directly as well: no stage-3 cash while a cash payer
  // still has an open claim
  if (
    sum(lines.map((line) => line.cashTier3)) > 0 &&
    lines.some((line) => line.isCashPlayer && line.cashFromBox !== line.claim)
  ) {
    report('CASH_FIRST_VIOLATED');
  }

  // --- transfers -----------------------------------------------------------
  const byId = new Map(lines.map((line) => [line.playerId, line]));
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();

  for (const transfer of transfers) {
    // invariant 8
    if (!Number.isInteger(transfer.amount) || transfer.amount <= 0) report('TRANSFER_AMOUNT_INVALID');
    if (transfer.fromPlayerId === transfer.toPlayerId) report('TRANSFER_TO_SELF');

    const from = byId.get(transfer.fromPlayerId);
    const to = byId.get(transfer.toPlayerId);
    if (from === undefined || to === undefined) {
      report('TRANSFER_PLAYER_UNKNOWN');
      continue;
    }
    if (from.residual >= 0 || to.residual <= 0) report('TRANSFER_DIRECTION_WRONG');

    outgoing.set(transfer.fromPlayerId, (outgoing.get(transfer.fromPlayerId) ?? 0) + transfer.amount);
    incoming.set(transfer.toPlayerId, (incoming.get(transfer.toPlayerId) ?? 0) + transfer.amount);
  }

  // The gap the database leaves open: sums can match while one debtor pays for
  // another. Nobody may pay more than he owes, or receive more than he is owed.
  for (const [playerId, amount] of outgoing) {
    const line = byId.get(playerId);
    if (line !== undefined && amount > Math.max(-line.residual, 0)) report('DEBTOR_OVERPAYS');
  }
  for (const [playerId, amount] of incoming) {
    const line = byId.get(playerId);
    if (line !== undefined && amount > Math.max(line.residual, 0)) report('CREDITOR_OVERPAID');
  }

  const positive = sum(lines.map((line) => Math.max(line.residual, 0)));
  const negative = sum(lines.map((line) => Math.max(-line.residual, 0)));
  const moved = sum(transfers.map((transfer) => transfer.amount));

  // invariant 9 plus step 5: the greedy runs until one side is empty
  if (moved !== Math.min(positive, negative)) report('TRANSFER_TOTAL_WRONG');
  if (moved + settlement.uncoveredClaims !== positive) report('UNCOVERED_CLAIMS_WRONG');
  if (moved + settlement.uncoveredDebts !== negative) report('UNCOVERED_DEBTS_WRONG');

  // --- step 5: how a difference has to show up -----------------------------
  const discrepancy = settlement.discrepancy;
  if (discrepancy === 0) {
    // invariant 3
    if (
      positive !== negative ||
      settlement.unallocatedCash !== 0 ||
      settlement.uncoveredClaims !== 0 ||
      settlement.uncoveredDebts !== 0
    ) {
      report('CLEAN_SESSION_HAS_LEFTOVERS');
    }
  } else if (discrepancy < 0) {
    if (
      settlement.uncoveredClaims !== 0 ||
      settlement.unallocatedCash + settlement.uncoveredDebts !== -discrepancy
    ) {
      report('NEGATIVE_DISCREPANCY_UNEXPLAINED');
    }
  } else if (
    settlement.unallocatedCash !== 0 ||
    settlement.uncoveredDebts !== 0 ||
    settlement.uncoveredClaims !== discrepancy
  ) {
    report('POSITIVE_DISCREPANCY_UNEXPLAINED');
  }

  return problems;
}

/**
 * `distribute` throws on a negative box or negative wants. Those are already
 * reported as `NEGATIVE_AMOUNT` above; here the stage check simply gives up
 * instead of turning a bad payload into an exception.
 */
function safeDistribute(box: number, wants: readonly number[]): number[] | null {
  try {
    return distribute(box, wants);
  } catch {
    return null;
  }
}

function sameAmounts(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}
