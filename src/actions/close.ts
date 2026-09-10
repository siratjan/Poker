'use server';

import { revalidatePath } from 'next/cache';
import type { PostgrestError } from '@supabase/supabase-js';
import { actionResult, AppError, type ActionResult } from '@/lib/actions/result';
import { requireAdmin, requireEditor, requireUser } from '@/lib/auth/requireRole';
import { isAdmin } from '@/lib/auth/roles';
import { messageForDbErrorCode, translateDbError } from '@/lib/errors/de';
import { computeSettlement, SettlementError } from '@/lib/settlement';
import { toSettlementPayload } from '@/lib/settlement/toPersist';
import { verifySettlement } from '@/lib/settlement/verify';
import { verifyManual } from '@/lib/settlement/verifyManual';
import type { FrozenSettlement, SettlementParticipant } from '@/lib/settlement/types';
import { createClient } from '@/lib/supabase/server';
import {
  closeSessionManualSchema,
  closeSessionSchema,
  MIN_NOTE_LENGTH,
  previewSettlementSchema,
  reopenSessionSchema,
} from '@/lib/validation/close';
import { parseInput } from '@/lib/validation/parse';

/**
 * Closing, reopening and previewing a settlement (docs/ARBEITSPAKETE.md WP6,
 * step 1).
 *
 * The one rule that matters here: **the settlement is always computed on the
 * server, from `settlement_input`.** No number the browser sends is ever
 * forwarded to `close_session`; the client only supplies the session id and, for
 * a session with a difference, the admin's comment. `settlement_input` is
 * `security invoker`, so RLS decides what may be read, and the RPC checks the
 * payload against `entries` a second time.
 *
 * Two invariants of `docs/SETTLEMENT.md` are *not* checked by the database —
 * the proportional truncation of stage 1 (invariant 5) and the coverage of each
 * individual debtor in the transfer list (see
 * `tests/gaby/wp1-close-session.gaby.test.ts`). `verifySettlement()` closes both
 * gaps before the RPC is called: a settlement that fails it is never written,
 * because a closed session can never be corrected (SPEC §5.6, CLAUDE.md).
 */

const NO_PARTICIPANTS = 'Diese Session hat noch keine Teilnehmer.';
const NOT_COMPUTABLE =
  'Die Abrechnung lässt sich mit diesen Daten nicht berechnen. Bitte prüfe Stacks und Auszahlungen.';
const MANUAL_INVALID =
  'Die manuell bearbeitete Abrechnung ist nicht zulässig. Bitte prüfe Beträge und Paarungen: ' +
  'Überweisungen größer als 0 €, keine Selbst-Überweisung, nur echte Teilnehmer.';

/** One participant as `settlement_input` returns him. */
type SettlementInputRow = {
  player_id: string;
  player_name: string;
  position: number;
  cash_in_cents: number;
  credit_in_cents: number;
  stack_cents: number;
  payout_cents: number;
  has_cash_out: boolean;
};

/** Everything the close area needs to render its checklist and preview. */
export type SettlementPreview = {
  /** Every participant has a stack, and there is at least one participant. */
  canClose: boolean;
  participantCount: number;
  /** Participants that are still playing, in join order. */
  missingCashOuts: { playerId: string; name: string }[];
  /** `playerId` -> display name, for the settlement view and the share text. */
  names: Record<string, string>;
  totalBuyInCents: number;
  totalStackCents: number;
  discrepancyCents: number;
  /** The settlement that would be frozen right now, or `null` if not closable. */
  settlement: FrozenSettlement | null;
};

/**
 * The settlement as the server would compute it this second. Read-only, so
 * every logged-in user (viewer included) may ask; the write actions below guard
 * the role again.
 */
export async function previewSettlement(input: unknown): Promise<ActionResult<SettlementPreview>> {
  return actionResult(async () => {
    await requireUser();
    const { sessionId } = parseInput(previewSettlementSchema, input);

    const rows = await loadSettlementInput(sessionId);
    return buildPreview(rows);
  });
}

/**
 * Closes a session and freezes its settlement (SPEC §5.4–5.6).
 *
 * A difference needs an admin *and* a comment. That is checked here for a
 * readable message and again by `close_session`, which is the real boundary.
 */
export async function closeSession(
  input: unknown,
): Promise<ActionResult<{ discrepancyCents: number }>> {
  return actionResult(async () => {
    const user = await requireEditor();
    const { sessionId, note } = parseInput(closeSessionSchema, input);

    const rows = await loadSettlementInput(sessionId);
    if (rows.length === 0) throw new AppError('NO_PARTICIPANTS', NO_PARTICIPANTS);

    const missing = rows.filter((row) => !row.has_cash_out);
    if (missing.length > 0) {
      throw new AppError('MISSING_CASH_OUT', missingCashOutMessage(missing));
    }

    const settlement = computeOrFail(rows);

    // The only defence for invariant 5 and for per-debtor coverage.
    const problems = verifySettlement(settlement);
    if (problems.length > 0) {
      console.error('[close] settlement failed verification:', sessionId, problems);
      throw new AppError('SETTLEMENT_INVARIANT', messageForDbErrorCode('SETTLEMENT_INVARIANT'));
    }

    if (settlement.discrepancy !== 0) {
      const noteIsUsable = note !== null && note.length >= MIN_NOTE_LENGTH;
      if (!isAdmin(user.role) || !noteIsUsable) {
        throw new AppError(
          'DISCREPANCY_REQUIRES_ADMIN_NOTE',
          messageForDbErrorCode('DISCREPANCY_REQUIRES_ADMIN_NOTE'),
        );
      }
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc('close_session', {
      p_session_id: sessionId,
      p_settlement: toSettlementPayload(settlement),
      p_note: note,
    });
    if (error !== null) throw mapDbError(error, 'Session abschließen');

    revalidateSession(sessionId);
    return { discrepancyCents: settlement.discrepancy };
  });
}

/**
 * Closes a session with a **hand-edited** settlement (docs/ARBEITSPAKETE.md
 * WP11, docs/SPEC.md §6.1). Admin only, `note` mandatory.
 *
 * This is the deliberate side path that breaks the „always computed on the
 * server“ rule of {@link closeSession}: the numbers the admin entered are passed
 * through unchanged. It never touches `close_session`; it calls
 * `close_session_manual`, which recomputes **nothing** and only enforces basic
 * integrity. `verifyManual` mirrors that integrity here for a readable message,
 * but the RPC stays the boundary.
 */
export async function closeSessionManual(
  input: unknown,
): Promise<ActionResult<{ discrepancyCents: number }>> {
  return actionResult(async () => {
    await requireAdmin();
    const { sessionId, note, settlement } = parseInput(closeSessionManualSchema, input);

    // The participants ground the override: only real, fully cashed-out players.
    const rows = await loadSettlementInput(sessionId);
    if (rows.length === 0) throw new AppError('NO_PARTICIPANTS', NO_PARTICIPANTS);

    const missing = rows.filter((row) => !row.has_cash_out);
    if (missing.length > 0) {
      throw new AppError('MISSING_CASH_OUT', missingCashOutMessage(missing));
    }

    const participantIds = new Set(rows.map((row) => row.player_id));
    const manual: FrozenSettlement = { ...settlement, isManual: true };

    // Basic integrity (SPEC §6.1). No reconciliation against buy-ins/stacks.
    const problems = verifyManual(manual, participantIds);
    if (problems.length > 0) {
      console.error('[close] manual settlement failed basic integrity:', sessionId, problems);
      throw new AppError('MANUAL_SETTLEMENT_INVALID', MANUAL_INVALID);
    }

    const supabase = await createClient();
    const { error } = await supabase.rpc('close_session_manual', {
      p_session_id: sessionId,
      p_settlement: toSettlementPayload(manual),
      p_note: note,
    });
    if (error !== null) throw mapDbError(error, 'Session manuell abschließen');

    revalidateSession(sessionId);
    return { discrepancyCents: manual.discrepancy };
  });
}

/**
 * Reopens a closed session (admin only, SPEC §3). The stored settlement is
 * deleted by the RPC; the reason is appended to `close_note` and the old values
 * stay in the audit log.
 */
export async function reopenSession(input: unknown): Promise<ActionResult<{ sessionId: string }>> {
  return actionResult(async () => {
    await requireAdmin();
    const { sessionId, reason } = parseInput(reopenSessionSchema, input);

    const supabase = await createClient();
    const { error } = await supabase.rpc('reopen_session', {
      p_session_id: sessionId,
      p_reason: reason,
    });
    if (error !== null) throw mapDbError(error, 'Session wieder öffnen');

    revalidateSession(sessionId);
    return { sessionId };
  });
}

/** Aggregated participants of the session, straight from the database. */
async function loadSettlementInput(sessionId: string): Promise<SettlementInputRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('settlement_input', { p_session_id: sessionId });

  if (error !== null) throw mapDbError(error, 'Abrechnung lesen');
  return data ?? [];
}

/** Checklist, names and — if everybody has a stack — the settlement itself. */
function buildPreview(rows: readonly SettlementInputRow[]): SettlementPreview {
  const sorted = [...rows].sort((a, b) => a.position - b.position);

  const totalBuyInCents = sorted.reduce(
    (acc, row) => acc + row.cash_in_cents + row.credit_in_cents,
    0,
  );
  const totalStackCents = sorted.reduce((acc, row) => acc + row.stack_cents, 0);
  const missingCashOuts = sorted
    .filter((row) => !row.has_cash_out)
    .map((row) => ({ playerId: row.player_id, name: row.player_name }));
  const canClose = sorted.length > 0 && missingCashOuts.length === 0;

  return {
    canClose,
    participantCount: sorted.length,
    missingCashOuts,
    names: Object.fromEntries(sorted.map((row) => [row.player_id, row.player_name])),
    totalBuyInCents,
    totalStackCents,
    discrepancyCents: totalStackCents - totalBuyInCents,
    // Without a stack for everybody there is no settlement to show: a missing
    // cash-out would silently count as „stack 0“ and invent a loss.
    settlement: canClose ? computeOrFail(sorted) : null,
  };
}

/** `computeSettlement` with its precondition errors turned into German. */
function computeOrFail(rows: readonly SettlementInputRow[]): FrozenSettlement {
  try {
    return computeSettlement(rows.map(toParticipant));
  } catch (error) {
    if (error instanceof SettlementError) {
      console.error('[close] computeSettlement rejected the input:', error.code, error.message);
      throw new AppError(error.code, NOT_COMPUTABLE);
    }
    throw error;
  }
}

function toParticipant(row: SettlementInputRow): SettlementParticipant {
  return {
    playerId: row.player_id,
    name: row.player_name,
    position: row.position,
    cashIn: row.cash_in_cents,
    creditIn: row.credit_in_cents,
    stack: row.stack_cents,
    payout: row.payout_cents,
  };
}

/** „Es fehlt noch der Stack von Ali und Ben.“ */
function missingCashOutMessage(missing: readonly SettlementInputRow[]): string {
  const names = missing.map((row) => row.player_name);
  if (names.length === 1) return `Es fehlt noch der Stack von ${names[0]}.`;

  const last = names[names.length - 1];
  return `Es fehlen noch die Stacks von ${names.slice(0, -1).join(', ')} und ${last}.`;
}

/**
 * German message for a database error, or a rethrow for the generic handler in
 * `actionResult` (which logs it and answers with `UNEXPECTED`).
 */
function mapDbError(error: PostgrestError, context: string): AppError {
  const translated = translateDbError(error);
  if (translated !== null) return translated;

  console.error(`[close] ${context}:`, error);
  throw new Error(error.message);
}

function revalidateSession(sessionId: string): void {
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath('/');
}
