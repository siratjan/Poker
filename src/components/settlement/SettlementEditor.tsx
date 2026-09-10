'use client';

import { useEffect, useMemo, useState } from 'react';
import { AmountField } from '@/components/sessions/AmountField';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatCents } from '@/lib/money';
import { amountFromInput, euroValue } from '@/lib/session/amountInput';
import type { FrozenSettlement, SettlementLine, Transfer } from '@/lib/settlement/types';

/**
 * Manual override of a settlement in the live preview of an open session
 * (docs/ARBEITSPAKETE.md WP11, step 6; docs/SPEC.md §6.1). Admin only — the
 * parent decides whether to render this at all.
 *
 * The admin edits two things freely: the „Aus der Kasse“ amount per player and
 * the transfer list (Von / An / Betrag). Everything else of a line (buy-ins,
 * stack, payout, net result) describes the real entries and stays as computed;
 * only `cashFromBox` and `residual` follow the edit. There is deliberately no
 * consistency check against buy-ins/stacks (SPEC §6.1): the live sums are shown
 * as a neutral orientation, never as a blocker.
 *
 * The built settlement (or `null` while an input is not usable) is pushed up via
 * `onChange`; the parent runs the confirmation and the server action.
 */

type TransferRow = {
  /** Stable key for the list. */
  key: string;
  fromPlayerId: string;
  toPlayerId: string;
  amount: string;
};

let transferKeySeq = 0;
function nextKey(): string {
  transferKeySeq += 1;
  return `t-${transferKeySeq}`;
}

export function SettlementEditor({
  base,
  names,
  onChange,
}: {
  /** The automatic settlement the editor starts from. */
  base: FrozenSettlement;
  names: Readonly<Record<string, string>>;
  /** Built settlement, or `null` while something is not a usable amount. */
  onChange: (settlement: FrozenSettlement | null) => void;
}) {
  const participants = useMemo(
    () => base.lines.map((line) => ({ playerId: line.playerId, name: nameOf(names, line.playerId) })),
    [base.lines, names],
  );

  const [cashInputs, setCashInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(base.lines.map((line) => [line.playerId, euroValue(line.cashFromBox)])),
  );
  const [transfers, setTransfers] = useState<TransferRow[]>(() =>
    base.transfers.map((transfer) => ({
      key: nextKey(),
      fromPlayerId: transfer.fromPlayerId,
      toPlayerId: transfer.toPlayerId,
      amount: euroValue(transfer.amount),
    })),
  );

  const built = useMemo<FrozenSettlement | null>(
    () => buildSettlement(base, cashInputs, transfers),
    [base, cashInputs, transfers],
  );

  useEffect(() => {
    onChange(built);
  }, [built, onChange]);

  const cashSum = base.lines.reduce(
    (acc, line) => acc + (amountFromInput(cashInputs[line.playerId] ?? '', true) ?? 0),
    0,
  );
  const transferSum = transfers.reduce(
    (acc, row) => acc + (amountFromInput(row.amount, false) ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-medium">
        Manueller Modus — Beträge und Überweisungen frei bearbeitbar. Es findet keine
        Stimmigkeitsprüfung statt; beim Abschluss wird genau das gespeichert.
      </p>

      {/* Aus der Kasse ------------------------------------------------------ */}
      <Card className="flex flex-col gap-3 px-4 py-3">
        <h3 className="text-base font-semibold">Aus der Kasse</h3>
        {base.lines.map((line) => (
          <div key={line.playerId} className="flex flex-col gap-1">
            <AmountField
              label={`${nameOf(names, line.playerId)} bekommt bar`}
              value={cashInputs[line.playerId] ?? ''}
              allowZero
              onChange={(value) =>
                setCashInputs((current) => ({ ...current, [line.playerId]: value }))
              }
            />
          </div>
        ))}
        <SumRow
          label="Summe Auszahlungen"
          value={formatCents(cashSum)}
          hint={
            cashSum === base.cashBoxAfterPayouts
              ? undefined
              : `Kasse nach Auszahlungen: ${formatCents(base.cashBoxAfterPayouts)} (frei bearbeitet – nicht geprüft)`
          }
        />
      </Card>

      {/* Überweisungen ------------------------------------------------------ */}
      <Card className="flex flex-col gap-3 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">Überweisungen</h3>
          <Button
            variant="secondary"
            onClick={() =>
              setTransfers((current) => [
                ...current,
                { key: nextKey(), fromPlayerId: '', toPlayerId: '', amount: '' },
              ])
            }
          >
            Zeile hinzufügen
          </Button>
        </div>

        {transfers.length === 0 ? (
          <p className="text-sm opacity-70">Keine Überweisungen.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {transfers.map((row) => (
              <li key={row.key} className="flex flex-col gap-2 border-t border-black/5 pt-3 dark:border-white/10">
                <div className="flex flex-wrap items-end gap-2">
                  <PlayerSelect
                    label="Von"
                    value={row.fromPlayerId}
                    participants={participants}
                    onChange={(value) => updateTransfer(setTransfers, row.key, { fromPlayerId: value })}
                  />
                  <span aria-hidden className="pb-2 opacity-60">
                    →
                  </span>
                  <PlayerSelect
                    label="An"
                    value={row.toPlayerId}
                    participants={participants}
                    onChange={(value) => updateTransfer(setTransfers, row.key, { toPlayerId: value })}
                  />
                </div>
                <AmountField
                  label="Betrag"
                  value={row.amount}
                  onChange={(value) => updateTransfer(setTransfers, row.key, { amount: value })}
                  error={
                    row.fromPlayerId !== '' && row.fromPlayerId === row.toPlayerId
                      ? 'Von und An dürfen nicht derselbe Spieler sein.'
                      : undefined
                  }
                />
                <Button
                  variant="secondary"
                  onClick={() =>
                    setTransfers((current) => current.filter((entry) => entry.key !== row.key))
                  }
                >
                  Zeile entfernen
                </Button>
              </li>
            ))}
          </ul>
        )}

        <SumRow label="Summe Überweisungen" value={formatCents(transferSum)} />
      </Card>

      {built === null ? (
        <p className="text-xs opacity-70">
          Bitte fülle alle Beträge aus und wähle für jede Überweisung zwei verschiedene Spieler.
        </p>
      ) : null}
    </div>
  );
}

/** Builds the manual settlement, or `null` if an input is not usable yet. */
function buildSettlement(
  base: FrozenSettlement,
  cashInputs: Record<string, string>,
  transfers: readonly TransferRow[],
): FrozenSettlement | null {
  const lines: SettlementLine[] = [];
  for (const line of base.lines) {
    const cents = amountFromInput(cashInputs[line.playerId] ?? '', true);
    if (cents === null) return null;
    lines.push({
      ...line,
      // The stages are meaningless for a hand-edited settlement; the whole cash
      // amount is carried in tier 1 so `cashFromBox = Σ tiers` stays consistent.
      cashTier1: cents,
      cashTier2: 0,
      cashTier3: 0,
      cashFromBox: cents,
      residual: line.claim - cents - line.creditIn,
    });
  }

  const builtTransfers: Transfer[] = [];
  for (const row of transfers) {
    if (row.fromPlayerId === '' || row.toPlayerId === '') return null;
    if (row.fromPlayerId === row.toPlayerId) return null;
    const cents = amountFromInput(row.amount, false);
    if (cents === null) return null;
    builtTransfers.push({
      fromPlayerId: row.fromPlayerId,
      toPlayerId: row.toPlayerId,
      amount: cents,
    });
  }

  // Header leftovers (unallocated / uncovered) are kept from the automatic base:
  // they describe the real difference and are not what the admin edits (SPEC §6.1,
  // no reconciliation).
  return { ...base, isManual: true, lines, transfers: builtTransfers };
}

function updateTransfer(
  setTransfers: React.Dispatch<React.SetStateAction<TransferRow[]>>,
  key: string,
  patch: Partial<Omit<TransferRow, 'key'>>,
): void {
  setTransfers((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
}

function PlayerSelect({
  label,
  value,
  participants,
  onChange,
}: {
  label: string;
  value: string;
  participants: readonly { playerId: string; name: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-[44px] rounded-xl border border-black/15 bg-transparent px-3 text-base outline-none focus:border-emerald-500 dark:border-white/20"
      >
        <option value="">Bitte wählen</option>
        {participants.map((participant) => (
          <option key={participant.playerId} value={participant.playerId}>
            {participant.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SumRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-black/10 pt-2 dark:border-white/10">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="opacity-70">{label}</span>
        <span className="font-semibold tabular-nums">{value}</span>
      </div>
      {hint ? <span className="text-xs opacity-60">{hint}</span> : null}
    </div>
  );
}

function nameOf(names: Readonly<Record<string, string>>, playerId: string): string {
  return names[playerId] ?? 'Unbekannt';
}
