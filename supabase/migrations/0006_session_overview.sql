-- =============================================================================
-- 0006_session_overview.sql — read view for the session list (WP4)
-- =============================================================================
-- Requires 0001 (and the RLS of 0003). Safe to run repeatedly.
--
-- The session list (src/app/(app)/page.tsx via src/lib/queries/sessions.ts)
-- needs per session: participant count and the sum of buy-ins, next to the
-- session's own columns. Doing that with a per-session follow-up query would be
-- N+1; this view aggregates it once in the database.
--
-- `security_invoker = true` (Postgres 15+, Supabase default engine) means the
-- view runs with the *querying user's* rights, so the RLS policies of sessions,
-- session_players and entries from 0003 still apply — the view does not widen
-- access. Without it a view would run as its owner and leak rows past RLS.
--
-- Buy-ins only (type = 'buy_in'); cash_out and payout are not buy-ins and must
-- not inflate the total. Money stays integer cents. count()/sum() return
-- bigint, cast to int so it matches the integer-cent contract and the generated
-- types (a night's totals are far below 2^31).
-- =============================================================================

create or replace view public.session_overview
with (security_invoker = true) as
select
  s.id,
  s.played_on,
  s.name,
  s.status,
  s.created_at,
  coalesce(p.participant_count, 0)::int  as participant_count,
  coalesce(b.total_buy_in_cents, 0)::int as total_buy_in_cents
from public.sessions s
left join (
  select session_id, count(*) as participant_count
  from public.session_players
  group by session_id
) p on p.session_id = s.id
left join (
  select session_id, sum(amount_cents) as total_buy_in_cents
  from public.entries
  where type = 'buy_in'
  group by session_id
) b on b.session_id = s.id;

comment on view public.session_overview is
  'Aggregat je Session fuer die Liste (WP4): participant_count, total_buy_in_cents. security_invoker, damit RLS des Nutzers greift.';

-- PostgREST needs an explicit grant to expose the view; anon gets nothing, so
-- an unauthenticated request sees no rows (and RLS would empty it regardless).
grant select on public.session_overview to authenticated;
