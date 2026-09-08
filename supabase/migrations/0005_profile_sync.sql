-- =============================================================================
-- 0005 — profile sync (WP2)
--
-- SPEC §3: "Anzeigename und Avatar werden bei jedem Login aus dem Google-Profil
-- aktualisiert (Trigger auf auth.users-Update, WP2). Die Rolle bleibt davon
-- unberührt."
--
-- 0002 only fills app_users once, when the account signs in for the first time
-- (handle_new_auth_user, `on conflict (id) do nothing`). Whoever changed their
-- Google name or picture afterwards kept the old one forever — that was open
-- question 1 of the WP1 handoff, and the planner decided it in SPEC §3.
--
-- Supabase (GoTrue) writes the provider profile into auth.users.raw_user_meta_data
-- on every sign-in. This trigger mirrors the two display columns from there.
--
-- The column guard on app_users (protect_app_user_columns, 0002) rejects any
-- change to display_name/avatar_url. This path announces itself with the
-- transaction-local setting `app.profile_sync = on`, exactly like the session
-- RPCs do with `app.session_transition`; 0002 then allows those two columns and
-- nothing else. Running 0005 therefore requires 0002 in its WP2 version.
--
-- Needs the same rights as 0002 (a trigger on auth.users): run it as `postgres`,
-- which is the default in the Supabase SQL editor.
-- =============================================================================

create or replace function public.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := lower(coalesce(new.email, ''));
  v_name   text;
  v_avatar text;
begin
  -- same fallback chain as handle_new_auth_user (0002)
  v_name := nullif(trim(coalesce(
              new.raw_user_meta_data ->> 'full_name',
              new.raw_user_meta_data ->> 'name',
              '')), '');
  if v_name is null then
    v_name := nullif(split_part(v_email, '@', 1), '');
  end if;

  v_avatar := nullif(trim(coalesce(
                new.raw_user_meta_data ->> 'avatar_url',
                new.raw_user_meta_data ->> 'picture',
                '')), '');

  -- nothing usable in the new metadata: leave the row alone
  if v_name is null and v_avatar is null then
    return new;
  end if;

  -- transaction-local, so it is gone again at the end of this statement's
  -- transaction, whatever happens below
  perform set_config('app.profile_sync', 'on', true);

  update public.app_users u
     set display_name = coalesce(v_name, u.display_name),
         avatar_url   = coalesce(v_avatar, u.avatar_url)
   where u.id = new.id
     -- no-op updates would only churn updated_at
     and (u.display_name is distinct from coalesce(v_name, u.display_name)
          or u.avatar_url is distinct from coalesce(v_avatar, u.avatar_url));

  perform set_config('app.profile_sync', 'off', true);

  return new;
end;
$$;

-- `update of raw_user_meta_data` fires only when that column is part of the
-- UPDATE; the when-clause additionally requires it to really have changed, so a
-- plain last_sign_in_at bump does not run the body.
drop trigger if exists on_auth_user_profile_updated on auth.users;
create trigger on_auth_user_profile_updated
  after update of raw_user_meta_data on auth.users
  for each row
  when (old.raw_user_meta_data is distinct from new.raw_user_meta_data)
  execute function public.sync_auth_user_profile();

-- Trigger function: nobody may call it directly. The trigger itself keeps
-- firing — the execute right is checked when the trigger is created, not when
-- it fires (same reasoning as the revokes at the end of 0002).
revoke all on function public.sync_auth_user_profile() from public, anon, authenticated;
