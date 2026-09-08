-- =============================================================================
-- 0001_schema.sql — Poker-Kasse: enums, tables, indexes
-- =============================================================================
-- Runs standalone, in this order: 0001 -> 0002 -> 0003 -> 0004.
-- Works with `npx supabase db push` and with copy/paste into the Supabase
-- SQL editor. Re-running the file is safe (idempotent).
--
-- Money is always integer cents (`*_cents`). Never float. See docs/SPEC.md.
-- =============================================================================

-- gen_random_uuid() is part of the Postgres core since 13, no extension needed.

-- -----------------------------------------------------------------------------
-- Enums (CREATE TYPE has no IF NOT EXISTS, hence the DO blocks)
-- -----------------------------------------------------------------------------

do $$ begin
  create type public.app_role as enum ('admin', 'editor', 'viewer');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.session_status as enum ('open', 'closed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.entry_type as enum ('buy_in', 'cash_out', 'payout');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_method as enum ('cash', 'credit');
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- role_whitelist — role a Google account receives on its very first login
-- -----------------------------------------------------------------------------

create table if not exists public.role_whitelist (
  email      text primary key check (email = lower(email)),
  role       public.app_role not null,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.role_whitelist is
  'E-Mail -> Rolle beim ersten Login. Ohne Eintrag wird jeder Account viewer (SPEC 3).';

-- -----------------------------------------------------------------------------
-- app_users — one row per logged-in Google account (created by trigger)
-- -----------------------------------------------------------------------------

create table if not exists public.app_users (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null unique,
  display_name text,
  avatar_url   text,
  role         public.app_role not null default 'viewer',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists app_users_role_idx on public.app_users (role);

comment on table public.app_users is
  'Angemeldete Nutzer mit Rolle. Zeilen legt handle_new_auth_user() an, nie die App.';

-- -----------------------------------------------------------------------------
-- players — people at the table; no login required (SPEC 3)
-- -----------------------------------------------------------------------------

create table if not exists public.players (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (length(trim(name)) between 1 and 40),
  name_normalized text generated always as (lower(trim(name))) stored,
  created_by      uuid references public.app_users (id),
  created_at      timestamptz not null default now()
);

create unique index if not exists players_name_normalized_key
  on public.players (name_normalized);

-- -----------------------------------------------------------------------------
-- sessions — one poker night
-- -----------------------------------------------------------------------------

create table if not exists public.sessions (
  id                uuid primary key default gen_random_uuid(),
  played_on         date not null default current_date,
  name              text check (length(name) <= 60),
  status            public.session_status not null default 'open',
  created_by        uuid references public.app_users (id),
  created_at        timestamptz not null default now(),
  closed_at         timestamptz,
  closed_by         uuid references public.app_users (id),
  discrepancy_cents integer,
  close_note        text,
  reopened_at       timestamptz,
  reopened_by       uuid references public.app_users (id)
);

create index if not exists sessions_played_on_idx on public.sessions (played_on desc, created_at desc);
create index if not exists sessions_status_idx on public.sessions (status);

-- -----------------------------------------------------------------------------
-- session_players — who takes part; position = join order (settlement tie-break)
-- -----------------------------------------------------------------------------

create table if not exists public.session_players (
  session_id uuid not null references public.sessions (id) on delete cascade,
  player_id  uuid not null references public.players (id) on delete restrict,
  position   integer not null,
  added_by   uuid references public.app_users (id),
  added_at   timestamptz not null default now(),
  primary key (session_id, player_id),
  unique (session_id, position)
);

create index if not exists session_players_player_idx on public.session_players (player_id);

-- -----------------------------------------------------------------------------
-- entries — buy_in / cash_out / payout
-- -----------------------------------------------------------------------------

create table if not exists public.entries (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null,
  player_id    uuid not null,
  type         public.entry_type not null,
  amount_cents integer not null,
  payment      public.payment_method,
  note         text check (length(note) <= 200),
  created_by   uuid references public.app_users (id),
  created_at   timestamptz not null default now(),
  foreign key (session_id, player_id)
    references public.session_players (session_id, player_id) on delete cascade,
  -- payment is set exactly for buy_in
  constraint entries_payment_only_for_buy_in
    check ((type = 'buy_in') = (payment is not null)),
  -- a cash_out may be 0 (busted player), buy_in and payout must be positive
  constraint entries_amount_sign
    check ((type = 'cash_out' and amount_cents >= 0)
        or (type <> 'cash_out' and amount_cents > 0))
);

-- exactly one cash_out per player and session
create unique index if not exists entries_one_cash_out_per_player
  on public.entries (session_id, player_id) where type = 'cash_out';

create index if not exists entries_session_created_idx
  on public.entries (session_id, created_at);

create index if not exists entries_session_player_idx
  on public.entries (session_id, player_id);

-- -----------------------------------------------------------------------------
-- settlements — frozen result of computeSettlement() (docs/SETTLEMENT.md).
-- Written only by the RPC close_session, never recomputed for display.
-- -----------------------------------------------------------------------------

create table if not exists public.settlements (
  session_id                    uuid primary key references public.sessions (id) on delete cascade,
  algorithm_version             integer not null,
  computed_at                   timestamptz not null default now(),
  computed_by                   uuid references public.app_users (id),
  total_buy_in_cents            integer not null,
  total_stack_cents             integer not null,
  discrepancy_cents             integer not null,
  cash_box_start_cents          integer not null,
  cash_box_after_payouts_cents  integer not null,
  unallocated_cash_cents        integer not null,
  uncovered_claims_cents        integer not null
);

-- one row per participant; column names mirror SettlementLine in docs/SETTLEMENT.md
create table if not exists public.settlement_lines (
  session_id         uuid not null references public.settlements (session_id) on delete cascade,
  player_id          uuid not null references public.players (id),
  position           integer not null,
  cash_in_cents      integer not null,
  credit_in_cents    integer not null,
  stack_cents        integer not null,
  payout_cents       integer not null,
  is_cash_player     boolean not null,
  claim_cents        integer not null,
  cash_tier1_cents   integer not null,
  cash_tier2_cents   integer not null,
  cash_tier3_cents   integer not null,
  cash_from_box_cents integer not null,
  net_result_cents   integer not null,
  residual_cents     integer not null,
  primary key (session_id, player_id)
);

create index if not exists settlement_lines_player_idx on public.settlement_lines (player_id);

-- "from schuldet to amount"; position = order produced by the greedy algorithm
create table if not exists public.settlement_transfers (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.settlements (session_id) on delete cascade,
  position       integer not null,
  from_player_id uuid not null references public.players (id),
  to_player_id   uuid not null references public.players (id),
  amount_cents   integer not null check (amount_cents > 0),
  constraint settlement_transfers_not_self check (from_player_id <> to_player_id),
  unique (session_id, position)
);

create index if not exists settlement_transfers_session_idx
  on public.settlement_transfers (session_id, position);

-- -----------------------------------------------------------------------------
-- settings — key/value, currently only the buy-in quick amounts
-- -----------------------------------------------------------------------------

create table if not exists public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users (id)
);

insert into public.settings (key, value)
values ('quick_amounts_cents', '[5000,10000,20000]'::jsonb)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- audit_log — append only, written by trigger, readable by every logged-in user
-- -----------------------------------------------------------------------------

create table if not exists public.audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  user_id    uuid,
  user_email text,
  table_name text not null,
  row_id     text not null,
  action     text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data   jsonb,
  new_data   jsonb,
  session_id uuid
);

create index if not exists audit_log_at_idx on public.audit_log (at desc, id desc);
create index if not exists audit_log_session_idx on public.audit_log (session_id, at desc);
create index if not exists audit_log_user_idx on public.audit_log (user_id, at desc);
create index if not exists audit_log_table_idx on public.audit_log (table_name, at desc);

comment on table public.audit_log is
  'Nur Trigger schreiben hier. Kein Update, kein Delete, fuer keine Rolle (SPEC 4).';
