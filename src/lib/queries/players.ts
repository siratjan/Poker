import { createClient } from '@/lib/supabase/server';

/**
 * Read queries for players (docs/ARBEITSPAKETE.md WP4, step 6). Server only —
 * `createClient` reads request cookies via `next/headers`; RLS applies as the
 * logged-in user.
 */

export type PlayerListItem = {
  id: string;
  name: string;
};

/** All players, alphabetically (case-insensitive via `name_normalized`). */
export async function listPlayers(): Promise<PlayerListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('players')
    .select('id, name, name_normalized')
    .order('name_normalized', { ascending: true });

  if (error !== null) {
    console.error('[queries] listPlayers:', error.message);
    return [];
  }

  return (data ?? []).map((row) => ({ id: row.id, name: row.name }));
}
