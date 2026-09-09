import { createClient } from '@/lib/supabase/server';
import type { Enums } from '@/lib/database.types';
import type { QueryResult } from '@/lib/queries/result';

/**
 * Read queries for players (docs/ARBEITSPAKETE.md WP4 step 6, WP7 steps 2/3).
 * Server only — `createClient` reads request cookies via `next/headers`; RLS
 * applies as the logged-in user.
 *
 * Every query returns a {@link QueryResult}: a failed query is reported as
 * `{ ok: false }` and never as an empty list (Gaby WP5, F6).
 *
 * Each function issues a fixed number of queries, never one per row.
 */

export type PlayerListItem = {
  id: string;
  name: string;
};

/** One row of the player overview — the totals over all closed evenings. */
export type PlayerStats = {
  id: string;
  name: string;
  /** Number of closed sessions the player has a settlement line in. */
  sessionsPlayed: number;
  totalBuyInCents: number;
  totalStackCents: number;
  /** `totalStack - totalBuyIn` over all closed sessions. */
  netCents: number;
  /** Newest `played_on` of any session (open or closed); `null` if none. */
  lastPlayedOn: string | null;
  /** Running sessions the player takes part in — shown as „läuft“. */
  openSessions: number;
};

/** One evening of a player on the detail page. */
export type PlayerSessionRow = {
  sessionId: string;
  playedOn: string;
  sessionName: string | null;
  status: Enums<'session_status'>;
  cashInCents: number;
  creditInCents: number;
  /** `null` while the player has no `cash_out` yet. */
  stackCents: number | null;
  /**
   * The player's result of that evening, `null` while the session is open —
   * a running evening has no result yet (SPEC §5).
   */
  netCents: number | null;
};

export type PlayerDetail = {
  stats: PlayerStats;
  /** Newest evening first. */
  sessions: PlayerSessionRow[];
};

/** All players, alphabetically (case-insensitive via `name_normalized`). */
export async function listPlayers(): Promise<QueryResult<PlayerListItem[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('players')
    .select('id, name, name_normalized')
    .order('name_normalized', { ascending: true });

  if (error !== null) {
    console.error('[queries] listPlayers:', error.message);
    return { ok: false, reason: 'error' };
  }

  return { ok: true, data: (data ?? []).map((row) => ({ id: row.id, name: row.name })) };
}

/**
 * All players with their totals, from the `player_stats` view (0007) — one
 * query, no per-player follow-up. The screen sorts and filters client-side
 * (`src/lib/players/stats.ts`); the alphabetical order here is only the stable
 * starting point.
 */
export async function listPlayerStats(): Promise<QueryResult<PlayerStats[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('player_stats')
    .select(
      'player_id, name, name_normalized, sessions_played, total_buy_in_cents, total_stack_cents, net_cents, last_played_on, open_sessions',
    )
    .order('name_normalized', { ascending: true });

  if (error !== null) {
    console.error('[queries] listPlayerStats:', error.message);
    return { ok: false, reason: 'error' };
  }

  return { ok: true, data: (data ?? []).map(toStats) };
}

/**
 * One player with his evenings (docs/ARBEITSPAKETE.md WP7, step 3).
 *
 * Five queries, independent of the number of sessions:
 *  1. `player_stats` — name and totals, and the „does this player exist“ check.
 *  2. `session_players` — the sessions he took part in.
 *  3. `sessions` — date, name and status of exactly those sessions.
 *  4. `settlement_lines` — the frozen numbers of the closed ones.
 *  5. `entries` — the live numbers of the open ones only.
 *
 * A closed session is read from its settlement line and never recomputed
 * (CLAUDE.md); only a running session is derived from `entries`.
 */
export async function getPlayerDetail(id: string): Promise<QueryResult<PlayerDetail>> {
  const supabase = await createClient();

  const statsResult = await supabase
    .from('player_stats')
    .select(
      'player_id, name, name_normalized, sessions_played, total_buy_in_cents, total_stack_cents, net_cents, last_played_on, open_sessions',
    )
    .eq('player_id', id)
    .maybeSingle();

  if (statsResult.error !== null) {
    console.error('[queries] getPlayerDetail (stats):', statsResult.error.message);
    return { ok: false, reason: 'error' };
  }
  if (statsResult.data === null) return { ok: false, reason: 'not_found' };

  const participationResult = await supabase
    .from('session_players')
    .select('session_id')
    .eq('player_id', id);

  if (participationResult.error !== null) {
    console.error('[queries] getPlayerDetail (participation):', participationResult.error.message);
    return { ok: false, reason: 'error' };
  }

  const sessionIds = (participationResult.data ?? []).map((row) => row.session_id);
  if (sessionIds.length === 0) {
    return { ok: true, data: { stats: toStats(statsResult.data), sessions: [] } };
  }

  const [sessionsResult, linesResult] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, played_on, name, status, created_at')
      .in('id', sessionIds)
      .order('played_on', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('settlement_lines')
      .select('session_id, cash_in_cents, credit_in_cents, stack_cents, net_result_cents')
      .eq('player_id', id),
  ]);

  if (sessionsResult.error !== null) {
    console.error('[queries] getPlayerDetail (sessions):', sessionsResult.error.message);
    return { ok: false, reason: 'error' };
  }
  if (linesResult.error !== null) {
    console.error('[queries] getPlayerDetail (settlement lines):', linesResult.error.message);
    return { ok: false, reason: 'error' };
  }

  const sessionRows = sessionsResult.data ?? [];
  const lines = new Map((linesResult.data ?? []).map((row) => [row.session_id, row]));

  // Buy-ins and stack of the running evenings — the only ones without a frozen
  // settlement line.
  const openIds = sessionRows.filter((row) => row.status === 'open').map((row) => row.id);
  const live = new Map<string, { cashIn: number; creditIn: number; stack: number | null }>();

  if (openIds.length > 0) {
    const entriesResult = await supabase
      .from('entries')
      .select('session_id, type, amount_cents, payment')
      .eq('player_id', id)
      .in('session_id', openIds);

    if (entriesResult.error !== null) {
      console.error('[queries] getPlayerDetail (entries):', entriesResult.error.message);
      return { ok: false, reason: 'error' };
    }

    for (const entry of entriesResult.data ?? []) {
      const current = live.get(entry.session_id) ?? { cashIn: 0, creditIn: 0, stack: null };
      if (entry.type === 'buy_in') {
        if (entry.payment === 'credit') current.creditIn += entry.amount_cents;
        else current.cashIn += entry.amount_cents;
      } else if (entry.type === 'cash_out') {
        current.stack = entry.amount_cents;
      }
      // `payout` is cash already taken out of the box, not a buy-in and not a
      // stack — it does not change what the evening cost the player.
      live.set(entry.session_id, current);
    }
  }

  const sessions: PlayerSessionRow[] = sessionRows.map((row) => {
    const line = lines.get(row.id);
    if (row.status === 'closed' && line !== undefined) {
      return {
        sessionId: row.id,
        playedOn: row.played_on,
        sessionName: row.name,
        status: row.status,
        cashInCents: line.cash_in_cents,
        creditInCents: line.credit_in_cents,
        stackCents: line.stack_cents,
        netCents: line.net_result_cents,
      };
    }

    const derived = live.get(row.id) ?? { cashIn: 0, creditIn: 0, stack: null };
    return {
      sessionId: row.id,
      playedOn: row.played_on,
      sessionName: row.name,
      status: row.status,
      cashInCents: derived.cashIn,
      creditInCents: derived.creditIn,
      stackCents: derived.stack,
      // No result while the evening runs — and none either for the (impossible
      // in practice) closed session whose settlement line is missing.
      netCents: null,
    };
  });

  return { ok: true, data: { stats: toStats(statsResult.data), sessions } };
}

type StatsRow = {
  player_id: string;
  name: string;
  sessions_played: number;
  total_buy_in_cents: number;
  total_stack_cents: number;
  net_cents: number;
  last_played_on: string | null;
  open_sessions: number;
};

function toStats(row: StatsRow): PlayerStats {
  return {
    id: row.player_id,
    name: row.name,
    sessionsPlayed: row.sessions_played,
    totalBuyInCents: row.total_buy_in_cents,
    totalStackCents: row.total_stack_cents,
    netCents: row.net_cents,
    lastPlayedOn: row.last_played_on,
    openSessions: row.open_sessions,
  };
}
