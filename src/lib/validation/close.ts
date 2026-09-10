import { z } from 'zod';

/**
 * Validation for the close/reopen server actions (src/actions/close.ts,
 * docs/ARBEITSPAKETE.md WP6, step 1).
 *
 * Kept out of the `'use server'` file: such a module may only export async
 * functions, and the tests exercise these schemas directly. Messages are
 * German, ready for the UI.
 *
 * The lower bound of three characters mirrors the RPCs, which reject a shorter
 * comment with `DISCREPANCY_REQUIRES_ADMIN_NOTE` / `REASON_REQUIRED`
 * (`0002_functions_triggers.sql`). Checking it here only produces the friendlier
 * message; the database stays the boundary.
 */

/** `close_note` and the reopen reason are free text, capped to keep them readable. */
export const MAX_NOTE_LENGTH = 300;

const noteTooLong = `Der Kommentar darf höchstens ${MAX_NOTE_LENGTH} Zeichen lang sein.`;

const sessionId = z.uuid({ message: 'Ungültige Session.' });

export const closeSessionSchema = z.object({
  sessionId,
  /** Only required when there is a discrepancy — the action checks that. */
  note: z
    .string()
    .trim()
    .max(MAX_NOTE_LENGTH, { message: noteTooLong })
    .optional()
    .transform((value) => (value === undefined || value.length === 0 ? null : value)),
});

export const reopenSessionSchema = z.object({
  sessionId,
  reason: z
    .string()
    .trim()
    .min(3, { message: 'Bitte gib einen Grund an (mindestens 3 Zeichen).' })
    .max(MAX_NOTE_LENGTH, { message: `Der Grund darf höchstens ${MAX_NOTE_LENGTH} Zeichen lang sein.` }),
});

export const previewSettlementSchema = z.object({ sessionId });

/** Minimum length of the mandatory comment for a session with a discrepancy. */
export const MIN_NOTE_LENGTH = 3;

/**
 * Manual settlement override (docs/ARBEITSPAKETE.md WP11, docs/SPEC.md §6.1).
 *
 * This is the one write path where the client *does* send the numbers: an admin
 * hand-edited the settlement in the preview. The schema only checks the shape
 * and integer cents; the freedom of the amounts is intended. Basic integrity and
 * authorisation are enforced by `verifyManual` and, decisively, by the RPC
 * `close_session_manual`. The `note` (Begründung) is mandatory here.
 */
const centsInt = z.number().int({ message: 'Beträge müssen ganze Cent sein.' });

const manualLineSchema = z.object({
  playerId: z.uuid({ message: 'Ungültiger Spieler.' }),
  cashIn: centsInt,
  creditIn: centsInt,
  stack: centsInt,
  payout: centsInt,
  isCashPlayer: z.boolean(),
  claim: centsInt,
  cashTier1: centsInt,
  cashTier2: centsInt,
  cashTier3: centsInt,
  cashFromBox: centsInt,
  netResult: centsInt,
  residual: centsInt,
});

const manualTransferSchema = z.object({
  fromPlayerId: z.uuid({ message: 'Ungültiger Spieler.' }),
  toPlayerId: z.uuid({ message: 'Ungültiger Spieler.' }),
  amount: centsInt,
});

const manualSettlementSchema = z.object({
  algorithmVersion: z.number().int(),
  totalBuyIn: centsInt,
  totalStack: centsInt,
  discrepancy: centsInt,
  cashBoxStart: centsInt,
  cashBoxAfterPayouts: centsInt,
  unallocatedCash: centsInt,
  uncoveredClaims: centsInt,
  uncoveredDebts: centsInt,
  lines: z.array(manualLineSchema).min(1, { message: 'Die Abrechnung hat keine Zeilen.' }),
  transfers: z.array(manualTransferSchema),
  // The client always sends `true`; anything else is coerced away below.
  isManual: z.boolean().optional(),
});

export const closeSessionManualSchema = z.object({
  sessionId,
  /** Mandatory justification of the override (SPEC §6.1). */
  note: z
    .string()
    .trim()
    .min(MIN_NOTE_LENGTH, {
      message: `Bitte begründe die manuelle Abrechnung (mindestens ${MIN_NOTE_LENGTH} Zeichen).`,
    })
    .max(MAX_NOTE_LENGTH, { message: noteTooLong }),
  settlement: manualSettlementSchema,
});

export type CloseSessionInput = z.input<typeof closeSessionSchema>;
export type ReopenSessionInput = z.input<typeof reopenSessionSchema>;
export type CloseSessionManualInput = z.input<typeof closeSessionManualSchema>;
export type ManualSettlementInput = z.infer<typeof manualSettlementSchema>;
