'use server';

import { revalidatePath } from 'next/cache';
import type { PostgrestError } from '@supabase/supabase-js';
import { actionResult, AppError, type ActionResult } from '@/lib/actions/result';
import { requireEditor } from '@/lib/auth/requireRole';
import { translateDbError } from '@/lib/errors/de';
import { createClient } from '@/lib/supabase/server';
import { parseInput } from '@/lib/validation/parse';
import {
  addBuyInSchema,
  addCashOutSchema,
  addParticipantByNewPlayerSchema,
  addParticipantSchema,
  addPayoutSchema,
  deleteEntrySchema,
  removeParticipantSchema,
  updateCashOutSchema,
} from '@/lib/validation/entries';

/**
 * Server actions of the session detail screen (docs/ARBEITSPAKETE.md WP5,
 * step 1): participants, buy-ins, cash-outs, payouts.
 *
 * Every action guards the role first (`requireEditor`), then validates with
 * zod, then writes through the server Supabase client. The real boundary is the
 * database: RLS (0003) and the `validate_entry` / `validate_session_player_*`
 * triggers (0002) decide, this layer only turns their codes into German
 * sentences (`src/lib/errors/de.ts`) — a raw Postgres text never reaches the
 * browser.
 */

const PLAYER_ALREADY_IN_SESSION = 'Dieser Spieler ist schon dabei.';
const PLAYER_EXISTS = 'Diesen Spieler gibt es schon.';
const ENTRY_NOT_FOUND = 'Diesen Eintrag gibt es nicht (mehr).';
const PARTICIPANT_NOT_FOUND = 'Dieser Spieler ist kein Teilnehmer dieser Session.';
const NOT_A_CASH_OUT = 'Dieser Eintrag ist kein Stack.';

/** How often a position collision (two devices adding at once) is retried. */
const POSITION_RETRIES = 3;

export async function addParticipant(input: unknown): Promise<ActionResult<{ playerId: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { sessionId, playerId } = parseInput(addParticipantSchema, input);

    await insertParticipant(sessionId, playerId);
    revalidateSession(sessionId);
    return { playerId };
  });
}

/** Creates a player and adds him to the session in one step. */
export async function addParticipantByNewPlayer(
  input: unknown,
): Promise<ActionResult<{ playerId: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { sessionId, name } = parseInput(addParticipantByNewPlayerSchema, input);

    const supabase = await createClient();
    const { data, error } = await supabase.from('players').insert({ name }).select('id').single();

    if (error !== null) {
      if (error.code === '23505') throw new AppError('PLAYER_EXISTS', PLAYER_EXISTS);
      throw mapDbError(error, 'Spieler anlegen');
    }

    // The player exists now even if the join fails below; that is intentional —
    // a created player is not garbage, he can be added again with one tap.
    await insertParticipant(sessionId, data.id);
    revalidatePath('/players');
    revalidateSession(sessionId);
    return { playerId: data.id };
  });
}

export async function removeParticipant(input: unknown): Promise<ActionResult<{ playerId: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { sessionId, playerId } = parseInput(removeParticipantSchema, input);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('session_players')
      .delete()
      .eq('session_id', sessionId)
      .eq('player_id', playerId)
      .select('player_id');

    if (error !== null) throw mapDbError(error, 'Teilnehmer entfernen');
    // The delete policy filters a row it does not allow instead of erroring.
    if (data.length === 0) throw new AppError('PARTICIPANT_NOT_FOUND', PARTICIPANT_NOT_FOUND);

    revalidateSession(sessionId);
    return { playerId };
  });
}

export async function addBuyIn(input: unknown): Promise<ActionResult<{ id: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { sessionId, playerId, amountCents, payment } = parseInput(addBuyInSchema, input);

    return insertEntry(sessionId, {
      session_id: sessionId,
      player_id: playerId,
      type: 'buy_in',
      amount_cents: amountCents,
      payment,
    });
  });
}

export async function addCashOut(input: unknown): Promise<ActionResult<{ id: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { sessionId, playerId, amountCents } = parseInput(addCashOutSchema, input);

    return insertEntry(sessionId, {
      session_id: sessionId,
      player_id: playerId,
      type: 'cash_out',
      amount_cents: amountCents,
      payment: null,
    });
  });
}

/**
 * Changes an existing end stack. Only the amount is touched: session, player
 * and type are the identity of the entry and the trigger rejects re-pointing it
 * (`ENTRY_IMMUTABLE_KEYS`). `type = 'cash_out'` is part of the filter so a
 * wrong id can never turn a buy-in into a stack.
 */
export async function updateCashOut(input: unknown): Promise<ActionResult<{ id: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { id, sessionId, amountCents } = parseInput(updateCashOutSchema, input);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('entries')
      .update({ amount_cents: amountCents })
      .eq('id', id)
      .eq('session_id', sessionId)
      .eq('type', 'cash_out')
      .select('id')
      .maybeSingle();

    if (error !== null) throw mapDbError(error, 'Stack ändern');
    if (data === null) throw new AppError('ENTRY_NOT_FOUND', NOT_A_CASH_OUT);

    revalidateSession(sessionId);
    return { id: data.id };
  });
}

export async function addPayout(input: unknown): Promise<ActionResult<{ id: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { sessionId, playerId, amountCents } = parseInput(addPayoutSchema, input);

    return insertEntry(sessionId, {
      session_id: sessionId,
      player_id: playerId,
      type: 'payout',
      amount_cents: amountCents,
      payment: null,
    });
  });
}

/**
 * Deletes one entry. `session_id` is part of the filter so the action can only
 * ever touch the session the user is looking at; the trigger still decides
 * whether the deletion is allowed (`CASH_OUT_HAS_PAYOUT`, `SESSION_CLOSED`).
 */
export async function deleteEntry(input: unknown): Promise<ActionResult<{ id: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { id, sessionId } = parseInput(deleteEntrySchema, input);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('entries')
      .delete()
      .eq('id', id)
      .eq('session_id', sessionId)
      .select('id');

    if (error !== null) throw mapDbError(error, 'Eintrag löschen');
    if (data.length === 0) throw new AppError('ENTRY_NOT_FOUND', ENTRY_NOT_FOUND);

    revalidateSession(sessionId);
    return { id };
  });
}

type EntryInsert = {
  session_id: string;
  player_id: string;
  type: 'buy_in' | 'cash_out' | 'payout';
  amount_cents: number;
  payment: 'cash' | 'credit' | null;
};

async function insertEntry(sessionId: string, row: EntryInsert): Promise<{ id: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('entries').insert(row).select('id').single();

  if (error !== null) throw mapDbError(error, `Eintrag (${row.type})`);

  revalidateSession(sessionId);
  return { id: data.id };
}

/**
 * Adds a player to `session_players`. `position` is the join order and has no
 * default in the schema (0001), so it is computed here as „highest so far + 1“.
 * Two devices adding a player at the same moment collide on
 * `unique (session_id, position)`; that is retried, whereas a collision on the
 * primary key means the player is simply already at the table.
 */
async function insertParticipant(sessionId: string, playerId: string): Promise<void> {
  const supabase = await createClient();

  for (let attempt = 0; attempt < POSITION_RETRIES; attempt += 1) {
    const { data: last, error: readError } = await supabase
      .from('session_players')
      .select('position')
      .eq('session_id', sessionId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (readError !== null) throw mapDbError(readError, 'Teilnehmer lesen');

    const { error } = await supabase
      .from('session_players')
      .insert({ session_id: sessionId, player_id: playerId, position: (last?.position ?? 0) + 1 });

    if (error === null) return;

    if (error.code === '23505') {
      if (isPositionConflict(error)) continue; // someone else took the number
      throw new AppError('PLAYER_ALREADY_IN_SESSION', PLAYER_ALREADY_IN_SESSION);
    }
    throw mapDbError(error, 'Teilnehmer hinzufügen');
  }

  throw new AppError(
    'POSITION_CONFLICT',
    'Es wurde gerade gleichzeitig gespeichert. Bitte noch einmal versuchen.',
  );
}

/** `unique (session_id, position)` vs. the primary key `(session_id, player_id)`. */
function isPositionConflict(error: PostgrestError): boolean {
  return `${error.message} ${error.details ?? ''}`.includes('position');
}

/**
 * German message for a database error, or a rethrow for the generic handler in
 * `actionResult` (which logs it and answers with `UNEXPECTED`).
 */
function mapDbError(error: PostgrestError, context: string): AppError {
  const translated = translateDbError(error);
  if (translated !== null) return translated;

  console.error(`[entries] ${context}:`, error);
  throw new Error(error.message);
}

function revalidateSession(sessionId: string): void {
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath('/');
}
