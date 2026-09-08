/**
 * Types of the settlement algorithm, mirroring `docs/SETTLEMENT.md` (version 1).
 *
 * Every amount is an integer number of cents. Floats never appear in a
 * calculation path; `distribute()` works in BigInt arithmetic.
 */

/** One participant of a session, all amounts in integer cents and `>= 0`. */
export type SettlementParticipant = {
  /** Player this row belongs to; must be unique within the input. */
  playerId: string;
  /**
   * Display name, carried along for callers and logs. It is not used by the
   * calculation: `position` is unique, so the secondary sort key of
   * `docs/SETTLEMENT.md` never has to decide anything.
   */
  name?: string;
  /**
   * Join order within the session (`session_players.position`). Mandatory and
   * unique within one input: a missing, non-integer or duplicated position is
   * rejected with `INVALID_POSITION`. There is no fallback to the array index,
   * so a hand-built preview array has to state the order explicitly
   * (`docs/SETTLEMENT.md`, sections "Eingabe" and TV12).
   */
  position: number;
  /** Sum of all `buy_in` rows paid with cash. */
  cashIn: number;
  /** Sum of all `buy_in` rows put on the credit list. */
  creditIn: number;
  /** Amount of the `cash_out` row (end stack). */
  stack: number;
  /** Sum of all `payout` rows, i.e. cash already taken from the box. */
  payout: number;
};

/** Input of `computeSettlement`: the participants of exactly one session. */
export type SettlementInput = readonly SettlementParticipant[];

/** One result row per participant, in the sorted input order. */
export type SettlementLine = {
  playerId: string;
  cashIn: number;
  creditIn: number;
  stack: number;
  payout: number;
  /** `cashIn > 0` – a cash payer is served before every credit player. */
  isCashPlayer: boolean;
  /** `stack - payout` – what the player still has to receive. */
  claim: number;
  /** Received in stage 1 (cash stake back). */
  cashTier1: number;
  /** Received in stage 2 (remaining cash to cash payers). */
  cashTier2: number;
  /** Received in stage 3 (remaining cash to credit players). */
  cashTier3: number;
  /** `cashTier1 + cashTier2 + cashTier3` – to be paid out in cash now. */
  cashFromBox: number;
  /** `stack - cashIn - creditIn` – the player's result of the evening. */
  netResult: number;
  /** `claim - cashFromBox - creditIn` – `> 0` creditor, `< 0` debtor. */
  residual: number;
};

/** "`fromPlayerId` owes `toPlayerId` `amount` cents". */
export type Transfer = {
  fromPlayerId: string;
  toPlayerId: string;
  amount: number;
};

/** Complete, frozen result of one settlement run. */
export type SettlementResult = {
  algorithmVersion: 1;
  /** `Σ cashIn + Σ creditIn`. */
  totalBuyIn: number;
  /** `Σ stack`. */
  totalStack: number;
  /** `totalStack - totalBuyIn` (0 = clean, < 0 chips missing, > 0 too many). */
  discrepancy: number;
  /** `Σ cashIn`. */
  cashBoxStart: number;
  /** `Σ cashIn - Σ payout` – the cash that is physically distributed. */
  cashBoxAfterPayouts: number;
  lines: SettlementLine[];
  transfers: Transfer[];
  /** Cash left in the box after stage 3, only possible for `discrepancy < 0`. */
  unallocatedCash: number;
  /** Claims without cover, only possible for `discrepancy > 0`. */
  uncoveredClaims: number;
  /**
   * Debts without a creditor, only possible for `discrepancy < 0`. Together
   * with `unallocatedCash` this explains a negative discrepancy completely:
   * `unallocatedCash + uncoveredDebts === -discrepancy`
   * (`docs/SETTLEMENT.md`, step 5).
   */
  uncoveredDebts: number;
};
