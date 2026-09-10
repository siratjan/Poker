'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  closeSession,
  closeSessionManual,
  previewSettlement,
  type SettlementPreview,
} from '@/actions/close';
import { useWritesBlocked } from '@/components/app/ConnectionProvider';
import { OfflineNote } from '@/components/app/OfflineNote';
import { SettlementEditor } from '@/components/settlement/SettlementEditor';
import { SettlementView } from '@/components/settlement/SettlementView';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { formatCents, formatSignedCents } from '@/lib/money';
import { computeSettlement } from '@/lib/settlement';
import { describeDiscrepancy } from '@/lib/settlement/shareText';
import type { FrozenSettlement } from '@/lib/settlement/types';
import { MAX_NOTE_LENGTH, MIN_NOTE_LENGTH } from '@/lib/validation/close';
import type { DerivedParticipant, SessionTotals } from '@/lib/session/derive';

/**
 * The close area at the end of an open session (docs/ARBEITSPAKETE.md WP6,
 * step 2): checklist, preview of the settlement, and the button that freezes it.
 *
 * The preview here is computed in the browser from the entries that are already
 * on screen, so it follows every buy-in live. It is *not* what gets saved: the
 * confirmation sheet asks the server for its own calculation (`previewSettlement`)
 * and `closeSession` computes it a third time from `settlement_input` before it
 * writes. No number from this component ever reaches the database.
 */
export function CloseSessionPanel({
  sessionId,
  participants,
  totals,
  names,
  isAdmin,
  onClosed,
}: {
  sessionId: string;
  participants: readonly DerivedParticipant[];
  totals: SessionTotals;
  names: Readonly<Record<string, string>>;
  isAdmin: boolean;
  /** Called after a successful close, so the screen reloads from the server. */
  onClosed: () => void;
}) {
  const { showError, showSuccess } = useToast();
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  // Manual override (WP11, docs/SPEC.md §6.1): admin only, off by default.
  const [manualMode, setManualMode] = useState(false);
  const [manualSettlement, setManualSettlement] = useState<FrozenSettlement | null>(null);
  const [manualConfirming, setManualConfirming] = useState(false);

  const preview = localPreview(participants);
  const hasDiscrepancy = totals.canClose && totals.discrepancy !== 0;
  const noteIsUsable = note.trim().length >= MIN_NOTE_LENGTH;
  const canManual = isAdmin && preview !== null;

  const blocked = blockingReason({
    canClose: totals.canClose,
    hasDiscrepancy,
    isAdmin,
    noteIsUsable,
  });

  const onEditorChange = useCallback((settlement: FrozenSettlement | null) => {
    setManualSettlement(settlement);
  }, []);

  async function submitManual(manualNote: string): Promise<boolean> {
    if (manualSettlement === null) return false;
    const result = await closeSessionManual({
      sessionId,
      note: manualNote.trim(),
      settlement: manualSettlement,
    });

    if (!result.ok) {
      showError(result.error.message);
      onClosed();
      return false;
    }

    showSuccess('Session mit manuell bearbeiteter Abrechnung abgeschlossen.');
    onClosed();
    return true;
  }

  async function submit(): Promise<boolean> {
    const result = await closeSession({
      sessionId,
      note: hasDiscrepancy ? note.trim() : undefined,
    });

    if (!result.ok) {
      showError(result.error.message);
      // The rejection usually means somebody else changed the session.
      onClosed();
      return false;
    }

    showSuccess(
      result.data.discrepancyCents === 0
        ? 'Session abgeschlossen.'
        : `Session mit Differenz ${formatSignedCents(result.data.discrepancyCents)} abgeschlossen.`,
    );
    onClosed();
    return true;
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Abschluss</h2>

      <Card className="flex flex-col gap-2 px-4 py-3">
        <CheckRow
          ok={totals.canClose}
          label={`Alle Spieler haben einen Stack (${totals.stackCount}/${totals.participantCount})`}
          hint={
            totals.canClose
              ? undefined
              : missingHint(participants)
          }
        />
        <CheckRow
          ok={totals.canClose && totals.discrepancy === 0}
          neutral={!totals.canClose}
          label={
            totals.discrepancy === 0
              ? `Buy-ins ${formatCents(totals.totalBuyIn)} = Stacks ${formatCents(totals.totalStack)}`
              : `Buy-ins ${formatCents(totals.totalBuyIn)} ≠ Stacks ${formatCents(totals.totalStack)}`
          }
          hint={
            totals.discrepancy === 0
              ? undefined
              : `Differenz ${formatSignedCents(totals.discrepancy)}: ${describeDiscrepancy(totals.discrepancy)}`
          }
        />
      </Card>

      {canManual ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Abrechnungs-Modus">
          <Button
            size="md"
            variant={manualMode ? 'secondary' : 'primary'}
            aria-pressed={!manualMode}
            onClick={() => setManualMode(false)}
          >
            Automatisch
          </Button>
          <Button
            size="md"
            variant={manualMode ? 'primary' : 'secondary'}
            aria-pressed={manualMode}
            onClick={() => setManualMode(true)}
          >
            Manuell bearbeiten
          </Button>
        </div>
      ) : null}

      {preview === null ? (
        <p className="text-sm opacity-70">
          Die Vorschau erscheint, sobald alle Teilnehmer einen Stack haben.
        </p>
      ) : manualMode && canManual ? (
        <SettlementEditor base={preview} names={names} onChange={onEditorChange} />
      ) : (
        <SettlementView settlement={preview} names={names} variant="preview" />
      )}

      {manualMode && canManual ? (
        <>
          <Button
            size="lg"
            variant="danger"
            disabled={manualSettlement === null}
            onClick={() => setManualConfirming(true)}
          >
            Manuell abschließen
          </Button>
          {manualSettlement === null ? (
            <p className="text-xs opacity-70">
              Bitte fülle alle Beträge aus und wähle für jede Überweisung zwei Spieler.
            </p>
          ) : null}

          {manualConfirming ? (
            <ManualConfirmSheet
              onConfirm={submitManual}
              onClose={() => setManualConfirming(false)}
            />
          ) : null}
        </>
      ) : (
        <AutomaticClose
          hasDiscrepancy={hasDiscrepancy}
          isAdmin={isAdmin}
          note={note}
          setNote={setNote}
          blocked={blocked}
          onOpenConfirm={() => setConfirming(true)}
        />
      )}

      {confirming ? (
        <ConfirmCloseSheet
          sessionId={sessionId}
          note={hasDiscrepancy ? note.trim() : null}
          onConfirm={submit}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </div>
  );
}

/** The automatic close controls (unchanged behaviour from WP6). */
function AutomaticClose({
  hasDiscrepancy,
  isAdmin,
  note,
  setNote,
  blocked,
  onOpenConfirm,
}: {
  hasDiscrepancy: boolean;
  isAdmin: boolean;
  note: string;
  setNote: (value: string) => void;
  blocked: string | null;
  onOpenConfirm: () => void;
}) {
  return (
    <>
      {hasDiscrepancy ? (
        <Card className="flex flex-col gap-2 px-4 py-3">
          {isAdmin ? (
            <>
              <label htmlFor="close-note" className="text-sm font-medium">
                Kommentar zur Differenz (Pflicht)
              </label>
              <textarea
                id="close-note"
                rows={3}
                value={note}
                maxLength={MAX_NOTE_LENGTH}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Woher kommt die Differenz?"
                className="w-full rounded-xl border border-black/15 bg-transparent p-3 text-base outline-none focus:border-emerald-500 dark:border-white/20"
              />
              <p className="text-xs opacity-60">
                Mindestens {MIN_NOTE_LENGTH} Zeichen. Der Kommentar wird mit der Session
                gespeichert.
              </p>
            </>
          ) : (
            <p className="text-sm">
              Nur ein Admin kann mit Differenz abschließen. Bitte zuerst Buy-ins und Stacks
              prüfen.
            </p>
          )}
        </Card>
      ) : null}

      <Button
        size="lg"
        variant={hasDiscrepancy ? 'danger' : 'primary'}
        disabled={blocked !== null}
        onClick={onOpenConfirm}
      >
        Session abschließen
      </Button>
      {blocked === null ? null : <p className="text-xs opacity-70">{blocked}</p>}
    </>
  );
}

/**
 * The confirmation (WP6, step 2). It loads the server's own calculation first:
 * what is shown here is exactly what will be frozen, and a session that changed
 * in the meantime shows up as a different number instead of a surprise.
 */
function ConfirmCloseSheet({
  sessionId,
  note,
  onConfirm,
  onClose,
}: {
  sessionId: string;
  note: string | null;
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ready'; preview: SettlementPreview } | { kind: 'error'; message: string }
  >({ kind: 'loading' });
  const [pending, setPending] = useState(false);
  const offline = useWritesBlocked();

  useEffect(() => {
    let active = true;
    void previewSettlement({ sessionId }).then((result) => {
      if (!active) return;
      setState(
        result.ok
          ? { kind: 'ready', preview: result.data }
          : { kind: 'error', message: result.error.message },
      );
    });
    return () => {
      active = false;
    };
  }, [sessionId]);

  async function confirm() {
    if (pending || offline) return;
    setPending(true);
    const done = await onConfirm();
    setPending(false);
    if (done) onClose();
  }

  const ready = state.kind === 'ready' ? state.preview : null;

  return (
    <Sheet open onClose={onClose} title="Session abschließen?">
      <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pb-2">
        <p className="text-sm opacity-80">
          Danach kann nichts mehr geändert werden. Nur ein Admin kann wieder öffnen.
        </p>

        {state.kind === 'loading' ? (
          <p className="text-sm opacity-70">Abrechnung wird geprüft …</p>
        ) : null}

        {state.kind === 'error' ? (
          <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {state.message}
          </p>
        ) : null}

        {ready === null ? null : (
          <div className="flex flex-col gap-2 rounded-xl bg-black/5 px-3 py-2 text-sm dark:bg-white/10">
            <span>
              {ready.participantCount} Teilnehmer · Buy-ins {formatCents(ready.totalBuyInCents)} ·
              Stacks {formatCents(ready.totalStackCents)}
            </span>
            {ready.discrepancyCents === 0 ? (
              <span>Keine Differenz.</span>
            ) : (
              <span className="text-red-700 dark:text-red-300">
                Differenz {formatSignedCents(ready.discrepancyCents)} —{' '}
                {describeDiscrepancy(ready.discrepancyCents)}
              </span>
            )}
            {ready.settlement === null ? null : (
              <span>
                {ready.settlement.transfers.length === 0
                  ? 'Keine Überweisungen nötig.'
                  : `${ready.settlement.transfers.length} Überweisung(en) werden gespeichert.`}
              </span>
            )}
            {note === null ? null : <span>Kommentar: „{note}“</span>}
          </div>
        )}

        <Button
          size="lg"
          variant="danger"
          disabled={pending || offline || ready === null || !ready.canClose}
          onClick={() => void confirm()}
        >
          {pending ? 'Schließt ab …' : 'Jetzt abschließen'}
        </Button>
        <Button size="lg" variant="secondary" onClick={onClose}>
          Abbrechen
        </Button>
        <OfflineNote />
      </div>
    </Sheet>
  );
}

/**
 * Confirmation for a manual override (WP11, step 6). The justification is
 * mandatory here; the warning spells out that the numbers are stored as edited
 * and can only be reset by an admin reopening the session.
 */
function ManualConfirmSheet({
  onConfirm,
  onClose,
}: {
  onConfirm: (note: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const offline = useWritesBlocked();

  const usable = note.trim().length >= MIN_NOTE_LENGTH;

  async function confirm() {
    if (!usable || pending || offline) return;
    setPending(true);
    const done = await onConfirm(note);
    setPending(false);
    if (done) onClose();
  }

  return (
    <Sheet open onClose={onClose} title="Manuell bearbeitete Abrechnung speichern?">
      <div className="flex flex-col gap-3 pb-2">
        <p className="rounded-xl bg-amber-500/15 px-3 py-2 text-sm">
          Manuell bearbeitete Abrechnung. Wird unverändert gespeichert und kann nur von einem
          Admin durch Wiederöffnen zurückgesetzt werden.
        </p>
        <label htmlFor="manual-note" className="text-sm font-medium">
          Begründung (Pflicht)
        </label>
        <textarea
          id="manual-note"
          rows={3}
          autoFocus
          value={note}
          maxLength={MAX_NOTE_LENGTH}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Warum wird die Abrechnung von Hand gesetzt?"
          className="w-full rounded-xl border border-black/15 bg-transparent p-3 text-base outline-none focus:border-emerald-500 dark:border-white/20"
        />
        <p className="text-xs opacity-60">
          Mindestens {MIN_NOTE_LENGTH} Zeichen. Die Begründung steht im Audit-Log.
        </p>
        <Button
          size="lg"
          variant="danger"
          disabled={!usable || pending || offline}
          onClick={() => void confirm()}
        >
          {pending ? 'Speichert …' : 'Manuell abschließen'}
        </Button>
        <Button size="lg" variant="secondary" onClick={onClose}>
          Abbrechen
        </Button>
        <OfflineNote />
      </div>
    </Sheet>
  );
}

function CheckRow({
  ok,
  neutral = false,
  label,
  hint,
}: {
  ok: boolean;
  /** The check cannot be judged yet (still players without a stack). */
  neutral?: boolean;
  label: string;
  hint?: string;
}) {
  const tone = neutral ? 'opacity-60' : ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400';

  return (
    <div className="flex items-start gap-2 text-sm">
      <span aria-hidden className={tone}>
        {neutral ? '•' : ok ? '✓' : '✗'}
      </span>
      <span className="flex flex-col">
        <span className={neutral ? undefined : tone}>{label}</span>
        {hint ? <span className="text-xs opacity-70">{hint}</span> : null}
      </span>
    </div>
  );
}

/** Why the close button is disabled, or `null` when it is not. */
function blockingReason({
  canClose,
  hasDiscrepancy,
  isAdmin,
  noteIsUsable,
}: {
  canClose: boolean;
  hasDiscrepancy: boolean;
  isAdmin: boolean;
  noteIsUsable: boolean;
}): string | null {
  if (!canClose) return 'Erst wenn alle Teilnehmer einen Stack haben, lässt sich abschließen.';
  if (!hasDiscrepancy) return null;
  if (!isAdmin) return 'Nur ein Admin kann mit Differenz abschließen.';
  if (!noteIsUsable) return 'Bitte einen Kommentar zur Differenz eingeben.';
  return null;
}

/** „Es fehlt noch der Stack von Ali.“ */
function missingHint(participants: readonly DerivedParticipant[]): string | undefined {
  const missing = participants.filter((participant) => participant.stack === null);
  if (missing.length === 0) return undefined;

  const names = missing.map((participant) => participant.name);
  if (names.length === 1) return `Es fehlt noch der Stack von ${names[0]}.`;
  const last = names[names.length - 1];
  return `Es fehlen noch die Stacks von ${names.slice(0, -1).join(', ')} und ${last}.`;
}

/**
 * The live preview in the browser. Only defined once every participant has a
 * stack — a missing cash-out would silently count as „stack 0“ and show a loss
 * that nobody has.
 */
function localPreview(participants: readonly DerivedParticipant[]): FrozenSettlement | null {
  if (participants.length === 0) return null;
  if (participants.some((participant) => participant.stack === null)) return null;

  try {
    return computeSettlement(
      participants.map((participant) => ({
        playerId: participant.playerId,
        name: participant.name,
        position: participant.position,
        cashIn: participant.cashIn,
        creditIn: participant.creditIn,
        stack: participant.stack ?? 0,
        payout: participant.payout,
      })),
    );
  } catch {
    // A violated precondition (e.g. a payout above the box after a race) must
    // not blank the screen; the checklist and the server still explain it.
    return null;
  }
}
