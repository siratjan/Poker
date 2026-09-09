'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { AmountField } from '@/components/sessions/AmountField';
import { formatCents } from '@/lib/money';
import { amountFromInput, euroValue } from '@/lib/session/amountInput';
import type { CashPreview, DerivedParticipant, PaymentMethod } from '@/lib/session/derive';
import type { PlayerListItem } from '@/lib/queries/players';

/**
 * The bottom sheets of the session detail screen (docs/ARBEITSPAKETE.md WP5,
 * step 4). Presentation and local input state only — every write goes through
 * the server actions the parent hands in as `onSubmit`.
 *
 * A submit handler returns `true` when the action succeeded; the sheet then
 * closes. On `false` it stays open with the value the user typed, so nothing
 * has to be entered twice after a rejected write.
 */

type SubmitResult = Promise<boolean>;

/** Actions available for one participant. */
export function ParticipantActionsSheet({
  participant,
  onBuyIn,
  onCashOut,
  onEditStack,
  onPayout,
  onRemove,
  onClose,
}: {
  participant: DerivedParticipant;
  onBuyIn: () => void;
  onCashOut: () => void;
  onEditStack: () => void;
  onPayout: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const hasStack = participant.stack !== null;

  return (
    <Sheet open onClose={onClose} title={participant.name}>
      <div className="flex flex-col gap-2 pb-2">
        {hasStack ? null : (
          <Button size="lg" onClick={onBuyIn}>
            Buy-in
          </Button>
        )}
        {hasStack ? (
          <Button size="lg" variant="secondary" onClick={onEditStack}>
            Stack ändern
          </Button>
        ) : (
          <Button size="lg" variant="secondary" onClick={onCashOut}>
            Aussteigen (Stack eintragen)
          </Button>
        )}
        {hasStack ? (
          <Button size="lg" variant="secondary" onClick={onPayout}>
            Bar-Auszahlung
          </Button>
        ) : null}
        {participant.hasEntries ? null : (
          <Button size="lg" variant="danger" onClick={onRemove}>
            Teilnehmer entfernen
          </Button>
        )}
        {hasStack ? (
          <p className="px-1 pt-1 text-xs opacity-60">
            {participant.name} ist ausgestiegen. Für einen weiteren Buy-in muss der Stack im
            Verlauf gelöscht werden.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Buy-in: quick amounts, free amount, „Bar“ / „Liste“ as the confirm buttons. */
export function BuyInSheet({
  participant,
  quickAmountsCents,
  onSubmit,
  onClose,
}: {
  participant: DerivedParticipant;
  quickAmountsCents: readonly number[];
  onSubmit: (amountCents: number, payment: PaymentMethod) => SubmitResult;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const cents = amountFromInput(value, false);
  // Preselect the payment method this player used last (WP5, step 4).
  const preferred: PaymentMethod = participant.lastPayment ?? 'cash';

  async function submit(payment: PaymentMethod) {
    if (cents === null || pending) return;
    setPending(true);
    const done = await onSubmit(cents, payment);
    setPending(false);
    if (done) onClose();
  }

  return (
    <Sheet open onClose={onClose} title={`Buy-in · ${participant.name}`}>
      <div className="flex flex-col gap-4 pb-2">
        <AmountField
          label="Betrag"
          value={value}
          onChange={setValue}
          quickAmountsCents={quickAmountsCents}
          autoFocus
        />
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="lg"
            variant={preferred === 'cash' ? 'primary' : 'secondary'}
            disabled={cents === null || pending}
            onClick={() => void submit('cash')}
          >
            Bar
          </Button>
          <Button
            size="lg"
            variant={preferred === 'credit' ? 'primary' : 'secondary'}
            disabled={cents === null || pending}
            onClick={() => void submit('credit')}
          >
            Auf Liste
          </Button>
        </div>
        <p className="text-xs opacity-60">
          Bisher: {formatCents(participant.cashIn)} bar, {formatCents(participant.creditIn)} Liste.
        </p>
      </div>
    </Sheet>
  );
}

/** Cash-out: the end stack, 0 allowed. */
export function CashOutSheet({
  participant,
  mode,
  onSubmit,
  onClose,
}: {
  participant: DerivedParticipant;
  mode: 'create' | 'edit';
  onSubmit: (amountCents: number) => SubmitResult;
  onClose: () => void;
}) {
  const [value, setValue] = useState(
    mode === 'edit' && participant.stack !== null ? euroValue(participant.stack) : '',
  );
  const [pending, setPending] = useState(false);
  const cents = amountFromInput(value, true);

  async function submit() {
    if (cents === null || pending) return;
    setPending(true);
    const done = await onSubmit(cents);
    setPending(false);
    if (done) onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={mode === 'edit' ? `Stack ändern · ${participant.name}` : `Aussteigen · ${participant.name}`}
    >
      <div className="flex flex-col gap-4 pb-2">
        <AmountField
          label="End-Stack"
          value={value}
          onChange={setValue}
          allowZero
          autoFocus
          hint="0 ist erlaubt, wenn nichts mehr übrig ist."
        />
        {mode === 'create' ? (
          <p className="rounded-xl bg-black/5 px-3 py-2 text-xs opacity-80 dark:bg-white/10">
            Danach sind für {participant.name} keine Buy-ins mehr möglich.
          </p>
        ) : null}
        {participant.payout > 0 ? (
          <p className="text-xs opacity-70">
            Bereits bar erhalten: {formatCents(participant.payout)}. Der Stack darf nicht kleiner
            sein.
          </p>
        ) : null}
        <Button size="lg" disabled={cents === null || pending} onClick={() => void submit()}>
          {pending ? 'Speichert …' : 'Eintragen'}
        </Button>
      </div>
    </Sheet>
  );
}

/** Payout: cash out of the box for an early leaver. */
export function PayoutSheet({
  participant,
  cashBoxCents,
  preview,
  onSubmit,
  onClose,
}: {
  participant: DerivedParticipant;
  cashBoxCents: number;
  preview: CashPreview | null;
  onSubmit: (amountCents: number) => SubmitResult;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const cents = amountFromInput(value, false);

  async function submit() {
    if (cents === null || pending) return;
    setPending(true);
    const done = await onSubmit(cents);
    setPending(false);
    if (done) onClose();
  }

  return (
    <Sheet open onClose={onClose} title={`Bar-Auszahlung · ${participant.name}`}>
      <div className="flex flex-col gap-4 pb-2">
        <AmountField label="Betrag" value={value} onChange={setValue} autoFocus />

        <div className="flex flex-col gap-1 rounded-xl bg-black/5 px-3 py-2 text-xs dark:bg-white/10">
          <span>Kasse: {formatCents(cashBoxCents)}</span>
          <span>Stack: {formatCents(participant.stack ?? 0)}</span>
          {participant.payout > 0 ? (
            <span>Schon ausgezahlt: {formatCents(participant.payout)}</span>
          ) : null}
          {preview === null ? null : (
            <span>
              Nach Bar-zuerst-Regel stünden {participant.name} aktuell ca.{' '}
              {formatCents(preview.cashFromBoxCents)} zu
              {preview.provisional ? ' (vorläufig, es spielen noch Leute)' : ''}.
            </span>
          )}
        </div>

        <Button size="lg" disabled={cents === null || pending} onClick={() => void submit()}>
          {pending ? 'Speichert …' : 'Auszahlen'}
        </Button>
      </div>
    </Sheet>
  );
}

/** Add a participant: search existing players or create a new one. */
export function AddParticipantSheet({
  players,
  onAddExisting,
  onAddNew,
  onClose,
}: {
  /** All players that are not yet participants of this session. */
  players: readonly PlayerListItem[];
  onAddExisting: (playerId: string) => SubmitResult;
  onAddNew: (name: string) => SubmitResult;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);

  const needle = query.trim().toLowerCase();
  const matches = needle === '' ? players : players.filter((p) => p.name.toLowerCase().includes(needle));
  const exactMatch = players.some((p) => p.name.trim().toLowerCase() === needle);

  async function run(action: () => SubmitResult) {
    if (pending) return;
    setPending(true);
    const done = await action();
    setPending(false);
    if (done) onClose();
  }

  return (
    <Sheet open onClose={onClose} title="Teilnehmer hinzufügen">
      <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pb-2">
        <input
          type="text"
          value={query}
          autoFocus
          maxLength={40}
          placeholder="Name suchen oder neu eingeben"
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Spieler suchen"
          className="min-h-[44px] w-full rounded-xl border border-black/15 bg-transparent px-3 text-base outline-none focus:border-emerald-500 dark:border-white/20"
        />

        {needle.length > 0 && !exactMatch ? (
          <Button size="lg" disabled={pending} onClick={() => void run(() => onAddNew(query))}>
            Neuen Spieler „{query.trim()}“ anlegen
          </Button>
        ) : null}

        {matches.length === 0 ? (
          <p className="px-1 py-2 text-sm opacity-70">
            {players.length === 0
              ? 'Alle Spieler sind schon dabei.'
              : 'Kein Spieler gefunden.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {matches.map((player) => (
              <li key={player.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void run(() => onAddExisting(player.id))}
                  className="min-h-[52px] w-full rounded-xl border border-black/15 px-4 text-left text-base transition hover:bg-black/5 disabled:opacity-60 dark:border-white/20 dark:hover:bg-white/10"
                >
                  {player.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** Confirmation before an entry is deleted for good. */
export function ConfirmDeleteSheet({
  title,
  description,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  onConfirm: () => SubmitResult;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pending) return;
    setPending(true);
    const done = await onConfirm();
    setPending(false);
    if (done) onClose();
  }

  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="flex flex-col gap-3 pb-2">
        <p className="text-sm opacity-80">{description}</p>
        <Button size="lg" variant="danger" disabled={pending} onClick={() => void confirm()}>
          {pending ? 'Löscht …' : 'Löschen'}
        </Button>
        <Button size="lg" variant="secondary" onClick={onClose}>
          Abbrechen
        </Button>
      </div>
    </Sheet>
  );
}
