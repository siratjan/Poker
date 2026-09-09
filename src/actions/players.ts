'use server';

import { revalidatePath } from 'next/cache';
import type { PostgrestError } from '@supabase/supabase-js';
import { actionResult, AppError, type ActionResult } from '@/lib/actions/result';
import { requireEditor } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';
import { createPlayerSchema, renamePlayerSchema } from '@/lib/validation/player';
import { parseInput } from '@/lib/validation/parse';

/**
 * Server actions for players (docs/ARBEITSPAKETE.md WP4, step 2).
 *
 * Every action guards the role first (`requireEditor`) — politeness on top of
 * RLS, which is the real boundary (CLAUDE.md). Writes go through the server
 * Supabase client, so RLS runs as the logged-in user.
 *
 * Duplicate names (case- and whitespace-insensitive: „ ali “ vs „Ali“) are
 * caught by the unique index on `name_normalized = lower(trim(name))` from
 * 0001; its `23505` becomes `PLAYER_EXISTS`.
 */

const PLAYER_EXISTS = 'Diesen Spieler gibt es schon.';
const PLAYER_NOT_FOUND = 'Diesen Spieler gibt es nicht (mehr).';

export async function createPlayer(input: unknown): Promise<ActionResult<{ id: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { name } = parseInput(createPlayerSchema, input);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('players')
      .insert({ name })
      .select('id')
      .single();

    if (error !== null) throw mapPlayerError(error, 'anlegen');
    revalidatePath('/players');
    return { id: data.id };
  });
}

export async function renamePlayer(input: unknown): Promise<ActionResult<{ id: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { id, name } = parseInput(renamePlayerSchema, input);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('players')
      .update({ name })
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error !== null) throw mapPlayerError(error, 'umbenennen');
    if (data === null) throw new AppError('PLAYER_NOT_FOUND', PLAYER_NOT_FOUND);

    revalidatePath('/players');
    return { id: data.id };
  });
}

/** Maps a Postgres error to a readable German one, or rethrows for the generic handler. */
function mapPlayerError(error: PostgrestError, verb: string): AppError {
  if (error.code === '23505') return new AppError('PLAYER_EXISTS', PLAYER_EXISTS);
  // Unknown: let actionResult log it and answer generically (never leak SQL).
  console.error(`[players] ${verb}:`, error);
  throw new Error(error.message);
}
