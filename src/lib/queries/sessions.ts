import { createClient } from '@/lib/supabase/server';
import type { Enums } from '@/lib/database.types';

/**
 * Read queries for sessions (docs/ARBEITSPAKETE.md WP4, step 3). Server only —
 * `createClient` reads request cookies via `next/headers`, so these can only be
 * called from server components/actions, and every read runs through the server
 * Supabase client so RLS applies as the logged-in user.
 */

export type SessionListItem = {
  id: string;
  playedOn: string;
  name: string | null;
  status: Enums<'session_status'>;
  participantCount: number;
  totalBuyInCents: number;
};

/**
 * All sessions for the start page, newest first.
 *
 * One query against the `session_overview` view (0006), which aggregates
 * participant count and buy-in total in the database — no N+1 follow-up per
 * session.
 */
export async function listSessions(): Promise<SessionListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('session_overview')
    .select('id, played_on, name, status, participant_count, total_buy_in_cents, created_at')
    .order('played_on', { ascending: false })
    .order('created_at', { ascending: false });

  if (error !== null) {
    console.error('[queries] listSessions:', error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    playedOn: row.played_on,
    name: row.name,
    status: row.status,
    participantCount: row.participant_count,
    totalBuyInCents: row.total_buy_in_cents,
  }));
}

// The header-only reader of WP4 was replaced in WP5 by
// `src/lib/queries/sessionDetail.ts`, which loads the whole detail screen and
// distinguishes „not found“ from „could not be loaded“ (Gaby WP4, F1/F2).
