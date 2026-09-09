import { z } from 'zod';
import { isValidCalendarDate, maxPlayedOn } from '@/lib/time';

/**
 * Validation for the session server actions (src/actions/sessions.ts).
 *
 * Kept out of the `'use server'` file on purpose: a module marked `'use server'`
 * may only export async functions, so the schemas — which the tests exercise
 * directly — live here. Messages are German, ready for the UI.
 *
 * `played_on` limits (docs/ARBEITSPAKETE.md WP4 Testauftrag): a real calendar
 * date, at most today + 1 day in Europe/Berlin. `name` is optional, trimmed and
 * at most 60 characters (matches the `length(name) <= 60` check of 0001); an
 * empty name becomes `null`.
 */

const DATE_HINT = 'Bitte ein gültiges Datum wählen.';

/** Optional, trimmed session name; empty string collapses to `null`. */
const sessionNameSchema = z
  .string()
  .trim()
  .max(60, { message: 'Der Name darf höchstens 60 Zeichen lang sein.' })
  .optional()
  .transform((value) => (value === undefined || value.length === 0 ? null : value));

const playedOnSchema = z
  .string()
  .refine(isValidCalendarDate, { message: DATE_HINT })
  .refine((value) => value <= maxPlayedOn(), {
    message: 'Das Datum darf höchstens einen Tag in der Zukunft liegen.',
  });

export const createSessionSchema = z.object({
  playedOn: playedOnSchema,
  name: sessionNameSchema,
});

export const updateSessionMetaSchema = z.object({
  id: z.uuid({ message: 'Ungültige Session.' }),
  playedOn: playedOnSchema,
  name: sessionNameSchema,
});

export const sessionIdSchema = z.uuid({ message: 'Ungültige Session.' });

export type CreateSessionInput = z.input<typeof createSessionSchema>;
export type UpdateSessionMetaInput = z.input<typeof updateSessionMetaSchema>;
