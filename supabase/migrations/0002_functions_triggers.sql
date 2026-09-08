-- =============================================================================
-- 0002_functions_triggers.sql — roles, audit log, business rules, RPCs
-- =============================================================================
-- Requires 0001_schema.sql. Safe to run repeatedly (create or replace / drop if
-- exists). Every rule of docs/SPEC.md section 4 and 5 is enforced here, not in
-- the UI. Error codes are raised as the plain message text so the frontend can
-- map them to German sentences (see WP5 src/lib/errors/de.ts).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Role helpers
-- -----------------------------------------------------------------------------

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select u.role from public.app_users u where u.id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() = 'admin', false);
$$;

create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_app_role() in ('admin', 'editor'), false);
$$;

-- used by the RLS policies of session_players and entries
create or replace function public.session_is_open(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.status = 'open' from public.sessions s where s.id = p_session_id), false);
$$;

-- -----------------------------------------------------------------------------
-- New Google account -> app_users row (SPEC 3: default viewer, whitelist wins)
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text := lower(coalesce(new.email, ''));
  v_role   public.app_role;
  v_name   text;
  v_avatar text;
begin
  select w.role into v_role from public.role_whitelist w where w.email = v_email;

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

  insert into public.app_users (id, email, display_name, avatar_url, role)
  values (new.id, v_email, v_name, v_avatar, coalesce(v_role, 'viewer'))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- The last admin cannot be demoted or deleted (SPEC 3)
-- -----------------------------------------------------------------------------

create or replace function public.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loses_admin boolean;
begin
  if tg_op = 'DELETE' then
    v_loses_admin := (old.role = 'admin');
  else
    v_loses_admin := (old.role = 'admin' and new.role <> 'admin');
  end if;

  if v_loses_admin
     and not exists (select 1 from public.app_users u
                     where u.role = 'admin' and u.id <> old.id) then
    raise exception 'LAST_ADMIN' using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_last_admin_trg on public.app_users;
create trigger protect_last_admin_trg
  before update or delete on public.app_users
  for each row execute function public.protect_last_admin();

-- -----------------------------------------------------------------------------
-- app_users: only an admin may update, and only the role column
-- (RLS is the first gate, this trigger is the second one.)
-- auth.uid() is null when the statement comes from the SQL editor / a trigger,
-- never from a PostgREST request of role `authenticated` — that path stays open
-- so the planner can bootstrap the first admin by hand.
-- -----------------------------------------------------------------------------

create or replace function public.protect_app_user_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.display_name is distinct from old.display_name
     or new.avatar_url is distinct from old.avatar_url
     or new.created_at is distinct from old.created_at then
    raise exception 'ONLY_ROLE_EDITABLE' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_app_user_columns_trg on public.app_users;
create trigger protect_app_user_columns_trg
  before update on public.app_users
  for each row execute function public.protect_app_user_columns();

-- -----------------------------------------------------------------------------
-- Who recorded this? (SPEC 4: "immer mit Zeitstempel und erfassendem Nutzer")
-- The column has `default auth.uid()`, but a client may still send a value of
-- its own; on INSERT this trigger overwrites it, so the recorder shown in the
-- history is always the authenticated caller. UPDATE never touches created_by.
-- auth.uid() is null in the SQL editor / seed — that path keeps the given value
-- so the planner can bootstrap rows by hand (same rule as
-- protect_app_user_columns above).
-- -----------------------------------------------------------------------------

create or replace function public.stamp_actor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_table_name = 'players' then
    new.created_by := auth.uid();
  elsif tg_table_name = 'sessions' then
    new.created_by := auth.uid();
  elsif tg_table_name = 'session_players' then
    new.added_by := auth.uid();
  elsif tg_table_name = 'entries' then
    new.created_by := auth.uid();
  elsif tg_table_name = 'settings' then
    new.updated_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists stamp_players on public.players;
create trigger stamp_players
  before insert on public.players
  for each row execute function public.stamp_actor();

drop trigger if exists stamp_sessions on public.sessions;
create trigger stamp_sessions
  before insert on public.sessions
  for each row execute function public.stamp_actor();

drop trigger if exists stamp_session_players on public.session_players;
create trigger stamp_session_players
  before insert on public.session_players
  for each row execute function public.stamp_actor();

drop trigger if exists stamp_entries on public.entries;
create trigger stamp_entries
  before insert on public.entries
  for each row execute function public.stamp_actor();

-- settings.updated_by is an "who changed it last", so it is stamped on update too
drop trigger if exists stamp_settings on public.settings;
create trigger stamp_settings
  before insert or update on public.settings
  for each row execute function public.stamp_actor();

-- -----------------------------------------------------------------------------
-- updated_at
-- -----------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_app_users on public.app_users;
create trigger touch_app_users
  before update on public.app_users
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_settings on public.settings;
create trigger touch_settings
  before update on public.settings
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Audit log (SPEC 4). Generic AFTER trigger; the primary key columns are passed
-- as trigger arguments, so composite keys become "a:b".
-- -----------------------------------------------------------------------------

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old  jsonb;
  v_new  jsonb;
  v_rec  jsonb;
  v_keys text[] := case when tg_nargs = 0 then array['id'] else tg_argv end;
  v_uid  uuid := auth.uid();
  v_email text;
  v_row_id text;
  v_session_id uuid;
begin
  -- NEW/OLD must never be touched outside their operation: an unassigned
  -- record raises "record is not assigned yet", so no CASE shortcuts here.
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;
  v_rec := coalesce(v_new, v_old);

  -- app_users is written on every login refresh; only role changes are interesting
  if tg_table_name = 'app_users' and tg_op = 'UPDATE'
     and (v_old ->> 'role') is not distinct from (v_new ->> 'role') then
    return null;
  end if;

  select string_agg(coalesce(v_rec ->> k, ''), ':' order by ord)
    into v_row_id
    from unnest(v_keys) with ordinality as t(k, ord);

  if v_rec ? 'session_id' then
    v_session_id := nullif(v_rec ->> 'session_id', '')::uuid;
  elsif tg_table_name = 'sessions' then
    v_session_id := nullif(v_rec ->> 'id', '')::uuid;
  end if;

  if v_uid is not null then
    select u.email into v_email from public.app_users u where u.id = v_uid;
  end if;

  insert into public.audit_log
    (user_id, user_email, table_name, row_id, action, old_data, new_data, session_id)
  values
    (v_uid, v_email, tg_table_name, coalesce(v_row_id, ''), tg_op, v_old, v_new, v_session_id);

  return null;
end;
$$;

drop trigger if exists audit_sessions on public.sessions;
create trigger audit_sessions
  after insert or update or delete on public.sessions
  for each row execute function public.audit_row_change('id');

drop trigger if exists audit_session_players on public.session_players;
create trigger audit_session_players
  after insert or update or delete on public.session_players
  for each row execute function public.audit_row_change('session_id', 'player_id');

drop trigger if exists audit_entries on public.entries;
create trigger audit_entries
  after insert or update or delete on public.entries
  for each row execute function public.audit_row_change('id');

drop trigger if exists audit_players on public.players;
create trigger audit_players
  after insert or update or delete on public.players
  for each row execute function public.audit_row_change('id');

drop trigger if exists audit_app_users on public.app_users;
create trigger audit_app_users
  after insert or update or delete on public.app_users
  for each row execute function public.audit_row_change('id');

drop trigger if exists audit_settings on public.settings;
create trigger audit_settings
  after insert or update or delete on public.settings
  for each row execute function public.audit_row_change('key');

drop trigger if exists audit_settlements on public.settlements;
create trigger audit_settlements
  after insert or update or delete on public.settlements
  for each row execute function public.audit_row_change('session_id');

-- -----------------------------------------------------------------------------
-- entries: all business rules of SPEC 4 / 5
-- -----------------------------------------------------------------------------

create or replace function public.validate_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session    uuid;
  v_player     uuid;
  v_row_id     uuid;
  v_status     public.session_status;
  v_stack      integer;
  v_payouts    integer;
  v_cash_other integer;
  v_pay_other  integer;
  v_new_cash   integer := 0;
  v_new_payout integer := 0;
begin
  -- NEW/OLD must never be touched outside their operation: an unassigned
  -- record raises "record is not assigned yet", so no CASE shortcuts here.
  if tg_op = 'DELETE' then
    v_session := old.session_id;
    v_player  := old.player_id;
    v_row_id  := old.id;
  else
    v_session := new.session_id;
    v_player  := new.player_id;
    v_row_id  := new.id;
  end if;

  -- (a) the session must be open — closed sessions are immutable (SPEC 5.6)
  select s.status into v_status from public.sessions s where s.id = v_session;
  if v_status is null then
    -- the session row is already gone: this delete is the ON DELETE CASCADE of
    -- `delete from sessions` (admin, open session). Nothing left to protect.
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status <> 'open' then
    raise exception 'SESSION_CLOSED' using errcode = 'P0001';
  end if;

  -- (f) an update may never re-point an entry: session, player and type are
  -- part of its identity. Otherwise a cash buy-in could be moved to another
  -- session (the cash box check below would only see the new side) or a
  -- cash_out could be hung onto another player. The app never needs this;
  -- WP5 only knows updateCashOut and deleteEntry.
  if tg_op = 'UPDATE'
     and (new.session_id, new.player_id, new.type)
         is distinct from (old.session_id, old.player_id, old.type) then
    raise exception 'ENTRY_IMMUTABLE_KEYS' using errcode = 'P0001';
  end if;

  -- amounts moved by this statement (NEW is not assigned on DELETE)
  if tg_op <> 'DELETE' then
    if new.type = 'buy_in' and new.payment = 'cash' then
      v_new_cash := new.amount_cents;
    end if;
    if new.type = 'payout' then
      v_new_payout := new.amount_cents;
    end if;
  end if;

  -- (e) a cash_out may only be removed while the player has no payout
  if tg_op = 'DELETE' and old.type = 'cash_out' then
    if exists (select 1 from public.entries e
               where e.session_id = v_session and e.player_id = v_player
                 and e.type = 'payout') then
      raise exception 'CASH_OUT_HAS_PAYOUT' using errcode = 'P0001';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    -- (b) no buy_in after the player cashed out
    if new.type = 'buy_in'
       and exists (select 1 from public.entries e
                   where e.session_id = v_session and e.player_id = v_player
                     and e.type = 'cash_out' and e.id <> v_row_id) then
      raise exception 'PLAYER_ALREADY_CASHED_OUT' using errcode = 'P0001';
    end if;

    -- (d) the stack may never drop below what the player already took in cash
    if new.type = 'cash_out' then
      select coalesce(sum(e.amount_cents), 0) into v_payouts
        from public.entries e
        where e.session_id = v_session and e.player_id = v_player and e.type = 'payout';
      if new.amount_cents < v_payouts then
        raise exception 'STACK_BELOW_PAYOUT' using errcode = 'P0001';
      end if;
    end if;

    -- (c) payout needs a cash_out and must not exceed the stack
    if new.type = 'payout' then
      select e.amount_cents into v_stack
        from public.entries e
        where e.session_id = v_session and e.player_id = v_player and e.type = 'cash_out';
      if v_stack is null then
        raise exception 'PAYOUT_REQUIRES_CASH_OUT' using errcode = 'P0001';
      end if;

      select coalesce(sum(e.amount_cents), 0) into v_payouts
        from public.entries e
        where e.session_id = v_session and e.player_id = v_player
          and e.type = 'payout' and e.id <> v_row_id;

      if v_payouts + new.amount_cents > v_stack then
        raise exception 'PAYOUT_EXCEEDS_STACK' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- (c2) the cash box can never go negative: sum(payout) <= sum(cash buy_in).
  -- Checked for every operation, so removing or re-typing a cash buy-in cannot
  -- retroactively overdraw the box either.
  select coalesce(sum(e.amount_cents), 0) into v_cash_other
    from public.entries e
    where e.session_id = v_session and e.type = 'buy_in' and e.payment = 'cash'
      and e.id <> v_row_id;

  select coalesce(sum(e.amount_cents), 0) into v_pay_other
    from public.entries e
    where e.session_id = v_session and e.type = 'payout' and e.id <> v_row_id;

  if v_pay_other + v_new_payout > v_cash_other + v_new_cash then
    raise exception 'PAYOUT_EXCEEDS_CASHBOX' using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_entry_trg on public.entries;
create trigger validate_entry_trg
  before insert or update or delete on public.entries
  for each row execute function public.validate_entry();

-- -----------------------------------------------------------------------------
-- sessions: status and close/reopen columns may only be touched by the RPCs
-- -----------------------------------------------------------------------------

create or replace function public.validate_session_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_transition boolean := coalesce(current_setting('app.session_transition', true), 'off') = 'on';
begin
  if not v_transition then
    if new.status            is distinct from old.status
       or new.closed_at         is distinct from old.closed_at
       or new.closed_by         is distinct from old.closed_by
       or new.discrepancy_cents is distinct from old.discrepancy_cents
       or new.close_note        is distinct from old.close_note
       or new.reopened_at       is distinct from old.reopened_at
       or new.reopened_by       is distinct from old.reopened_by then
      raise exception 'USE_RPC' using errcode = 'P0001';
    end if;
  end if;

  if old.status <> 'open'
     and (new.name is distinct from old.name or new.played_on is distinct from old.played_on) then
    raise exception 'SESSION_CLOSED' using errcode = 'P0001';
  end if;

  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'IMMUTABLE_FIELD' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_session_update_trg on public.sessions;
create trigger validate_session_update_trg
  before update on public.sessions
  for each row execute function public.validate_session_update();

-- -----------------------------------------------------------------------------
-- session_players: a participant may only leave while the session is open and
-- while they have no entries at all
-- -----------------------------------------------------------------------------

create or replace function public.validate_session_player_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.session_status;
begin
  select s.status into v_status from public.sessions s where s.id = old.session_id;

  -- session already gone (cascade from sessions delete): nothing to protect
  if v_status is null then
    return old;
  end if;

  if v_status <> 'open' then
    raise exception 'SESSION_CLOSED' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.entries e
             where e.session_id = old.session_id and e.player_id = old.player_id) then
    raise exception 'PLAYER_HAS_ENTRIES' using errcode = 'P0001';
  end if;

  return old;
end;
$$;

drop trigger if exists validate_session_player_delete_trg on public.session_players;
create trigger validate_session_player_delete_trg
  before delete on public.session_players
  for each row execute function public.validate_session_player_delete();

-- =============================================================================
-- RPCs
-- =============================================================================

-- -----------------------------------------------------------------------------
-- settlement_input — aggregated input for computeSettlement() (docs/SETTLEMENT.md
-- section "Eingabe"). security invoker: the caller's RLS applies.
-- -----------------------------------------------------------------------------

-- dropped first: CREATE OR REPLACE cannot change a RETURNS TABLE signature,
-- so a second `db push` after a schema change would fail otherwise.
drop function if exists public.settlement_input(uuid);

create function public.settlement_input(p_session_id uuid)
returns table (
  player_id       uuid,
  player_name     text,
  "position"      integer,
  cash_in_cents   integer,
  credit_in_cents integer,
  stack_cents     integer,
  payout_cents    integer,
  has_cash_out    boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    sp.player_id,
    p.name,
    sp.position,
    coalesce(sum(e.amount_cents) filter (where e.type = 'buy_in'  and e.payment = 'cash'), 0)::integer,
    coalesce(sum(e.amount_cents) filter (where e.type = 'buy_in'  and e.payment = 'credit'), 0)::integer,
    coalesce(sum(e.amount_cents) filter (where e.type = 'cash_out'), 0)::integer,
    coalesce(sum(e.amount_cents) filter (where e.type = 'payout'), 0)::integer,
    coalesce(bool_or(e.type = 'cash_out'), false)
  from public.session_players sp
  join public.players p on p.id = sp.player_id
  left join public.entries e
    on e.session_id = sp.session_id and e.player_id = sp.player_id
  where sp.session_id = p_session_id
  group by sp.player_id, p.name, sp.position
  order by sp.position;
$$;

-- -----------------------------------------------------------------------------
-- close_session — freezes the settlement and closes the session.
--
-- p_settlement is the JSON of SettlementResult (docs/SETTLEMENT.md, camelCase).
-- The function never trusts it: every per-player amount is recomputed from
-- `entries` and compared. A mismatch means the data changed underneath the
-- client -> SETTLEMENT_MISMATCH, nothing is written.
-- -----------------------------------------------------------------------------

drop function if exists public.close_session(uuid, jsonb, text);

create function public.close_session(
  p_session_id uuid,
  p_settlement jsonb,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status        public.session_status;
  v_note          text := nullif(trim(coalesce(p_note, '')), '');
  v_participants  integer;
  v_lines         integer;
  v_missing       integer;
  v_cash          integer;
  v_credit        integer;
  v_stack         integer;
  v_payout        integer;
  v_buy_in        integer;
  v_discrepancy   integer;
  v_from_box      bigint;
  v_transfers     bigint;
  v_pos_residual  bigint;
  v_neg_residual  bigint;
  v_tier3         bigint;
  v_unallocated   integer;
  v_uncov_claims  integer;
  v_uncov_debts   integer;
begin
  if not public.is_editor() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select s.status into v_status
    from public.sessions s where s.id = p_session_id for update;
  if v_status is null then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status <> 'open' then
    raise exception 'SESSION_CLOSED' using errcode = 'P0001';
  end if;

  select count(*) into v_participants
    from public.session_players sp where sp.session_id = p_session_id;
  if v_participants = 0 then
    raise exception 'NO_PARTICIPANTS' using errcode = 'P0001';
  end if;

  select count(*) into v_missing
    from public.session_players sp
    where sp.session_id = p_session_id
      and not exists (select 1 from public.entries e
                      where e.session_id = sp.session_id
                        and e.player_id = sp.player_id
                        and e.type = 'cash_out');
  if v_missing > 0 then
    raise exception 'MISSING_CASH_OUT' using errcode = 'P0001';
  end if;

  -- ---- server side totals -------------------------------------------------
  select
    coalesce(sum(e.amount_cents) filter (where e.type = 'buy_in' and e.payment = 'cash'), 0),
    coalesce(sum(e.amount_cents) filter (where e.type = 'buy_in' and e.payment = 'credit'), 0),
    coalesce(sum(e.amount_cents) filter (where e.type = 'cash_out'), 0),
    coalesce(sum(e.amount_cents) filter (where e.type = 'payout'), 0)
  into v_cash, v_credit, v_stack, v_payout
  from public.entries e where e.session_id = p_session_id;

  v_buy_in      := v_cash + v_credit;
  v_discrepancy := v_stack - v_buy_in;

  if p_settlement is null
     or jsonb_typeof(p_settlement -> 'lines') <> 'array'
     or jsonb_typeof(coalesce(p_settlement -> 'transfers', '[]'::jsonb)) <> 'array' then
    raise exception 'SETTLEMENT_MISMATCH' using errcode = 'P0001';
  end if;

  if coalesce((p_settlement ->> 'algorithmVersion')::integer, 0) < 1
     or (p_settlement ->> 'totalBuyIn')::integer          is distinct from v_buy_in
     or (p_settlement ->> 'totalStack')::integer          is distinct from v_stack
     or (p_settlement ->> 'discrepancy')::integer         is distinct from v_discrepancy
     or (p_settlement ->> 'cashBoxStart')::integer        is distinct from v_cash
     or (p_settlement ->> 'cashBoxAfterPayouts')::integer is distinct from (v_cash - v_payout)
     or coalesce((p_settlement ->> 'unallocatedCash')::integer, -1) < 0
     or coalesce((p_settlement ->> 'uncoveredClaims')::integer, -1) < 0
     or coalesce((p_settlement ->> 'uncoveredDebts')::integer, -1) < 0 then
    raise exception 'SETTLEMENT_MISMATCH' using errcode = 'P0001';
  end if;

  v_unallocated  := (p_settlement ->> 'unallocatedCash')::integer;
  v_uncov_claims := (p_settlement ->> 'uncoveredClaims')::integer;
  v_uncov_debts  := (p_settlement ->> 'uncoveredDebts')::integer;

  -- exactly one line per participant, no duplicates
  select count(distinct l."playerId") into v_lines
    from jsonb_to_recordset(p_settlement -> 'lines') as l("playerId" uuid);
  if v_lines <> v_participants
     or v_lines <> (select count(*) from jsonb_array_elements(p_settlement -> 'lines')) then
    raise exception 'SETTLEMENT_MISMATCH' using errcode = 'P0001';
  end if;

  -- ---- per player: recompute and compare ----------------------------------
  if exists (
    select 1
    from jsonb_to_recordset(p_settlement -> 'lines') as l(
      "playerId"     uuid,
      "cashIn"       integer,
      "creditIn"     integer,
      "stack"        integer,
      "payout"       integer,
      "isCashPlayer" boolean,
      "claim"        integer,
      "cashTier1"    integer,
      "cashTier2"    integer,
      "cashTier3"    integer,
      "cashFromBox"  integer,
      "netResult"    integer,
      "residual"     integer
    )
    left join (
      select
        sp.player_id,
        coalesce(sum(e.amount_cents) filter (where e.type = 'buy_in' and e.payment = 'cash'), 0)   as cash_in,
        coalesce(sum(e.amount_cents) filter (where e.type = 'buy_in' and e.payment = 'credit'), 0) as credit_in,
        coalesce(sum(e.amount_cents) filter (where e.type = 'cash_out'), 0)                        as stack,
        coalesce(sum(e.amount_cents) filter (where e.type = 'payout'), 0)                          as payout
      from public.session_players sp
      left join public.entries e
        on e.session_id = sp.session_id and e.player_id = sp.player_id
      where sp.session_id = p_session_id
      group by sp.player_id
    ) agg on agg.player_id = l."playerId"
    where agg.player_id is null
       or l."cashIn"       is distinct from agg.cash_in
       or l."creditIn"     is distinct from agg.credit_in
       or l."stack"        is distinct from agg.stack
       or l."payout"       is distinct from agg.payout
       or l."isCashPlayer" is distinct from (agg.cash_in > 0)
       or l."claim"        is distinct from (agg.stack - agg.payout)
       or l."netResult"    is distinct from (agg.stack - agg.cash_in - agg.credit_in)
       or l."cashTier1" is null or l."cashTier1" < 0
       or l."cashTier2" is null or l."cashTier2" < 0
       or l."cashTier3" is null or l."cashTier3" < 0
       or l."cashFromBox" is distinct from (l."cashTier1" + l."cashTier2" + l."cashTier3")
       or l."cashFromBox" > (agg.stack - agg.payout)
       or l."residual"    is distinct from (agg.stack - agg.payout - l."cashFromBox" - agg.credit_in)
  ) then
    raise exception 'SETTLEMENT_MISMATCH' using errcode = 'P0001';
  end if;

  -- ---- invariants of docs/SETTLEMENT.md -----------------------------------
  select coalesce(sum(l."cashFromBox"), 0),
         coalesce(sum(greatest(l."residual", 0)), 0),
         coalesce(sum(greatest(-l."residual", 0)), 0),
         coalesce(sum(l."cashTier3"), 0)
    into v_from_box, v_pos_residual, v_neg_residual, v_tier3
    from jsonb_to_recordset(p_settlement -> 'lines')
      as l("cashFromBox" integer, "residual" integer, "cashTier3" integer);

  -- invariant 2: the cash box is fully accounted for
  if v_from_box + (p_settlement ->> 'unallocatedCash')::integer <> (v_cash - v_payout) then
    raise exception 'SETTLEMENT_INVARIANT' using errcode = 'P0001',
      detail = 'Kasseninvariante verletzt: Summe cashFromBox + unallocatedCash '
               || 'entspricht nicht Summe cash buy_in - Summe payout.';
  end if;

  select coalesce(sum(t."amount"), 0) into v_transfers
    from jsonb_to_recordset(coalesce(p_settlement -> 'transfers', '[]'::jsonb))
      as t("amount" integer);

  -- step 5: what the greedy could not settle is reported, not transferred
  if v_transfers + (p_settlement ->> 'uncoveredClaims')::integer <> v_pos_residual then
    raise exception 'SETTLEMENT_INVARIANT' using errcode = 'P0001',
      detail = 'Summe Überweisungen + uncoveredClaims entspricht nicht der Summe '
               || 'der positiven Residuen.';
  end if;

  if v_transfers + v_uncov_debts <> v_neg_residual then
    raise exception 'SETTLEMENT_INVARIANT' using errcode = 'P0001',
      detail = 'Summe Überweisungen + uncoveredDebts entspricht nicht der Summe '
               || 'der negativen Residuen.';
  end if;

  -- step 5: the greedy runs until one of the two sides is empty, so it moves
  -- exactly min(sum positive residual, sum |negative residual|)
  if v_transfers <> least(v_pos_residual, v_neg_residual) then
    raise exception 'SETTLEMENT_INVARIANT' using errcode = 'P0001',
      detail = 'Summe der Überweisungen ist nicht min(Summe positive Residuen, '
               || 'Summe negative Residuen).';
  end if;

  -- step 5: a transfer always runs from a debtor (residual < 0) to a creditor
  -- (residual > 0); both must be lines of this settlement
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_settlement -> 'transfers', '[]'::jsonb))
      as t("fromPlayerId" uuid, "toPlayerId" uuid, "amount" integer)
    left join jsonb_to_recordset(p_settlement -> 'lines')
      as lf("playerId" uuid, "residual" integer) on lf."playerId" = t."fromPlayerId"
    left join jsonb_to_recordset(p_settlement -> 'lines')
      as lt("playerId" uuid, "residual" integer) on lt."playerId" = t."toPlayerId"
    where t."amount" is null or t."amount" <= 0
       or lf."playerId" is null or lt."playerId" is null
       or lf."residual" >= 0 or lt."residual" <= 0
  ) then
    raise exception 'SETTLEMENT_INVARIANT' using errcode = 'P0001',
      detail = 'Überweisung läuft nicht von einem Schuldner (residual < 0) an einen '
               || 'Gläubiger (residual > 0).';
  end if;

  -- invariant 6 ("Bargeld zuerst an Bar-Zahler"): as long as one cash payer has
  -- an open claim, no list player may receive cash from the box
  if v_tier3 > 0 and exists (
    select 1
    from jsonb_to_recordset(p_settlement -> 'lines')
      as l("isCashPlayer" boolean, "cashFromBox" integer, "claim" integer)
    where l."isCashPlayer" and l."cashFromBox" is distinct from l."claim"
  ) then
    raise exception 'SETTLEMENT_INVARIANT' using errcode = 'P0001',
      detail = 'Listen-Spieler bekommt Bargeld (cashTier3 > 0), obwohl ein Bar-Zahler '
               || 'noch einen offenen Anspruch hat.';
  end if;

  -- step 5: how the difference must show up in the three reported leftovers
  if v_discrepancy = 0 then
    if v_unallocated <> 0 or v_uncov_claims <> 0 or v_uncov_debts <> 0 then
      raise exception 'SETTLEMENT_INVARIANT' using errcode = 'P0001',
        detail = 'Bei Differenz 0 müssen unallocatedCash, uncoveredClaims und '
                 || 'uncoveredDebts alle 0 sein.';
    end if;
  elsif v_discrepancy < 0 then
    if v_uncov_claims <> 0 or v_unallocated + v_uncov_debts <> -v_discrepancy then
      raise exception 'SETTLEMENT_INVARIANT' using errcode = 'P0001',
        detail = 'Bei negativer Differenz muss unallocatedCash + uncoveredDebts = '
                 || '-discrepancy gelten und uncoveredClaims 0 sein.';
    end if;
  else
    if v_unallocated <> 0 or v_uncov_debts <> 0 or v_uncov_claims <> v_discrepancy then
      raise exception 'SETTLEMENT_INVARIANT' using errcode = 'P0001',
        detail = 'Bei positiver Differenz muss uncoveredClaims = discrepancy gelten '
                 || 'und unallocatedCash sowie uncoveredDebts 0 sein.';
    end if;
  end if;

  -- ---- discrepancy needs an admin and a comment (SPEC 5.5) ----------------
  if v_discrepancy <> 0 then
    if not public.is_admin() or v_note is null or length(v_note) < 3 then
      raise exception 'DISCREPANCY_REQUIRES_ADMIN_NOTE' using errcode = 'P0001';
    end if;
  end if;

  -- ---- write, all in this transaction -------------------------------------
  insert into public.settlements (
    session_id, algorithm_version, computed_by,
    total_buy_in_cents, total_stack_cents, discrepancy_cents,
    cash_box_start_cents, cash_box_after_payouts_cents,
    unallocated_cash_cents, uncovered_claims_cents, uncovered_debts_cents
  ) values (
    p_session_id,
    (p_settlement ->> 'algorithmVersion')::integer,
    auth.uid(),
    v_buy_in, v_stack, v_discrepancy,
    v_cash, v_cash - v_payout,
    v_unallocated, v_uncov_claims, v_uncov_debts
  );

  insert into public.settlement_lines (
    session_id, player_id, position,
    cash_in_cents, credit_in_cents, stack_cents, payout_cents,
    is_cash_player, claim_cents,
    cash_tier1_cents, cash_tier2_cents, cash_tier3_cents,
    cash_from_box_cents, net_result_cents, residual_cents
  )
  select
    p_session_id, l."playerId", sp.position,
    l."cashIn", l."creditIn", l."stack", l."payout",
    l."isCashPlayer", l."claim",
    l."cashTier1", l."cashTier2", l."cashTier3",
    l."cashFromBox", l."netResult", l."residual"
  from jsonb_to_recordset(p_settlement -> 'lines') as l(
    "playerId" uuid, "cashIn" integer, "creditIn" integer, "stack" integer,
    "payout" integer, "isCashPlayer" boolean, "claim" integer,
    "cashTier1" integer, "cashTier2" integer, "cashTier3" integer,
    "cashFromBox" integer, "netResult" integer, "residual" integer)
  join public.session_players sp
    on sp.session_id = p_session_id and sp.player_id = l."playerId";

  insert into public.settlement_transfers (
    session_id, position, from_player_id, to_player_id, amount_cents
  )
  select p_session_id, (t.ord - 1)::integer,
         (t.elem ->> 'fromPlayerId')::uuid,
         (t.elem ->> 'toPlayerId')::uuid,
         (t.elem ->> 'amount')::integer
  from jsonb_array_elements(coalesce(p_settlement -> 'transfers', '[]'::jsonb))
       with ordinality as t(elem, ord);

  -- every transfer must reference participants of this session
  if exists (
    select 1 from public.settlement_transfers st
    where st.session_id = p_session_id
      and (not exists (select 1 from public.session_players sp
                       where sp.session_id = p_session_id and sp.player_id = st.from_player_id)
        or not exists (select 1 from public.session_players sp
                       where sp.session_id = p_session_id and sp.player_id = st.to_player_id))
  ) then
    raise exception 'SETTLEMENT_MISMATCH' using errcode = 'P0001';
  end if;

  perform set_config('app.session_transition', 'on', true);

  update public.sessions s
     set status            = 'closed',
         closed_at         = now(),
         closed_by         = auth.uid(),
         discrepancy_cents = v_discrepancy,
         close_note        = v_note
   where s.id = p_session_id;

  perform set_config('app.session_transition', 'off', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- reopen_session — admin only; drops the frozen settlement (SPEC 4 / 5.6).
-- closed_at / closed_by / discrepancy_cents are reset to null: the session is
-- open again and those columns describe a closed one. Their old values stay in
-- audit_log.old_data, so the history of repeated closings remains complete
-- (SPEC 4). close_note survives with the reason appended.
-- -----------------------------------------------------------------------------

drop function if exists public.reopen_session(uuid, text);

create function public.reopen_session(
  p_session_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.session_status;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if v_reason is null or length(v_reason) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select s.status into v_status
    from public.sessions s where s.id = p_session_id for update;
  if v_status is null then
    raise exception 'SESSION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status <> 'closed' then
    raise exception 'SESSION_NOT_CLOSED' using errcode = 'P0001';
  end if;

  -- cascades to settlement_lines and settlement_transfers
  delete from public.settlements where session_id = p_session_id;

  perform set_config('app.session_transition', 'on', true);

  update public.sessions s
     set status            = 'open',
         reopened_at       = now(),
         reopened_by       = auth.uid(),
         closed_at         = null,
         closed_by         = null,
         discrepancy_cents = null,
         close_note  = coalesce(s.close_note, '')
                       || case when coalesce(s.close_note, '') = '' then '' else E'\n' end
                       || '[wieder geöffnet: ' || v_reason || ']'
   where s.id = p_session_id;

  perform set_config('app.session_transition', 'off', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Execution rights: logged-in users only (see also 0003_rls.sql)
-- -----------------------------------------------------------------------------

revoke all on function public.close_session(uuid, jsonb, text)   from public, anon;
revoke all on function public.reopen_session(uuid, text)          from public, anon;
revoke all on function public.settlement_input(uuid)              from public, anon;
revoke all on function public.current_app_role()                  from public, anon;
revoke all on function public.is_admin()                          from public, anon;
revoke all on function public.is_editor()                         from public, anon;
revoke all on function public.session_is_open(uuid)               from public, anon;

grant execute on function public.close_session(uuid, jsonb, text) to authenticated;
grant execute on function public.reopen_session(uuid, text)       to authenticated;
grant execute on function public.settlement_input(uuid)           to authenticated;
grant execute on function public.current_app_role()               to authenticated;
grant execute on function public.is_admin()                       to authenticated;
grant execute on function public.is_editor()                      to authenticated;
grant execute on function public.session_is_open(uuid)            to authenticated;

-- Trigger functions are never called directly ("trigger functions can only be
-- called as triggers"). PostgreSQL grants EXECUTE to public by default, which
-- would be the only place in this file where a role keeps a right it does not
-- need — the permission for a trigger is checked at CREATE TRIGGER time, not
-- when it fires, so revoking here changes nothing for the triggers themselves.
revoke all on function public.handle_new_auth_user()          from public, anon, authenticated;
revoke all on function public.protect_last_admin()            from public, anon, authenticated;
revoke all on function public.protect_app_user_columns()      from public, anon, authenticated;
revoke all on function public.stamp_actor()                   from public, anon, authenticated;
revoke all on function public.touch_updated_at()              from public, anon, authenticated;
revoke all on function public.audit_row_change()              from public, anon, authenticated;
revoke all on function public.validate_entry()                from public, anon, authenticated;
revoke all on function public.validate_session_update()       from public, anon, authenticated;
revoke all on function public.validate_session_player_delete() from public, anon, authenticated;
