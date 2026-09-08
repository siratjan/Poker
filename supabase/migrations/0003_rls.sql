-- =============================================================================
-- 0003_rls.sql — row level security, policies and table grants
-- =============================================================================
-- Requires 0001 and 0002. Safe to run repeatedly.
--
-- Two gates protect every table:
--   1. GRANTs   — `anon` (not logged in) gets nothing at all.
--   2. Policies — all `to authenticated`, role checked via is_admin()/is_editor().
-- There is deliberately no policy for `anon`; without a policy nothing passes.
-- =============================================================================

alter table public.role_whitelist       enable row level security;
alter table public.app_users            enable row level security;
alter table public.players              enable row level security;
alter table public.sessions             enable row level security;
alter table public.session_players      enable row level security;
alter table public.entries              enable row level security;
alter table public.settlements          enable row level security;
alter table public.settlement_lines     enable row level security;
alter table public.settlement_transfers enable row level security;
alter table public.settings             enable row level security;
alter table public.audit_log            enable row level security;

-- -----------------------------------------------------------------------------
-- Grants: nothing for anon, least privilege for authenticated.
-- (RLS narrows this further; a missing grant already blocks on its own.)
-- -----------------------------------------------------------------------------

revoke all on public.role_whitelist, public.app_users, public.players,
              public.sessions, public.session_players, public.entries,
              public.settlements, public.settlement_lines,
              public.settlement_transfers, public.settings, public.audit_log
  from anon;

revoke all on public.role_whitelist, public.app_users, public.players,
              public.sessions, public.session_players, public.entries,
              public.settlements, public.settlement_lines,
              public.settlement_transfers, public.settings, public.audit_log
  from authenticated;

grant select, insert, update, delete on public.role_whitelist to authenticated;
grant select, update                on public.app_users       to authenticated;
grant select, insert, update, delete on public.players        to authenticated;
grant select, insert, update, delete on public.sessions       to authenticated;
grant select, insert, delete         on public.session_players to authenticated;
grant select, insert, update, delete on public.entries        to authenticated;
grant select                         on public.settlements    to authenticated;
grant select                         on public.settlement_lines to authenticated;
grant select                         on public.settlement_transfers to authenticated;
grant select, insert, update         on public.settings       to authenticated;
grant select                         on public.audit_log      to authenticated;

-- the audit_log sequence is only touched by the SECURITY DEFINER trigger
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

-- -----------------------------------------------------------------------------
-- role_whitelist — admin only, in every direction
-- -----------------------------------------------------------------------------

drop policy if exists role_whitelist_select on public.role_whitelist;
create policy role_whitelist_select on public.role_whitelist
  for select to authenticated using (public.is_admin());

drop policy if exists role_whitelist_insert on public.role_whitelist;
create policy role_whitelist_insert on public.role_whitelist
  for insert to authenticated with check (public.is_admin());

drop policy if exists role_whitelist_update on public.role_whitelist;
create policy role_whitelist_update on public.role_whitelist
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists role_whitelist_delete on public.role_whitelist;
create policy role_whitelist_delete on public.role_whitelist
  for delete to authenticated using (public.is_admin());

-- -----------------------------------------------------------------------------
-- app_users — everybody reads, only an admin updates, and only the role column
-- (column restriction: trigger protect_app_user_columns in 0002).
-- No insert policy: rows appear through handle_new_auth_user() only.
-- No delete policy: accounts disappear via auth.users cascade only.
-- -----------------------------------------------------------------------------

drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated using (true);

drop policy if exists app_users_update on public.app_users;
create policy app_users_update on public.app_users
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- players — editors create and rename, admins delete
-- -----------------------------------------------------------------------------

drop policy if exists players_select on public.players;
create policy players_select on public.players
  for select to authenticated using (true);

drop policy if exists players_insert on public.players;
create policy players_insert on public.players
  for insert to authenticated with check (public.is_editor());

drop policy if exists players_update on public.players;
create policy players_update on public.players
  for update to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists players_delete on public.players;
create policy players_delete on public.players
  for delete to authenticated using (public.is_admin());

-- -----------------------------------------------------------------------------
-- sessions — editors create and edit meta data (trigger limits the columns),
-- admins may delete an open session that has no settlement
-- -----------------------------------------------------------------------------

drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated using (true);

drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert on public.sessions
  for insert to authenticated with check (
    public.is_editor()
    and status = 'open'
    -- a brand new session carries no closing data; validate_session_update()
    -- only guards UPDATE, so without this an editor could invent a difference
    -- and a closing comment while creating the row
    and closed_at is null
    and closed_by is null
    and discrepancy_cents is null
    and close_note is null
    and reopened_at is null
    and reopened_by is null
  );

drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions
  for update to authenticated using (public.is_editor()) with check (public.is_editor());

drop policy if exists sessions_delete on public.sessions;
create policy sessions_delete on public.sessions
  for delete to authenticated using (
    public.is_admin()
    and status = 'open'
    and not exists (select 1 from public.settlements s where s.session_id = sessions.id)
  );

-- -----------------------------------------------------------------------------
-- session_players — editors, open session only. No update (position changes are
-- not a use case in v1); removal additionally guarded by a trigger.
-- -----------------------------------------------------------------------------

drop policy if exists session_players_select on public.session_players;
create policy session_players_select on public.session_players
  for select to authenticated using (true);

drop policy if exists session_players_insert on public.session_players;
create policy session_players_insert on public.session_players
  for insert to authenticated
  with check (public.is_editor() and public.session_is_open(session_id));

drop policy if exists session_players_delete on public.session_players;
create policy session_players_delete on public.session_players
  for delete to authenticated
  using (public.is_editor() and public.session_is_open(session_id));

-- -----------------------------------------------------------------------------
-- entries — editors, open session only, in both directions of an update
-- -----------------------------------------------------------------------------

drop policy if exists entries_select on public.entries;
create policy entries_select on public.entries
  for select to authenticated using (true);

drop policy if exists entries_insert on public.entries;
create policy entries_insert on public.entries
  for insert to authenticated
  with check (public.is_editor() and public.session_is_open(session_id));

drop policy if exists entries_update on public.entries;
create policy entries_update on public.entries
  for update to authenticated
  using (public.is_editor() and public.session_is_open(session_id))
  with check (public.is_editor() and public.session_is_open(session_id));

drop policy if exists entries_delete on public.entries;
create policy entries_delete on public.entries
  for delete to authenticated
  using (public.is_editor() and public.session_is_open(session_id));

-- -----------------------------------------------------------------------------
-- settlements / lines / transfers — read only for everybody.
-- Writes happen exclusively inside close_session / reopen_session, which are
-- SECURITY DEFINER and owned by the table owner (RLS does not apply there).
-- -----------------------------------------------------------------------------

drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements
  for select to authenticated using (true);

drop policy if exists settlement_lines_select on public.settlement_lines;
create policy settlement_lines_select on public.settlement_lines
  for select to authenticated using (true);

drop policy if exists settlement_transfers_select on public.settlement_transfers;
create policy settlement_transfers_select on public.settlement_transfers
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- settings — everybody reads the quick amounts, only admins change them
-- -----------------------------------------------------------------------------

drop policy if exists settings_select on public.settings;
create policy settings_select on public.settings
  for select to authenticated using (true);

drop policy if exists settings_insert on public.settings;
create policy settings_insert on public.settings
  for insert to authenticated with check (public.is_admin());

drop policy if exists settings_update on public.settings;
create policy settings_update on public.settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- audit_log — readable for every logged-in user, writable for nobody (SPEC 4).
-- The trigger writes it as table owner and bypasses RLS.
-- -----------------------------------------------------------------------------

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated using (true);
