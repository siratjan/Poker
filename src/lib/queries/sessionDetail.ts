import { createClient } from '@/lib/supabase/server';
import type { Enums, Json } from '@/lib/database.types';
import type { SessionEntry, SessionParticipant } from '@/lib/session/derive';

/**
 * Read query for the session detail screen (docs/ARBEITSPAKETE.md WP5, step 2).
 * Server only — `createClient` reads request cookies, so RLS applies as the
 * logged-in user.
 *
 * A fixed number of queries (session, participants, players, entries, authors,
 * settlement flag, settings), never one per row: the participant and author
 * names are fetched with a single `in (...)` each.
 *
 * A failing query is reported as `{ ok: false, reason: 'error' }` instead of an
 * empty list (Gaby WP4, F1): „nothing there“ and „could not load“ must not look
 * the same on screen.
 */

export type QueryFailure = 'not_found' | 'error';

export type QueryResult<T> = { ok: true; data: T } | { ok: false; reason: QueryFailure };

export type SessionDetailHeader = {
  id: string;
  playedOn: string;
  name: string | null;
  status: Enums<'session_status'>;
  closedAt: string | null;
  closedByName: string | null;
  discrepancyCents: number | null;
  closeNote: string | null;
};

export type SessionDetail = {
  session: SessionDetailHeader;
  participants: SessionParticipant[];
  entries: SessionEntry[];
  /** A frozen settlement exists; WP6 renders it. */
  hasSettlement: boolean;
  /** Quick buy-in amounts from `settings`, in cents. */
  quickAmountsCents: number[];
};

/** Fallback of SPEC §4 when `settings` cannot be read: 50 / 100 / 200 €. */
export const DEFAULT_QUICK_AMOUNTS_CENTS = [5000, 10000, 20000];

export async function getSessionDetail(id: string): Promise<QueryResult<SessionDetail>> {
  const supabase = await createClient();

  const sessionResult = await supabase
    .from('sessions')
    .select('id, played_on, name, status, closed_at, closed_by, discrepancy_cents, close_note')
    .eq('id', id)
    .maybeSingle();

  if (sessionResult.error !== null) {
    console.error('[queries] getSessionDetail (session):', sessionResult.error.message);
    return { ok: false, reason: 'error' };
  }
  const sessionRow = sessionResult.data;
  if (sessionRow === null) return { ok: false, reason: 'not_found' };

  const [participantsResult, entriesResult, settlementResult, settingsResult] = await Promise.all([
    supabase
      .from('session_players')
      .select('player_id, position')
      .eq('session_id', id)
      .order('position', { ascending: true }),
    supabase
      .from('entries')
      .select('id, player_id, type, amount_cents, payment, created_at, created_by')
      .eq('session_id', id)
      .order('created_at', { ascending: true }),
    supabase.from('settlements').select('session_id').eq('session_id', id).maybeSingle(),
    supabase.from('settings').select('key, value').eq('key', 'quick_amounts_cents').maybeSingle(),
  ]);

  if (participantsResult.error !== null) {
    console.error('[queries] getSessionDetail (participants):', participantsResult.error.message);
    return { ok: false, reason: 'error' };
  }
  if (entriesResult.error !== null) {
    console.error('[queries] getSessionDetail (entries):', entriesResult.error.message);
    return { ok: false, reason: 'error' };
  }
  if (settlementResult.error !== null) {
    console.error('[queries] getSessionDetail (settlement):', settlementResult.error.message);
    return { ok: false, reason: 'error' };
  }

  const participantRows = participantsResult.data ?? [];
  const entryRows = entriesResult.data ?? [];

  const playerNames = await namesByPlayerId(
    supabase,
    participantRows.map((row) => row.player_id),
  );
  if (playerNames === null) return { ok: false, reason: 'error' };

  // One lookup for every user name the screen needs: the authors of the
  // entries plus, for a closed session, whoever closed it.
  const authorIds = [
    ...new Set(
      [...entryRows.map((row) => row.created_by), sessionRow.closed_by].filter(
        (value): value is string => typeof value === 'string',
      ),
    ),
  ];
  const authorNames = await namesByUserId(supabase, authorIds);

  const participants: SessionParticipant[] = participantRows.map((row) => ({
    playerId: row.player_id,
    name: playerNames.get(row.player_id) ?? 'Unbekannt',
    position: row.position,
  }));

  const entries: SessionEntry[] = entryRows.map((row) => ({
    id: row.id,
    playerId: row.player_id,
    type: row.type,
    amountCents: row.amount_cents,
    payment: row.payment,
    createdAt: row.created_at,
    createdByName: row.created_by === null ? null : (authorNames.get(row.created_by) ?? null),
  }));

  // Settings are decoration (quick amounts): a failure falls back to the SPEC
  // defaults instead of blocking the whole screen.
  if (settingsResult.error !== null) {
    console.error('[queries] getSessionDetail (settings):', settingsResult.error.message);
  }

  return {
    ok: true,
    data: {
      session: {
        id: sessionRow.id,
        playedOn: sessionRow.played_on,
        name: sessionRow.name,
        status: sessionRow.status,
        closedAt: sessionRow.closed_at,
        closedByName:
          sessionRow.closed_by === null ? null : (authorNames.get(sessionRow.closed_by) ?? null),
        discrepancyCents: sessionRow.discrepancy_cents,
        closeNote: sessionRow.close_note,
      },
      participants,
      entries,
      hasSettlement: settlementResult.data !== null,
      quickAmountsCents: parseQuickAmounts(settingsResult.data?.value ?? null),
    },
  };
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Player names for the participant cards; `null` signals a failed query. */
async function namesByPlayerId(
  supabase: ServerClient,
  playerIds: readonly string[],
): Promise<Map<string, string> | null> {
  if (playerIds.length === 0) return new Map();

  const { data, error } = await supabase.from('players').select('id, name').in('id', [...playerIds]);
  if (error !== null) {
    console.error('[queries] getSessionDetail (players):', error.message);
    return null;
  }
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

/**
 * Display names of the users who recorded entries. A failure here is not fatal:
 * the history then shows the entry without an author instead of an error page.
 */
async function namesByUserId(
  supabase: ServerClient,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from('app_users')
    .select('id, display_name, email')
    .in('id', [...userIds]);

  if (error !== null) {
    console.error('[queries] getSessionDetail (app_users):', error.message);
    return new Map();
  }
  return new Map((data ?? []).map((row) => [row.id, row.display_name ?? row.email]));
}

/**
 * Reads `settings.quick_amounts_cents` (`[5000,10000,20000]`). Anything that is
 * not a list of positive integers falls back to the SPEC default — a broken
 * setting must not put a float or a negative amount on a button.
 */
export function parseQuickAmounts(value: Json | null): number[] {
  if (!Array.isArray(value)) return DEFAULT_QUICK_AMOUNTS_CENTS;

  const amounts = value.filter(
    (entry): entry is number => typeof entry === 'number' && Number.isInteger(entry) && entry > 0,
  );
  return amounts.length === 0 ? DEFAULT_QUICK_AMOUNTS_CENTS : amounts;
}
