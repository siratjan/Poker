import type { Transfer } from './types';

/** One residual of a player: `> 0` creditor, `< 0` debtor, `0` settled. */
export type Residual = {
  playerId: string;
  residual: number;
};

export type TransfersResult = {
  transfers: Transfer[];
  /** Claims that stayed uncovered (only `> 0` when `discrepancy > 0`). */
  uncoveredClaims: number;
  /**
   * Debts that stayed unassigned (only `> 0` when `discrepancy < 0`). They are
   * not reported as debt, the same amount is visible as `unallocatedCash`.
   */
  uncoveredDebts: number;
};

type Open = { playerId: string; rest: number; index: number };

/**
 * Greedy matching of debtors and creditors with a minimal number of transfers
 * (`docs/SETTLEMENT.md`, step 5): always pair the largest remaining debtor with
 * the largest remaining creditor, ties broken by input order.
 */
export function computeTransfers(residuals: readonly Residual[]): TransfersResult {
  const creditors = collect(residuals, (residual) => residual);
  const debtors = collect(residuals, (residual) => -residual);

  const transfers: Transfer[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = Math.min(creditor.rest, debtor.rest);

    transfers.push({
      fromPlayerId: debtor.playerId,
      toPlayerId: creditor.playerId,
      amount,
    });

    creditor.rest -= amount;
    debtor.rest -= amount;
    // `amount` is the minimum of both, so at least one side reaches zero here;
    // on a tie both are dropped.
    if (creditor.rest === 0) creditorIndex += 1;
    if (debtor.rest === 0) debtorIndex += 1;
  }

  return {
    transfers,
    uncoveredClaims: sumRest(creditors, creditorIndex),
    uncoveredDebts: sumRest(debtors, debtorIndex),
  };
}

/** Open amounts, largest first, ties broken by input order. */
function collect(
  residuals: readonly Residual[],
  toOpenAmount: (residual: number) => number,
): Open[] {
  return residuals
    .map((entry, index) => ({
      playerId: entry.playerId,
      rest: toOpenAmount(entry.residual),
      index,
    }))
    .filter((entry) => entry.rest > 0)
    .sort((a, b) => (b.rest !== a.rest ? b.rest - a.rest : a.index - b.index));
}

function sumRest(entries: readonly Open[], from: number): number {
  let sum = 0;
  for (let i = from; i < entries.length; i += 1) {
    sum += entries[i].rest;
  }
  return sum;
}
