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

export type CloseSessionInput = z.input<typeof closeSessionSchema>;
export type ReopenSessionInput = z.input<typeof reopenSessionSchema>;
