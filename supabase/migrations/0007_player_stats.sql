-- =============================================================================
-- 0007_player_stats.sql — read view for the player overview (WP7)
-- =============================================================================
-- Requires 0001 (tables) and 0003 (RLS). Safe to run repeatedly.
--
-- Plan note: docs/ARBEITSPAKETE.md WP7 step 1 names the file `0006_player_stats`,
-- but 0006 is already taken by `0006_session_overview.sql` (WP4). The view moved
-- to 0007; nothing else about it changed.
--
-- The player overview (src/app/(app)/players/page.tsx via
-- src/lib/queries/players.ts) needs one row per player with the totals over all
-- evenings. Computing that per player would be N+1; this view aggregates it
-- once in the database.
--
-- `security_invoker = true` (Postgres 15+) means the view runs with the
-- *querying* user's rights, so the RLS policies of players, sessions,
-- session_players and settlement_lines from 0003 still apply — the view does
-- not widen access. Without it the view would run as its owner and leak rows
-- past RLS.
--
-- Where the numbers come from:
--   * Money and session count come from `settlement_lines` of **closed**
--     sessions only. That is the frozen result of the evening (CLAUDE.md: a
--     settlement is stored, never recomputed), so the overview can never
--     disagree with what a closed session shows. A reopened session loses its
--     settlement rows (RPC `reopen_session`), and with them its contribution
--     here — which is correct: it has no result any more. The explicit
--     `s.status = 'closed'` join keeps that true even if rows ever survived.
--   * `open_sessions` counts the running evenings the player takes part in
--     (`session_players` of an `open` session), so the UI can show „läuft“.
--   * `last_played_on` is the newest `played_on` of **any** session the player
--     took part in, open or closed — „zuletzt gespielt“ means the last time he
--     sat at the table, not the last time an evening was settled.
--
-- A player without any session is not dropped (left join from `players`) and
-- reads 0 / 0 / 0 / 0 with `last_played_on = null`.
--
-- Money stays integer cents. count()/sum() return bigint; cast to int so the
-- generated types keep the integer-cent contract (all evenings together stay
-- far below 2^31 = ~21 million euro).
-- =============================================================================

create or replace view public.player_stats
with (security_invoker = true) as
select
  p.id                                   as player_id,
  p.name,
  p.name_normalized,
  coalesce(c.sessions_played, 0)::int    as sessions_played,
  coalesce(c.total_buy_in_cents, 0)::int as total_buy_in_cents,
  coalesce(c.total_stack_cents, 0)::int  as total_stack_cents,
  coalesce(c.net_cents, 0)::int          as net_cents,
  a.last_played_on,
  coalesce(a.open_sessions, 0)::int      as open_sessions
from public.players p
left join (
  -- closed evenings only: the frozen settlement lines
  select
    l.player_id,
    count(*)                                        as sessions_played,
    sum(l.cash_in_cents + l.credit_in_cents)        as total_buy_in_cents,
    sum(l.stack_cents)                              as total_stack_cents,
    sum(l.net_result_cents)                         as net_cents
  from public.settlement_lines l
  join public.sessions s on s.id = l.session_id
  where s.status = 'closed'
  group by l.player_id
) c on c.player_id = p.id
left join (
  -- participation over all sessions: last date played and running evenings
  select
    sp.player_id,
    max(s.played_on)                                       as last_played_on,
    count(*) filter (where s.status = 'open')              as open_sessions
  from public.session_players sp
  join public.sessions s on s.id = sp.session_id
  group by sp.player_id
) a on a.player_id = p.id;

comment on view public.player_stats is
  'Aggregat je Spieler fuer die Uebersicht (WP7): sessions_played/total_buy_in_cents/total_stack_cents/net_cents aus settlement_lines abgeschlossener Sessions, last_played_on und open_sessions aus session_players. security_invoker, damit RLS des Nutzers greift.';

-- PostgREST needs an explicit grant to expose the view; anon gets nothing, so
-- an unauthenticated request sees no rows (and RLS would empty it regardless).
grant select on public.player_stats to authenticated;
