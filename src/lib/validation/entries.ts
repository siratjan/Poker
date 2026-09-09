import { z } from 'zod';
import { formatCents } from '@/lib/money';

/**
 * Validation for the entry server actions (src/actions/entries.ts).
 *
 * Money is always integer cents (CLAUDE.md): the UI parses the typed euro
 * string with `parseEuroInput` and sends the resulting integer, so a float or a
 * string never reaches an action. The upper bound is a typo guard
 * (docs/ARBEITSPAKETE.md WP5 Testauftrag): 1.000.000 cents = 10.000,00 €.
 */

/** Typo guard for every amount, in cents. */
export const MAX_AMOUNT_CENTS = 1_000_000;

const TOO_LARGE = `Der Betrag ist zu groß (höchstens ${formatCents(MAX_AMOUNT_CENTS)}).`;
const NOT_A_NUMBER = 'Bitte einen gültigen Betrag eingeben.';

const sessionId = z.uuid({ message: 'Ungültige Session.' });
const playerId = z.uuid({ message: 'Ungültiger Spieler.' });

/** Buy-in / payout: a positive integer amount of cents. */
const positiveAmount = z
  .number({ message: NOT_A_NUMBER })
  .int({ message: NOT_A_NUMBER })
  .positive({ message: 'Der Betrag muss größer als 0 sein.' })
  .max(MAX_AMOUNT_CENTS, { message: TOO_LARGE });

/** Cash-out: 0 is a valid end stack (busted player). */
const stackAmount = z
  .number({ message: NOT_A_NUMBER })
  .int({ message: NOT_A_NUMBER })
  .min(0, { message: 'Der Stack darf nicht negativ sein.' })
  .max(MAX_AMOUNT_CENTS, { message: TOO_LARGE });

const paymentSchema = z.enum(['cash', 'credit'], {
  message: 'Bitte „Bar“ oder „Liste“ wählen.',
});

/** Same bounds as `players.name` (0001) and the WP4 player schema. */
const playerNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'Bitte einen Namen eingeben.' })
  .max(40, { message: 'Der Name darf höchstens 40 Zeichen lang sein.' });

export const addParticipantSchema = z.object({ sessionId, playerId });

export const addParticipantByNewPlayerSchema = z.object({
  sessionId,
  name: playerNameSchema,
});

export const removeParticipantSchema = z.object({ sessionId, playerId });

export const addBuyInSchema = z.object({
  sessionId,
  playerId,
  amountCents: positiveAmount,
  payment: paymentSchema,
});

export const addCashOutSchema = z.object({
  sessionId,
  playerId,
  amountCents: stackAmount,
});

export const updateCashOutSchema = z.object({
  id: z.uuid({ message: 'Ungültiger Eintrag.' }),
  sessionId,
  amountCents: stackAmount,
});

export const addPayoutSchema = z.object({
  sessionId,
  playerId,
  amountCents: positiveAmount,
});

export const deleteEntrySchema = z.object({
  id: z.uuid({ message: 'Ungültiger Eintrag.' }),
  sessionId,
});

export type AddBuyInInput = z.input<typeof addBuyInSchema>;
export type AddCashOutInput = z.input<typeof addCashOutSchema>;
export type AddPayoutInput = z.input<typeof addPayoutSchema>;
