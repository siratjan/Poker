import { z } from 'zod';

/**
 * Validation for the player server actions (src/actions/players.ts).
 *
 * The name is trimmed and must be 1..40 characters — the same bound as the
 * `length(trim(name)) between 1 and 40` check of 0001, so a value that passes
 * here never trips the database constraint. Duplicate detection (case- and
 * whitespace-insensitive) is the unique index on `name_normalized`; the action
 * maps its `23505` to `PLAYER_EXISTS`.
 */

const playerNameSchema = z
  .string()
  .trim()
  .min(1, { message: 'Bitte einen Namen eingeben.' })
  .max(40, { message: 'Der Name darf höchstens 40 Zeichen lang sein.' });

export const createPlayerSchema = z.object({
  name: playerNameSchema,
});

export const renamePlayerSchema = z.object({
  id: z.uuid({ message: 'Ungültiger Spieler.' }),
  name: playerNameSchema,
});

export type CreatePlayerInput = z.input<typeof createPlayerSchema>;
export type RenamePlayerInput = z.input<typeof renamePlayerSchema>;
