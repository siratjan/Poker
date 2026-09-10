-- =============================================================================
-- 0008_manual_settlement.sql — manual settlement override in the preview (WP11)
-- =============================================================================
-- Requires 0001..0003. Safe to run repeatedly (add column if not exists /
-- create or replace / drop trigger if exists).
--
-- docs/SPEC.md §6.1 / docs/SETTLEMENT.md "Manuelle Übersteuerung": an ADMIN may
-- override the settlement of an OPEN session by hand in the live preview. The
-- automatic path (close_session, 0002) is untouched and keeps recomputing and
-- verifying everything. This file adds a deliberate, auditable side path that
-- recomputes NOTHING and only enforces basic integrity.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- settlements.is_manual — marks a hand-edited, non-reproducible settlement
-- -----------------------------------------------------------------------------

alter table public.settlements
  add column if not exists is_manual boolean not null default false;

comment on column public.settlements.is_manual is
  'true = von einem Admin manuell übersteuert (SPEC 6.1), nicht aus entries reproduzierbar.';

-- -----------------------------------------------------------------------------
-- Audit for the settlement rows (SPEC 4: "lückenloses Audit-Log").
--
-- Until now only the `settlements` head was audited (0002 audit_settlements),
-- not settlement_lines / settlement_transfers. For a manual override the edited
-- amounts live in those two tables, so they must appear in the log. Auditing
-- them for the automatic path too is a bonus (the log is now complete for both);
-- the extra rows per close are acceptable and reuse the generic trigger.
-- -----------------------------------------------------------------------------

drop trigger if exists audit_settlement_lines on public.settlement_lines;
create trigger audit_settlement_lines
  after insert or update or delete on public.settlement_lines
  for each row execute function public.audit_row_change('session_id', 'player_id');

drop trigger if exists audit_settlement_transfers on public.settlement_transfers;
create trigger audit_settlement_transfers
  after insert or update or delete on public.settlement_transfers
  for each row execute function public.audit_row_change('id');

-- -----------------------------------------------------------------------------
-- close_session_manual — freezes a hand-edited settlement and closes the session.
--
-- Separate RPC from close_session on purpose (WP11: "sauber getrennt, nicht
-- heimlich"): the automatic path stays byte-for-byte as in WP6. Here the JSON is
-- taken AS GIVEN — no recompute from entries, none of the stage/coverage
-- invariants of docs/SETTLEMENT.md. What remains, and only this:
--   * admin only (SPEC 6.1),
--   * p_note (Begründung) mandatory,
--   * session exists and is open, has participants, all cashed out,
--   * exactly one line per participant, every line/transfer a real participant,
--   * cashFromBox >= 0, all line amounts present integers,
--   * transfer amount > 0 and from <> to (DB check constraints on the table).
-- Header *_cents are copied from p_settlement, not recomputed.
-- -----------------------------------------------------------------------------

drop function if exists public.close_session_manual(uuid, jsonb, text);

create function public.close_session_manual(
  p_session_id uuid,
  p_settlement jsonb,
  p_note       text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status       public.session_status;
  v_note         text := nullif(trim(coalesce(p_note, '')), '');
  v_participants integer;
  v_lines        integer;
  v_missing      integer;
  v_discrepancy  integer;
begin
  -- manual override is admin only (SPEC 6.1); separate from the UI hiding
  if not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- the justification is mandatory (SPEC 6.1)
  if v_note is null or length(v_note) < 3 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
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

  -- ---- basic shape (no reconciliation of the amounts, SPEC 6.1) -----------
  if p_settlement is null
     or jsonb_typeof(p_settlement -> 'lines') <> 'array'
     or jsonb_typeof(coalesce(p_settlement -> 'transfers', '[]'::jsonb)) <> 'array' then
    raise exception 'SETTLEMENT_MISMATCH' using errcode = 'P0001';
  end if;

  -- header cents must be present integers; leftovers cannot be negative
  if coalesce((p_settlement ->> 'algorithmVersion')::integer, 0) < 1
     or (p_settlement ->> 'totalBuyIn')::integer          is null
     or (p_settlement ->> 'totalStack')::integer          is null
     or (p_settlement ->> 'discrepancy')::integer         is null
     or (p_settlement ->> 'cashBoxStart')::integer        is null
     or (p_settlement ->> 'cashBoxAfterPayouts')::integer is null
     or coalesce((p_settlement ->> 'unallocatedCash')::integer, -1) < 0
     or coalesce((p_settlement ->> 'uncoveredClaims')::integer, -1) < 0
     or coalesce((p_settlement ->> 'uncoveredDebts')::integer, -1) < 0 then
    raise exception 'SETTLEMENT_MISMATCH' using errcode = 'P0001';
  end if;

  v_discrepancy := (p_settlement ->> 'discrepancy')::integer;

  -- exactly one line per participant, no duplicates
  select count(distinct l."playerId") into v_lines
    from jsonb_to_recordset(p_settlement -> 'lines') as l("playerId" uuid);
  if v_lines <> v_participants
     or v_lines <> (select count(*) from jsonb_array_elements(p_settlement -> 'lines')) then
    raise exception 'SETTLEMENT_MISMATCH' using errcode = 'P0001';
  end if;

  -- every line is a real participant; cashFromBox >= 0; all line amounts present
  -- and integer. The amounts are extracted as `numeric` on purpose (Gaby round 1
  -- F2): an integer recordset column would silently ROUND a fractional JSON value
  -- (10.5 -> 11), while `<> floor(x)` rejects it instead — consistent with the
  -- header/transfer casts, which already error on a non-integer. Integer-cent is
  -- the boundary, and the DB must not round it away quietly.
  if exists (
    select 1
    from jsonb_to_recordset(p_settlement -> 'lines') as l(
      "playerId"    uuid,
      "cashIn"      numeric,
      "creditIn"    numeric,
      "stack"       numeric,
      "payout"      numeric,
      "claim"       numeric,
      "cashTier1"   numeric,
      "cashTier2"   numeric,
      "cashTier3"   numeric,
      "cashFromBox" numeric,
      "netResult"   numeric,
      "residual"    numeric
    )
    left join public.session_players sp
      on sp.session_id = p_session_id and sp.player_id = l."playerId"
    where sp.player_id is null
       or l."cashFromBox" is null or l."cashFromBox" < 0
       or l."cashIn" is null or l."creditIn" is null or l."stack" is null
       or l."payout" is null or l."claim" is null
       or l."cashTier1" is null or l."cashTier2" is null or l."cashTier3" is null
       or l."netResult" is null or l."residual" is null
       or l."cashIn"      <> floor(l."cashIn")
       or l."creditIn"    <> floor(l."creditIn")
       or l."stack"       <> floor(l."stack")
       or l."payout"      <> floor(l."payout")
       or l."claim"       <> floor(l."claim")
       or l."cashTier1"   <> floor(l."cashTier1")
       or l."cashTier2"   <> floor(l."cashTier2")
       or l."cashTier3"   <> floor(l."cashTier3")
       or l."cashFromBox" <> floor(l."cashFromBox")
       or l."netResult"   <> floor(l."netResult")
       or l."residual"    <> floor(l."residual")
  ) then
    raise exception 'SETTLEMENT_MISMATCH' using errcode = 'P0001';
  end if;

  -- ---- write, all in this transaction -------------------------------------
  insert into public.settlements (
    session_id, algorithm_version, computed_by,
    total_buy_in_cents, total_stack_cents, discrepancy_cents,
    cash_box_start_cents, cash_box_after_payouts_cents,
    unallocated_cash_cents, uncovered_claims_cents, uncovered_debts_cents,
    is_manual
  ) values (
    p_session_id,
    (p_settlement ->> 'algorithmVersion')::integer,
    auth.uid(),
    (p_settlement ->> 'totalBuyIn')::integer,
    (p_settlement ->> 'totalStack')::integer,
    v_discrepancy,
    (p_settlement ->> 'cashBoxStart')::integer,
    (p_settlement ->> 'cashBoxAfterPayouts')::integer,
    (p_settlement ->> 'unallocatedCash')::integer,
    (p_settlement ->> 'uncoveredClaims')::integer,
    (p_settlement ->> 'uncoveredDebts')::integer,
    true
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

  -- amount_cents > 0 and from <> to are enforced by the table check constraints
  insert into public.settlement_transfers (
    session_id, position, from_player_id, to_player_id, amount_cents
  )
  select p_session_id, (t.ord - 1)::integer,
         (t.elem ->> 'fromPlayerId')::uuid,
         (t.elem ->> 'toPlayerId')::uuid,
         (t.elem ->> 'amount')::integer
  from jsonb_array_elements(coalesce(p_settlement -> 'transfers', '[]'::jsonb))
       with ordinality as t(elem, ord);

  -- every transfer must reference participants of this session (no reconciliation
  -- beyond this — the direction/sum checks of close_session are intentionally gone)
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
-- Execution rights: logged-in users only (the RPC checks is_admin() itself)
-- -----------------------------------------------------------------------------

revoke all on function public.close_session_manual(uuid, jsonb, text) from public, anon;
grant execute on function public.close_session_manual(uuid, jsonb, text) to authenticated;
