'use client';

import { useState } from 'react';
import { reopenSession } from '@/actions/close';
import { useWritesBlocked } from '@/components/app/ConnectionProvider';
import { OfflineNote } from '@/components/app/OfflineNote';
import { CopySettlementButton } from '@/components/settlement/CopySettlementButton';
import { SettlementView } from '@/components/settlement/SettlementView';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { MAX_NOTE_LENGTH, MIN_NOTE_LENGTH } from '@/lib/validation/close';
import type { FrozenSettlement } from '@/lib/settlement/types';

/**
 * What a closed session shows (docs/ARBEITSPAKETE.md WP6, step 4): the frozen
 * settlement, a copy button for the group chat, and — for an admin — reopening
 * with a mandatory reason.
 *
 * `settlement` comes from `settlement_lines` / `settlement_transfers` exactly as
 * it was stored. It is never recomputed, not even when the algorithm changes
 * (SPEC §4, CLAUDE.md).
 */
export function ClosedSessionSection({
  sessionId,
  playedOn,
  name,
  settlement,
  names,
  isAdmin,
  onReopened,
}: {
  sessionId: string;
  playedOn: string;
  name: string | null;
  settlement: FrozenSettlement | null;
  names: Readonly<Record<string, string>>;
  isAdmin: boolean;
  /** Called after a successful reopen, so the screen reloads from the server. */
  onReopened: () => void;
}) {
  const [reopening, setReopening] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Abrechnung</h2>

      {settlement === null ? (
        <p className="rounded-2xl border border-dashed border-black/20 px-4 py-6 text-sm dark:border-white/20">
          Zu dieser abgeschlossenen Session ist keine gespeicherte Abrechnung vorhanden.
        </p>
      ) : (
        <>
          <SettlementView settlement={settlement} names={names} />
          <CopySettlementButton
            playedOn={playedOn}
            name={name}
            settlement={settlement}
            names={names}
          />
        </>
      )}

      {isAdmin ? (
        <Button variant="secondary" size="lg" onClick={() => setReopening(true)}>
          Wieder öffnen
        </Button>
      ) : null}

      {reopening ? (
        <ReopenSheet
          sessionId={sessionId}
          onDone={onReopened}
          onClose={() => setReopening(false)}
        />
      ) : null}
    </div>
  );
}

/** Reopening needs a reason; it is appended to `close_note` and logged. */
function ReopenSheet({
  sessionId,
  onDone,
  onClose,
}: {
  sessionId: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { showError, showSuccess } = useToast();
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const offline = useWritesBlocked();

  const usable = reason.trim().length >= MIN_NOTE_LENGTH;

  async function submit() {
    if (!usable || pending || offline) return;
    setPending(true);
    const result = await reopenSession({ sessionId, reason: reason.trim() });
    setPending(false);

    if (!result.ok) {
      showError(result.error.message);
      onDone();
      return;
    }
    showSuccess('Session ist wieder offen. Die Abrechnung wurde gelöscht.');
    onDone();
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title="Session wieder öffnen?">
      <div className="flex flex-col gap-3 pb-2">
        <p className="text-sm opacity-80">
          Die gespeicherte Abrechnung wird gelöscht und beim nächsten Abschluss neu berechnet.
          Der Grund wird an den Kommentar angehängt und steht im Audit-Log.
        </p>
        <label htmlFor="reopen-reason" className="text-sm font-medium">
          Grund (Pflicht)
        </label>
        <textarea
          id="reopen-reason"
          rows={3}
          autoFocus
          value={reason}
          maxLength={MAX_NOTE_LENGTH}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Warum wird wieder geöffnet?"
          className="w-full rounded-xl border border-black/15 bg-transparent p-3 text-base outline-none focus:border-emerald-500 dark:border-white/20"
        />
        <Button
          size="lg"
          variant="danger"
          disabled={!usable || pending || offline}
          onClick={() => void submit()}
        >
          {pending ? 'Öffnet …' : 'Wieder öffnen'}
        </Button>
        <Button size="lg" variant="secondary" onClick={onClose}>
          Abbrechen
        </Button>
        <OfflineNote />
      </div>
    </Sheet>
  );
}
