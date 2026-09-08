/**
 * Errors of the settlement algorithm. The preconditions of
 * `docs/SETTLEMENT.md` are enforced by UI and database, the algorithm checks
 * them again and refuses to guess: wrong money is worse than no result.
 */

export type SettlementErrorCode =
  | 'NO_PARTICIPANTS'
  | 'PAYOUT_EXCEEDS_STACK'
  | 'PAYOUT_EXCEEDS_CASHBOX'
  | 'NEGATIVE_AMOUNT'
  | 'NON_INTEGER_AMOUNT'
  | 'DUPLICATE_PLAYER'
  | 'INVALID_POSITION';

/**
 * Thrown when a precondition of `computeSettlement` (or `distribute`) is
 * violated. Messages are English on purpose: callers map `code` to a German
 * message, the message here is for logs and tests.
 */
export class SettlementError extends Error {
  readonly code: SettlementErrorCode;
  readonly playerId?: string;

  constructor(code: SettlementErrorCode, message: string, playerId?: string) {
    super(message);
    this.name = 'SettlementError';
    this.code = code;
    if (playerId !== undefined) {
      this.playerId = playerId;
    }
  }
}

/**
 * Guards a single amount. Non-integer is reported before negative, so that a
 * value like `-1.5` is a `NON_INTEGER_AMOUNT`.
 */
export function assertAmount(
  value: number,
  field: string,
  playerId?: string,
): void {
  if (!Number.isInteger(value)) {
    throw new SettlementError(
      'NON_INTEGER_AMOUNT',
      `${field} must be an integer number of cents, received: ${value}`,
      playerId,
    );
  }
  if (value < 0) {
    throw new SettlementError(
      'NEGATIVE_AMOUNT',
      `${field} must not be negative, received: ${value}`,
      playerId,
    );
  }
}
