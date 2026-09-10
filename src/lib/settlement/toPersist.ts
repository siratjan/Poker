import type { Tables } from '@/lib/database.types';
import type { FrozenSettlement } from './types';

/**
 * Mapping between a computed settlement, the JSON the RPC `close_session`
 * expects, and the rows the database stores (docs/ARBEITSPAKETE.md WP6,
 * step 6).
 *
 * Three shapes describe the same numbers:
 *
 * 1. `SettlementResult` — what `computeSettlement()` returns (camelCase).
 * 2. `SettlementPayload` — the JSON handed to `close_session(p_settlement)`.
 *    The RPC reads exactly these keys (`0002_functions_triggers.sql`).
 * 3. `settlements` / `settlement_lines` / `settlement_transfers` rows —
 *    snake_case `*_cents` columns, one row per player and per transfer.
 *
 * Every conversion here is total and lossless; `toPersist.test.ts` proves the
 * round trips in both directions. That matters because a closed session is
 * *shown from the stored rows and never recomputed* (CLAUDE.md): if the mapping
 * lost or renamed a cent, the evening would be documented wrong forever.
 */

export type SettlementLinePayload = {
  playerId: string;
  cashIn: number;
  creditIn: number;
  stack: number;
  payout: number;
  isCashPlayer: boolean;
  claim: number;
  cashTier1: number;
  cashTier2: number;
  cashTier3: number;
  cashFromBox: number;
  netResult: number;
  residual: number;
};

export type TransferPayload = {
  fromPlayerId: string;
  toPlayerId: string;
  amount: number;
};

/** JSON body of `close_session(p_session_id, p_settlement, p_note)`. */
export type SettlementPayload = {
  algorithmVersion: number;
  totalBuyIn: number;
  totalStack: number;
  discrepancy: number;
  cashBoxStart: number;
  cashBoxAfterPayouts: number;
  lines: SettlementLinePayload[];
  transfers: TransferPayload[];
  unallocatedCash: number;
  uncoveredClaims: number;
  uncoveredDebts: number;
  /**
   * `true` for a hand-edited settlement (WP11, docs/SPEC.md §6.1). `close_session`
   * ignores this key and always stores `false`; only `close_session_manual` reads
   * it and stores `settlements.is_manual`.
   */
  isManual: boolean;
};

/** The money columns of a stored settlement head. */
export type StoredSettlementHead = Pick<
  Tables<'settlements'>,
  | 'session_id'
  | 'algorithm_version'
  | 'total_buy_in_cents'
  | 'total_stack_cents'
  | 'discrepancy_cents'
  | 'cash_box_start_cents'
  | 'cash_box_after_payouts_cents'
  | 'unallocated_cash_cents'
  | 'uncovered_claims_cents'
  | 'uncovered_debts_cents'
  | 'is_manual'
>;

/** The three tables of one frozen settlement, as they come out of the query. */
export type StoredSettlementRows = {
  settlement: StoredSettlementHead;
  lines: Tables<'settlement_lines'>[];
  transfers: Tables<'settlement_transfers'>[];
};

/** `SettlementResult` -> the JSON body of `close_session`. */
export function toSettlementPayload(result: FrozenSettlement): SettlementPayload {
  return {
    algorithmVersion: result.algorithmVersion,
    totalBuyIn: result.totalBuyIn,
    totalStack: result.totalStack,
    discrepancy: result.discrepancy,
    cashBoxStart: result.cashBoxStart,
    cashBoxAfterPayouts: result.cashBoxAfterPayouts,
    lines: result.lines.map((line) => ({
      playerId: line.playerId,
      cashIn: line.cashIn,
      creditIn: line.creditIn,
      stack: line.stack,
      payout: line.payout,
      isCashPlayer: line.isCashPlayer,
      claim: line.claim,
      cashTier1: line.cashTier1,
      cashTier2: line.cashTier2,
      cashTier3: line.cashTier3,
      cashFromBox: line.cashFromBox,
      netResult: line.netResult,
      residual: line.residual,
    })),
    transfers: result.transfers.map((transfer) => ({
      fromPlayerId: transfer.fromPlayerId,
      toPlayerId: transfer.toPlayerId,
      amount: transfer.amount,
    })),
    unallocatedCash: result.unallocatedCash,
    uncoveredClaims: result.uncoveredClaims,
    uncoveredDebts: result.uncoveredDebts,
    isManual: result.isManual,
  };
}

/** The JSON body of `close_session` -> a displayable settlement. */
export function fromSettlementPayload(payload: SettlementPayload): FrozenSettlement {
  return {
    algorithmVersion: payload.algorithmVersion,
    totalBuyIn: payload.totalBuyIn,
    totalStack: payload.totalStack,
    discrepancy: payload.discrepancy,
    cashBoxStart: payload.cashBoxStart,
    cashBoxAfterPayouts: payload.cashBoxAfterPayouts,
    lines: payload.lines.map((line) => ({ ...line })),
    transfers: payload.transfers.map((transfer) => ({ ...transfer })),
    unallocatedCash: payload.unallocatedCash,
    uncoveredClaims: payload.uncoveredClaims,
    uncoveredDebts: payload.uncoveredDebts,
    isManual: payload.isManual,
  };
}

/**
 * Stored rows -> the settlement the view renders. Lines and transfers are
 * ordered by their stored `position`, which is the join order of the session
 * for lines and the order the greedy produced for transfers; sorting a copy
 * keeps the caller's arrays untouched.
 */
export function fromStoredRows(rows: StoredSettlementRows): FrozenSettlement {
  const { settlement } = rows;

  return {
    algorithmVersion: settlement.algorithm_version,
    totalBuyIn: settlement.total_buy_in_cents,
    totalStack: settlement.total_stack_cents,
    discrepancy: settlement.discrepancy_cents,
    cashBoxStart: settlement.cash_box_start_cents,
    cashBoxAfterPayouts: settlement.cash_box_after_payouts_cents,
    lines: [...rows.lines]
      .sort((a, b) => a.position - b.position)
      .map((line) => ({
        playerId: line.player_id,
        cashIn: line.cash_in_cents,
        creditIn: line.credit_in_cents,
        stack: line.stack_cents,
        payout: line.payout_cents,
        isCashPlayer: line.is_cash_player,
        claim: line.claim_cents,
        cashTier1: line.cash_tier1_cents,
        cashTier2: line.cash_tier2_cents,
        cashTier3: line.cash_tier3_cents,
        cashFromBox: line.cash_from_box_cents,
        netResult: line.net_result_cents,
        residual: line.residual_cents,
      })),
    transfers: [...rows.transfers]
      .sort((a, b) => a.position - b.position)
      .map((transfer) => ({
        fromPlayerId: transfer.from_player_id,
        toPlayerId: transfer.to_player_id,
        amount: transfer.amount_cents,
      })),
    unallocatedCash: settlement.unallocated_cash_cents,
    uncoveredClaims: settlement.uncovered_claims_cents,
    uncoveredDebts: settlement.uncovered_debts_cents,
    isManual: settlement.is_manual,
  };
}

/**
 * The inverse of {@link fromStoredRows}: the rows `close_session` writes for a
 * given result. The RPC does the real insert — this function exists so that
 * `toPersist.test.ts` can prove the storage mapping loses nothing, column by
 * column.
 *
 * `positions` is the join order per player (`session_players.position`); a
 * player missing from the map keeps his index in `lines`, which is that same
 * order.
 */
export function toStoredRows(
  result: FrozenSettlement,
  sessionId: string,
  positions: ReadonlyMap<string, number>,
): StoredSettlementRows {
  return {
    settlement: {
      session_id: sessionId,
      algorithm_version: result.algorithmVersion,
      total_buy_in_cents: result.totalBuyIn,
      total_stack_cents: result.totalStack,
      discrepancy_cents: result.discrepancy,
      cash_box_start_cents: result.cashBoxStart,
      cash_box_after_payouts_cents: result.cashBoxAfterPayouts,
      unallocated_cash_cents: result.unallocatedCash,
      uncovered_claims_cents: result.uncoveredClaims,
      uncovered_debts_cents: result.uncoveredDebts,
      is_manual: result.isManual,
    },
    lines: result.lines.map((line, index) => ({
      session_id: sessionId,
      player_id: line.playerId,
      position: positions.get(line.playerId) ?? index,
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
    })),
    transfers: result.transfers.map((transfer, index) => ({
      id: `${sessionId}-transfer-${index}`,
      session_id: sessionId,
      position: index,
      from_player_id: transfer.fromPlayerId,
      to_player_id: transfer.toPlayerId,
      amount_cents: transfer.amount,
    })),
  };
}
