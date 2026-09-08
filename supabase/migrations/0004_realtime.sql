-- =============================================================================
-- 0004_realtime.sql — realtime publication
-- =============================================================================
-- Requires 0001. Safe to run repeatedly.
--
-- The session detail screen (WP5) subscribes to these tables. Realtime still
-- applies RLS per subscriber, so a viewer only receives rows it may read.
-- `replica identity full` on entries makes DELETE events carry the old row,
-- otherwise the client only sees the primary key and cannot update its state.
-- =============================================================================

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'Publication supabase_realtime does not exist - skipping (not a Supabase database?)';
    return;
  end if;

  foreach t in array array['sessions', 'session_players', 'entries', 'players', 'settings']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

alter table public.entries replica identity full;
