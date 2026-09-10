import type { FrozenSettlement } from './types';

/**
 * Lax validation for a manually overridden settlement (docs/ARBEITSPAKETE.md
 * WP11, step 4; docs/SPEC.md §6.1).
 *
 * Unlike {@link verifySettlement}, this does **not** reconcile the numbers
 * against the entries, the three stages, the cash-first rule or the residuals:
 * an admin is allowed to enter any amounts and pairings on purpose. Only the
 * *basic integrity* that keeps the stored rows well-formed is enforced — and it
 * is enforced a second time by the RPC `close_session_manual`, which is the real
 * boundary (CLAUDE.md: authorisation and integrity live in the database).
 *
 * Rules (docs/SPEC.md §6.1):
 * - every amount is an integer number of cents,
 * - each "aus der Kasse" amount (`cashFromBox`) is `>= 0`,
 * - each transfer amount is `> 0`,
 * - no transfer from a player to himself,
 * - every line and every transfer references a real participant of the session,
 * - exactly one line per participant, no duplicates.
 *
 * Returns the list of violated rules; an empty list means „sound enough to
 * store“. Codes are English on purpose — they go into the server log, never onto
 * the screen.
 */
export function verifyManual(
  settlement: FrozenSettlement,
  participantIds: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const report = (code: string) => {
    if (!problems.includes(code)) problems.push(code);
  };

  const { lines, transfers } = settlement;

  // --- header: integers only (no reconciliation of the amounts) -------------
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

  // --- lines: one per participant, integer cents, cashFromBox >= 0 ----------
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.playerId)) report('DUPLICATE_PLAYER');
    seen.add(line.playerId);

    if (!participantIds.has(line.playerId)) report('LINE_PLAYER_UNKNOWN');

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
      line.netResult,
      line.residual,
    ]) {
      if (!Number.isInteger(value)) report('NON_INTEGER_AMOUNT');
    }

    // "Aus der Kasse" can never be negative — you cannot pay out negative cash.
    if (line.cashFromBox < 0) report('CASH_FROM_BOX_NEGATIVE');
  }

  // Every participant must have exactly one line, so the stored settlement
  // covers the whole table (grounding, not reconciliation).
  if (lines.length !== participantIds.size) report('LINE_COUNT_MISMATCH');

  // --- transfers: amount > 0, no self-transfer, real participants -----------
  for (const transfer of transfers) {
    if (!Number.isInteger(transfer.amount) || transfer.amount <= 0) {
      report('TRANSFER_AMOUNT_INVALID');
    }
    if (transfer.fromPlayerId === transfer.toPlayerId) report('TRANSFER_TO_SELF');
    if (!participantIds.has(transfer.fromPlayerId) || !participantIds.has(transfer.toPlayerId)) {
      report('TRANSFER_PLAYER_UNKNOWN');
    }
  }

  return problems;
}
