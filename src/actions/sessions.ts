'use server';

import { revalidatePath } from 'next/cache';
import type { PostgrestError } from '@supabase/supabase-js';
import { actionResult, AppError, type ActionResult } from '@/lib/actions/result';
import { requireAdmin, requireEditor } from '@/lib/auth/requireRole';
import { createClient } from '@/lib/supabase/server';
import {
  createSessionSchema,
  sessionIdSchema,
  updateSessionMetaSchema,
} from '@/lib/validation/session';
import { parseInput } from '@/lib/validation/parse';

/**
 * Server actions for sessions (docs/ARBEITSPAKETE.md WP4, step 1).
 *
 * Roles are guarded first (`requireEditor` / `requireAdmin`), then the input is
 * zod-validated, then the write goes through the server client so RLS and the
 * DB triggers apply. `revalidatePath` refreshes the affected server components.
 */

const SESSION_CLOSED = 'Diese Session ist abgeschlossen und kann nicht mehr geändert werden.';
const CANNOT_DELETE =
  'Diese Session kann nicht gelöscht werden. Nur offene Sessions ohne Abrechnung sind löschbar.';

export async function createSession(input: unknown): Promise<ActionResult<{ id: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { playedOn, name } = parseInput(createSessionSchema, input);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('sessions')
      .insert({ played_on: playedOn, name })
      .select('id')
      .single();

    if (error !== null) throw mapSessionError(error, 'anlegen');
    revalidatePath('/');
    return { id: data.id };
  });
}

export async function updateSessionMeta(input: unknown): Promise<ActionResult<{ id: string }>> {
  return actionResult(async () => {
    await requireEditor();
    const { id, playedOn, name } = parseInput(updateSessionMetaSchema, input);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('sessions')
      .update({ played_on: playedOn, name })
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error !== null) throw mapSessionError(error, 'ändern');
    if (data === null) throw new AppError('SESSION_NOT_FOUND', 'Diese Session gibt es nicht (mehr).');

    revalidatePath('/');
    revalidatePath(`/sessions/${id}`);
    return { id: data.id };
  });
}

export async function deleteOpenSession(input: unknown): Promise<ActionResult<{ id: string }>> {
  return actionResult(async () => {
    await requireAdmin();
    const id = parseInput(sessionIdSchema, input);

    const supabase = await createClient();
    // The delete policy (0003) already restricts this to admins deleting an
    // open session without a settlement. A blocked row is filtered out rather
    // than erroring, so an empty result means "not deletable".
    const { data, error } = await supabase
      .from('sessions')
      .delete()
      .eq('id', id)
      .select('id');

    if (error !== null) throw mapSessionError(error, 'löschen');
    if (data.length === 0) throw new AppError('CANNOT_DELETE_SESSION', CANNOT_DELETE);

    revalidatePath('/');
    return { id };
  });
}

/**
 * Maps a Postgres/trigger error to a readable German one, or rethrows for the
 * generic handler. The full trigger-code table lands in WP5 (src/lib/errors);
 * WP4 only touches the codes these three actions can produce.
 */
function mapSessionError(error: PostgrestError, verb: string): AppError {
  if (error.message === 'SESSION_CLOSED') return new AppError('SESSION_CLOSED', SESSION_CLOSED);
  console.error(`[sessions] ${verb}:`, error);
  throw new Error(error.message);
}
