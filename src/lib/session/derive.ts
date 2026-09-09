import { computeSettlement, type SettlementParticipant } from '@/lib/settlement';
import type { Enums } from '@/lib/database.types';

/**
 * Pure derivation of everything the session detail screen shows
 * (docs/ARBEITSPAKETE.md WP5, step 3). No I/O, integer cents only, so the whole
 * head/participant/preview arithmetic is unit-testable (`derive.test.ts`).
 *
 * These numbers are the *live* view of an open session. They are never used for
 * a closed session: a frozen settlement is read from the database and shown as
 * stored, never recomputed (CLAUDE.md).
 */

export type EntryType = Enums<'entry_type'>;
export type PaymentMethod = Enums<'payment_method'>;

/** One row of `entries`, as the detail query hands it to the UI. */
export type SessionEntry = {
  id: string;
  playerId: string;
  type: EntryType;
  amountCents: number;
  payment: PaymentMethod | null;
  /** ISO timestamp (`timestamptz`), rendered in Europe/Berlin by the UI. */
  createdAt: string;
  /** Display name of the user who recorded it, `null` if unknown. */
  createdByName: string | null;
};

/** One row of `session_players`, joined with the player name. */
export type SessionParticipant = {
  playerId: string;
  name: string;
  /** Join order (`session_players.position`). */
  position: number;
};

/** A participant with all amounts of the evening derived from the entries. */
export type DerivedParticipant = SessionParticipant & {
  /** Σ `buy_in` paid in cash. */
  cashIn: number;
  /** Σ `buy_in` put on the credit list. */
  creditIn: number;
  /** `cashIn + creditIn`. */
  buyIn: number;
  /** The `cash_out` amount, or `null` while the player is still playing. */
  stack: number | null;
  /** Σ `payout` — cash already taken from the box. */
  payout: number;
  /** `stack - buyIn`, or `null` without a stack. */
  net: number | null;
  /** Payment method of the last buy-in, to preselect the toggle. */
  lastPayment: PaymentMethod | null;
  /** `true` as soon as the player has any entry (blocks removal). */
  hasEntries: boolean;
};

/** Session-wide totals for the head tiles and the close checklist. */
export type SessionTotals = {
  totalBuyIn: number;
  totalCash: number;
  totalCredit: number;
  totalStack: number;
  totalPayout: number;
  /** Cash physically in the box: `totalCash - Σ payout`. */
  cashBox: number;
  participantCount: number;
  /** Participants that already have a `cash_out`. */
  stackCount: number;
  /** Participants that are still playing. */
  openParticipants: number;
  /** Every participant has a stack, and there is at least one participant. */
  canClose: boolean;
  /** `totalStack - totalBuyIn`; only meaningful once `canClose` is true. */
  discrepancy: number;
};

export type DerivedSession = {
  participants: DerivedParticipant[];
  totals: SessionTotals;
};

/**
 * Aggregates the entries onto the participants, in join order.
 *
 * Entries of players that are not (or no longer) participants are ignored: the
 * foreign key of 0001 makes that impossible in the database, and silently
 * inventing a card for an unknown player would be worse than skipping it.
 */
export function deriveParticipants(
  participants: readonly SessionParticipant[],
  entries: readonly SessionEntry[],
): DerivedParticipant[] {
  const byPlayer = new Map<string, DerivedParticipant>();
  const sorted = [...participants].sort((a, b) => a.position - b.position);

  for (const participant of sorted) {
    byPlayer.set(participant.playerId, {
      ...participant,
      cashIn: 0,
      creditIn: 0,
      buyIn: 0,
      stack: null,
      payout: 0,
      net: null,
      lastPayment: null,
      hasEntries: false,
    });
  }

  // Oldest first, so "last payment method" really is the last one recorded.
  const chronological = [...entries].sort(compareByCreatedAtAsc);

  for (const entry of chronological) {
    const row = byPlayer.get(entry.playerId);
    if (row === undefined) continue;
    row.hasEntries = true;

    if (entry.type === 'buy_in') {
      if (entry.payment === 'credit') {
        row.creditIn += entry.amountCents;
      } else {
        // 0001 guarantees `payment is not null` for a buy-in; anything but
        // 'credit' is cash.
        row.cashIn += entry.amountCents;
      }
      row.lastPayment = entry.payment;
    } else if (entry.type === 'cash_out') {
      // A partial unique index (0001) allows exactly one cash_out per player
      // and session, so the last one wins without ambiguity.
      row.stack = entry.amountCents;
    } else {
      row.payout += entry.amountCents;
    }
  }

  for (const row of byPlayer.values()) {
    row.buyIn = row.cashIn + row.creditIn;
    row.net = row.stack === null ? null : row.stack - row.buyIn;
  }

  return sorted.map((participant) => {
    const row = byPlayer.get(participant.playerId);
    if (row === undefined) throw new Error('unreachable: participant lost');
    return row;
  });
}

/** Session totals from the already derived participants. */
export function deriveTotals(participants: readonly DerivedParticipant[]): SessionTotals {
  let totalCash = 0;
  let totalCredit = 0;
  let totalStack = 0;
  let totalPayout = 0;
  let stackCount = 0;

  for (const participant of participants) {
    totalCash += participant.cashIn;
    totalCredit += participant.creditIn;
    totalPayout += participant.payout;
    if (participant.stack !== null) {
      totalStack += participant.stack;
      stackCount += 1;
    }
  }

  const totalBuyIn = totalCash + totalCredit;
  const participantCount = participants.length;

  return {
    totalBuyIn,
    totalCash,
    totalCredit,
    totalStack,
    totalPayout,
    cashBox: totalCash - totalPayout,
    participantCount,
    stackCount,
    openParticipants: participantCount - stackCount,
    canClose: participantCount > 0 && stackCount === participantCount,
    discrepancy: totalStack - totalBuyIn,
  };
}

/** Participants and totals in one call. */
export function deriveSession(
  participants: readonly SessionParticipant[],
  entries: readonly SessionEntry[],
): DerivedSession {
  const derived = deriveParticipants(participants, entries);
  return { participants: derived, totals: deriveTotals(derived) };
}

/**
 * Input for the live preview of the cash distribution
 * (docs/ARBEITSPAKETE.md WP5, step 4, payout sheet).
 *
 * `computeSettlement` needs a stack for everyone. Players who are still playing
 * do not have one, so the preview assumes they end with exactly their buy-in
 * (a zero result). That keeps the preview free of an artificial discrepancy;
 * the UI marks it as provisional whenever such a player exists.
 */
export function previewParticipants(
  participants: readonly DerivedParticipant[],
): SettlementParticipant[] {
  return participants.map((participant) => ({
    playerId: participant.playerId,
    name: participant.name,
    position: participant.position,
    cashIn: participant.cashIn,
    creditIn: participant.creditIn,
    stack: participant.stack ?? assumedStack(participant),
    payout: participant.payout,
  }));
}

/**
 * A still-playing player is assumed to hold his buy-in, but never less than
 * what he already took out of the box in cash — a stack below the payout is a
 * violated precondition of the algorithm (`PAYOUT_EXCEEDS_STACK`) and cannot
 * happen for a real player either (trigger `STACK_BELOW_PAYOUT`).
 */
function assumedStack(participant: DerivedParticipant): number {
  return Math.max(participant.buyIn, participant.payout);
}

/** What the preview can say about one player's cash entitlement. */
export type CashPreview = {
  /** Cash this player would get from the box under the "cash first" rule. */
  cashFromBoxCents: number;
  /** `true` while at least one participant has no stack yet. */
  provisional: boolean;
};

/**
 * Preview of what a player would currently receive in cash, used as an
 * orientation in the payout sheet („Nach Bar-zuerst-Regel stünden Ali aktuell
 * ca. 180,00 € zu“).
 *
 * Returns `null` when no statement is possible: unknown player, or an input the
 * settlement rejects (`SettlementError`). The sheet then simply omits the hint
 * — the group decides about an early leaver anyway (SPEC §4).
 */
export function previewCashEntitlement(
  participants: readonly DerivedParticipant[],
  playerId: string,
): CashPreview | null {
  if (!participants.some((participant) => participant.playerId === playerId)) return null;

  try {
    const result = computeSettlement(previewParticipants(participants));
    const line = result.lines.find((entry) => entry.playerId === playerId);
    if (line === undefined) return null;
    return {
      cashFromBoxCents: line.cashFromBox,
      provisional: participants.some((participant) => participant.stack === null),
    };
  } catch {
    // Preconditions violated (e.g. a payout above the cash box after a race):
    // an orientation value is optional, an exception on the screen is not.
    return null;
  }
}

/** Newest first — the order the history list renders. */
export function sortEntriesNewestFirst(entries: readonly SessionEntry[]): SessionEntry[] {
  return [...entries].sort((a, b) => -compareByCreatedAtAsc(a, b));
}

/**
 * Chronological order with a stable tie-break on `id`: two entries recorded in
 * the same millisecond must not swap places between two renders.
 */
function compareByCreatedAtAsc(a: SessionEntry, b: SessionEntry): number {
  if (a.createdAt < b.createdAt) return -1;
  if (a.createdAt > b.createdAt) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
