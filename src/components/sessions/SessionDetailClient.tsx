'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addBuyIn,
  addCashOut,
  addParticipant,
  addParticipantByNewPlayer,
  addPayout,
  deleteEntry,
  removeParticipant,
  updateCashOut,
} from '@/actions/entries';
import { deleteOpenSession } from '@/actions/sessions';
import { CloseSessionPanel } from '@/components/sessions/CloseSessionPanel';
import { ClosedSessionSection } from '@/components/sessions/ClosedSessionSection';
import { HistoryList } from '@/components/sessions/HistoryList';
import { ParticipantCard } from '@/components/sessions/ParticipantCard';
import {
  AddParticipantSheet,
  BuyInSheet,
  CashOutSheet,
  ConfirmDeleteSheet,
  ParticipantActionsSheet,
  PayoutSheet,
} from '@/components/sessions/EntrySheets';
import { useReportRealtimeStatus } from '@/components/app/ConnectionProvider';
import { useSessionRealtime } from '@/components/sessions/useSessionRealtime';
import { SessionStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';
import type { ActionResult } from '@/lib/actions/result';
import { formatCents } from '@/lib/money';
import type { PlayerListItem } from '@/lib/queries/players';
import type { SessionDetail } from '@/lib/queries/sessionDetail';
import {
  deriveSession,
  previewCashEntitlement,
  sortEntriesNewestFirst,
  type DerivedParticipant,
  type PaymentMethod,
  type SessionEntry,
} from '@/lib/session/derive';
import { buyInToast, describeEntry, formatSignedCents } from '@/lib/session/labels';
import { formatBerlinDateTime, formatPlayedOn } from '@/lib/time';

/**
 * Session detail (docs/ARBEITSPAKETE.md WP5, step 4). Holds the sheet state,
 * the optimistic buy-in and the realtime subscription; the data itself comes
 * pre-rendered from the server component and is refreshed with
 * `router.refresh()` after every write and every realtime event.
 *
 * Roles: a viewer sees everything but no action button, and a closed session is
 * read-only for everybody. That is presentation — RLS and the triggers are what
 * actually enforce it (CLAUDE.md).
 */

/** A buy-in that is on screen but not confirmed by the server yet. */
type PendingBuyIn = {
  tempId: string;
  playerId: string;
  amountCents: number;
  payment: PaymentMethod;
  createdAt: string;
  /** Id assigned by the database once the action returned. */
  realId: string | null;
};

/** How long a confirmed optimistic row is kept before it is forgotten. */
const DROP_PENDING_MS = 4000;

type SheetState =
  | { kind: 'none' }
  | { kind: 'actions'; playerId: string }
  | { kind: 'buyIn'; playerId: string }
  | { kind: 'cashOut'; playerId: string }
  | { kind: 'editStack'; playerId: string }
  | { kind: 'payout'; playerId: string }
  | { kind: 'addParticipant' }
  | { kind: 'confirmRemove'; playerId: string }
  | { kind: 'confirmDeleteEntry'; entry: SessionEntry }
  | { kind: 'confirmDeleteSession' };

export function SessionDetailClient({
  detail,
  allPlayers,
  playersLoadFailed,
  canEdit,
  isAdmin,
}: {
  detail: SessionDetail;
  /** Every player, for the „Teilnehmer hinzufügen“ sheet. */
  allPlayers: PlayerListItem[];
  /** The player list could not be read — the sheet says so (Gaby WP5, F6). */
  playersLoadFailed: boolean;
  canEdit: boolean;
  /** Only an admin may close with a difference or reopen (SPEC §3). */
  isAdmin: boolean;
}) {
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  const [pending, setPending] = useState<PendingBuyIn[]>([]);
  const [sheet, setSheet] = useState<SheetState>({ kind: 'none' });

  const { session, participants, entries, quickAmountsCents } = detail;
  const isOpen = session.status === 'open';
  const mayAct = canEdit && isOpen;

  const refresh = useCallback(() => router.refresh(), [router]);
  const realtimeStatus = useSessionRealtime(session.id, refresh);
  // The status feeds the one banner in the app shell (WP9, step 2) instead of a
  // second notice on this screen; „Verbindung getrennt“ plus „Neu laden“ now
  // live in `ConnectionBanner`, where being offline outranks a dead channel.
  useReportRealtimeStatus(realtimeStatus);

  // Timers that drop a confirmed optimistic row; cleared on unmount so no
  // state is written into a component that is gone.
  const dropTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const timers = dropTimers.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  // A pending buy-in that the server data already contains is dropped right
  // here, so it can never be counted twice for one render.
  const visiblePending = useMemo(() => {
    const known = new Set(entries.map((entry) => entry.id));
    return pending.filter((item) => item.realId === null || !known.has(item.realId));
  }, [entries, pending]);

  const mergedEntries = useMemo<SessionEntry[]>(
    () => [...entries, ...visiblePending.map(toEntry)],
    [entries, visiblePending],
  );

  const { participants: derived, totals } = useMemo(
    () => deriveSession(participants, mergedEntries),
    [participants, mergedEntries],
  );

  const history = useMemo(() => sortEntriesNewestFirst(mergedEntries), [mergedEntries]);

  // Ids of rows the server has not confirmed yet: they carry a `pending-…` id,
  // which no delete could ever hit (Gaby WP5-F2).
  const pendingIds = useMemo<ReadonlySet<string>>(
    () => new Set(visiblePending.filter((item) => item.realId === null).map((item) => item.tempId)),
    [visiblePending],
  );

  // `playerId` -> name, for the settlement view and the share text.
  const names = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        participants.map((participant) => [participant.playerId, participant.name]),
      ),
    [participants],
  );

  const nameFor = useCallback(
    (playerId: string) =>
      participants.find((participant) => participant.playerId === playerId)?.name ?? 'Unbekannt',
    [participants],
  );

  const participantIds = new Set(participants.map((participant) => participant.playerId));
  const addablePlayers = allPlayers.filter((player) => !participantIds.has(player.id));

  const selected = selectedParticipant(derived, sheet);
  const closeSheet = useCallback(() => setSheet({ kind: 'none' }), []);

  /**
   * Runs an action and shows its German message. Refreshes in both cases: a
   * rejected write almost always means somebody else changed the session
   * (`SESSION_CLOSED`, `PLAYER_ALREADY_CASHED_OUT`, `PAYOUT_EXCEEDS_CASHBOX`),
   * so the screen has to catch up with the toast (Gaby WP5-F4).
   */
  async function run<T>(
    action: () => Promise<ActionResult<T>>,
    success?: string,
  ): Promise<boolean> {
    const result = await action();
    if (!result.ok) {
      showError(result.error.message);
      refresh();
      return false;
    }
    if (success !== undefined) showSuccess(success);
    refresh();
    return true;
  }

  /**
   * Deleting a whole session is admin-only and only possible while it is open
   * and unsettled (RLS enforces that; the UI just hides the button otherwise).
   * On success the session is gone, so we leave the page instead of refreshing
   * it — a `router.refresh()` here would render a 404.
   */
  async function deleteSession(): Promise<boolean> {
    const result = await deleteOpenSession(session.id);
    if (!result.ok) {
      showError(result.error.message);
      refresh();
      return false;
    }
    showSuccess('Session gelöscht');
    router.push('/');
    return true;
  }

  /**
   * Buy-in is the only optimistic action (WP5, step 5): it is the frequent one
   * at the table. The card updates immediately; on failure the pending row is
   * removed again and the toast explains why.
   */
  async function submitBuyIn(
    participant: DerivedParticipant,
    amountCents: number,
    payment: PaymentMethod,
  ): Promise<boolean> {
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPending((current) => [
      ...current,
      {
        tempId,
        playerId: participant.playerId,
        amountCents,
        payment,
        createdAt: new Date().toISOString(),
        realId: null,
      },
    ]);

    const result = await addBuyIn({
      sessionId: session.id,
      playerId: participant.playerId,
      amountCents,
      payment,
    });

    if (!result.ok) {
      setPending((current) => current.filter((item) => item.tempId !== tempId));
      showError(result.error.message);
      // Same reasoning as in `run`: the rejection usually comes from a change
      // somebody else made (Gaby WP5-F4).
      refresh();
      return false;
    }

    const realId = result.data.id;
    setPending((current) =>
      current.map((item) => (item.tempId === tempId ? { ...item, realId } : item)),
    );
    // The row is hidden as soon as the refreshed server data contains `realId`
    // (see `visiblePending`); this timer only clears the bookkeeping entry.
    dropTimers.current.push(
      setTimeout(() => {
        setPending((current) => current.filter((item) => item.tempId !== tempId));
      }, DROP_PENDING_MS),
    );
    showSuccess(buyInToast(amountCents, payment, participant.name));
    refresh();
    return true;
  }

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{formatPlayedOn(session.playedOn)}</h1>
          <SessionStatusBadge status={session.status} />
        </div>
        {session.name ? <p className="text-sm opacity-80">{session.name}</p> : null}
        {isOpen ? null : <ClosedNotice detail={detail} />}
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Tile label="Buy-ins gesamt" value={formatCents(totals.totalBuyIn)} />
        <Tile
          label="davon bar / Liste"
          value={`${formatCents(totals.totalCash)} / ${formatCents(totals.totalCredit)}`}
        />
        <Tile label="Kasse aktuell" value={formatCents(totals.cashBox)} />
        <Tile
          label="Stacks gezählt"
          value={`${totals.stackCount} von ${totals.participantCount}`}
          hint={
            totals.canClose
              ? `Differenz ${formatSignedCents(totals.discrepancy)}`
              : `${totals.openParticipants} spielen noch`
          }
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Teilnehmer</h2>
          {mayAct ? (
            <Button variant="secondary" onClick={() => setSheet({ kind: 'addParticipant' })}>
              Teilnehmer hinzufügen
            </Button>
          ) : null}
        </div>

        {derived.length === 0 ? (
          <EmptyState
            title="Noch keine Teilnehmer."
            description={
              mayAct
                ? 'Füge die Spieler hinzu, die heute am Tisch sitzen.'
                : 'Ein Bearbeiter kann Spieler hinzufügen.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {derived.map((participant) => (
              <li key={participant.playerId}>
                <ParticipantCard
                  participant={participant}
                  interactive={mayAct}
                  pendingBuyIns={
                    visiblePending.filter((item) => item.playerId === participant.playerId).length
                  }
                  onPrimary={() =>
                    setSheet(
                      participant.stack === null
                        ? { kind: 'buyIn', playerId: participant.playerId }
                        : { kind: 'actions', playerId: participant.playerId },
                    )
                  }
                  onMenu={() => setSheet({ kind: 'actions', playerId: participant.playerId })}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {isOpen && canEdit ? (
        <CloseSessionPanel
          sessionId={session.id}
          participants={derived}
          totals={totals}
          names={names}
          isAdmin={isAdmin}
          onClosed={refresh}
        />
      ) : null}

      {isOpen ? null : (
        <ClosedSessionSection
          sessionId={session.id}
          playedOn={session.playedOn}
          name={session.name}
          settlement={detail.settlement}
          names={names}
          isAdmin={isAdmin}
          onReopened={refresh}
        />
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Verlauf</h2>
        <HistoryList
          entries={history}
          nameFor={nameFor}
          canEdit={mayAct}
          pendingIds={pendingIds}
          onDelete={(entry) => {
            if (pendingIds.has(entry.id)) return;
            setSheet({ kind: 'confirmDeleteEntry', entry });
          }}
        />
      </div>

      {isOpen && isAdmin ? (
        <div className="flex flex-col gap-1 border-t border-black/10 pt-4 dark:border-white/10">
          <button
            type="button"
            onClick={() => setSheet({ kind: 'confirmDeleteSession' })}
            className="min-h-[44px] self-start text-sm font-medium text-red-600 dark:text-red-400"
          >
            Session löschen
          </button>
          <p className="text-xs opacity-60">
            Nur solange die Session offen ist. Löscht sie mit allen Einträgen endgültig.
          </p>
        </div>
      ) : null}

      {sheet.kind === 'actions' && selected !== null ? (
        <ParticipantActionsSheet
          participant={selected}
          onBuyIn={() => setSheet({ kind: 'buyIn', playerId: selected.playerId })}
          onCashOut={() => setSheet({ kind: 'cashOut', playerId: selected.playerId })}
          onEditStack={() => setSheet({ kind: 'editStack', playerId: selected.playerId })}
          onPayout={() => setSheet({ kind: 'payout', playerId: selected.playerId })}
          onRemove={() => setSheet({ kind: 'confirmRemove', playerId: selected.playerId })}
          onClose={closeSheet}
        />
      ) : null}

      {sheet.kind === 'buyIn' && selected !== null ? (
        <BuyInSheet
          participant={selected}
          quickAmountsCents={quickAmountsCents}
          onSubmit={(amountCents, payment) => submitBuyIn(selected, amountCents, payment)}
          onClose={closeSheet}
        />
      ) : null}

      {sheet.kind === 'cashOut' && selected !== null ? (
        <CashOutSheet
          participant={selected}
          mode="create"
          onSubmit={(amountCents) =>
            run(
              () =>
                addCashOut({
                  sessionId: session.id,
                  playerId: selected.playerId,
                  amountCents,
                }),
              `Stack ${formatCents(amountCents)} für ${selected.name} eingetragen`,
            )
          }
          onClose={closeSheet}
        />
      ) : null}

      {sheet.kind === 'editStack' && selected !== null ? (
        <CashOutSheet
          participant={selected}
          mode="edit"
          onSubmit={(amountCents) => {
            const cashOutId = cashOutEntryId(entries, selected.playerId);
            if (cashOutId === null) {
              showError('Für diesen Spieler gibt es keinen Stack mehr.');
              refresh();
              return Promise.resolve(false);
            }
            return run(
              () => updateCashOut({ id: cashOutId, sessionId: session.id, amountCents }),
              `Stack von ${selected.name} auf ${formatCents(amountCents)} geändert`,
            );
          }}
          onClose={closeSheet}
        />
      ) : null}

      {sheet.kind === 'payout' && selected !== null ? (
        <PayoutSheet
          participant={selected}
          cashBoxCents={totals.cashBox}
          preview={previewCashEntitlement(derived, selected.playerId)}
          onSubmit={(amountCents) =>
            run(
              () =>
                addPayout({
                  sessionId: session.id,
                  playerId: selected.playerId,
                  amountCents,
                }),
              `${formatCents(amountCents)} bar an ${selected.name} ausgezahlt`,
            )
          }
          onClose={closeSheet}
        />
      ) : null}

      {sheet.kind === 'addParticipant' ? (
        <AddParticipantSheet
          players={addablePlayers}
          loadFailed={playersLoadFailed}
          onAddExisting={(playerId) =>
            run(() => addParticipant({ sessionId: session.id, playerId }), 'Teilnehmer hinzugefügt')
          }
          onAddNew={(name) =>
            run(
              () => addParticipantByNewPlayer({ sessionId: session.id, name }),
              'Spieler angelegt und hinzugefügt',
            )
          }
          onClose={closeSheet}
        />
      ) : null}

      {sheet.kind === 'confirmRemove' && selected !== null ? (
        <ConfirmDeleteSheet
          title={`${selected.name} entfernen?`}
          description="Der Spieler wird nur aus dieser Session entfernt. Er bleibt in der Spielerliste."
          confirmLabel="Entfernen"
          pendingLabel="Entfernt …"
          onConfirm={() =>
            run(
              () => removeParticipant({ sessionId: session.id, playerId: selected.playerId }),
              'Teilnehmer entfernt',
            )
          }
          onClose={closeSheet}
        />
      ) : null}

      {sheet.kind === 'confirmDeleteEntry' ? (
        <ConfirmDeleteSheet
          title="Eintrag löschen?"
          description={`${nameFor(sheet.entry.playerId)} · ${describeEntry(sheet.entry)}. Der Eintrag bleibt im Audit-Log sichtbar.`}
          onConfirm={() =>
            run(
              () => deleteEntry({ id: sheet.entry.id, sessionId: session.id }),
              'Eintrag gelöscht',
            )
          }
          onClose={closeSheet}
        />
      ) : null}

      {sheet.kind === 'confirmDeleteSession' ? (
        <ConfirmDeleteSheet
          title="Session löschen?"
          description="Die ganze Session mit allen Buy-ins und Einträgen wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden."
          confirmLabel="Löschen"
          pendingLabel="Löscht …"
          onConfirm={deleteSession}
          onClose={closeSheet}
        />
      ) : null}
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="flex flex-col gap-0.5 px-4 py-3">
      <span className="text-xs opacity-60">{label}</span>
      <span className="text-base font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-xs opacity-60">{hint}</span> : null}
    </Card>
  );
}

/**
 * Head of a closed session: when, by whom, difference and comment. The frozen
 * settlement below it is rendered by `ClosedSessionSection`.
 */
function ClosedNotice({ detail }: { detail: SessionDetail }) {
  const { session } = detail;

  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-black/5 px-4 py-3 text-sm dark:bg-white/10">
      <span>
        Abgeschlossen
        {session.closedAt === null ? '' : ` am ${formatBerlinDateTime(session.closedAt)}`}
        {session.closedByName === null ? '' : ` von ${session.closedByName}`}.
      </span>
      {session.discrepancyCents !== null && session.discrepancyCents !== 0 ? (
        <span className="tabular-nums text-red-700 dark:text-red-400">
          Differenz {formatSignedCents(session.discrepancyCents)}
        </span>
      ) : null}
      {detail.settlement?.isManual ? (
        <span className="font-medium">Abrechnung manuell bearbeitet</span>
      ) : null}
      {session.closeNote ? (
        <span className="whitespace-pre-line opacity-80">{session.closeNote}</span>
      ) : null}
      <span className="opacity-70">
        Nichts an dieser Session lässt sich noch ändern. Die Abrechnung unten ist die
        gespeicherte.
      </span>
    </div>
  );
}

/** The participant a sheet is about, or `null` if the sheet has none. */
function selectedParticipant(
  participants: readonly DerivedParticipant[],
  sheet: SheetState,
): DerivedParticipant | null {
  if (!('playerId' in sheet)) return null;
  return participants.find((participant) => participant.playerId === sheet.playerId) ?? null;
}

/** Id of the `cash_out` entry of a player, needed to change the stack. */
function cashOutEntryId(entries: readonly SessionEntry[], playerId: string): string | null {
  const found = entries.find((entry) => entry.type === 'cash_out' && entry.playerId === playerId);
  return found?.id ?? null;
}

/** A pending buy-in rendered like a real entry until the server confirms it. */
function toEntry(item: PendingBuyIn): SessionEntry {
  return {
    id: item.realId ?? item.tempId,
    playerId: item.playerId,
    type: 'buy_in',
    amountCents: item.amountCents,
    payment: item.payment,
    createdAt: item.createdAt,
    createdByName: null,
  };
}
