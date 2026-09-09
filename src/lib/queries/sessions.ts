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

export type SessionHeader = {
  id: string;
  playedOn: string;
  name: string | null;
  status: Enums<'session_status'>;
  closedAt: string | null;
};

/** The header of one session (WP4 detail page is header-only; WP5 fills it). */
export async function getSessionHeader(id: string): Promise<SessionHeader | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sessions')
    .select('id, played_on, name, status, closed_at')
    .eq('id', id)
    .maybeSingle();

  if (error !== null) {
    console.error('[queries] getSessionHeader:', error.message);
    return null;
  }
  if (data === null) return null;

  return {
    id: data.id,
    playedOn: data.played_on,
    name: data.name,
    status: data.status,
    closedAt: data.closed_at,
  };
}
