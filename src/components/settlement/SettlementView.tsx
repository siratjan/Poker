'use client';

import { useState, type ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { formatCents, formatSignedCents } from '@/lib/money';
import { describeDiscrepancy, sortedByResult } from '@/lib/settlement/shareText';
import type { FrozenSettlement } from '@/lib/settlement/types';
import { amountToneClasses } from '@/lib/ui/amountTone';

/**
 * The settlement of one evening (docs/ARBEITSPAKETE.md WP6, step 3), in the
 * order the table needs it:
 *
 * 1. „Aus der Kasse“ — who physically takes how much cash out of the box.
 * 2. „Überweisungen“ — who still owes whom.
 * 3. „Ergebnis des Abends“ — the plus/minus per player.
 * 4. „Rechenweg“ — collapsible, the three stages per player, for the argument
 *    that inevitably follows.
 *
 * Presentational only: it renders the numbers it is given and computes nothing
 * of its own. For a closed session those numbers come from `settlement_lines` /
 * `settlement_transfers` and are never recalculated (CLAUDE.md); the same
 * component with `variant="preview"` shows what *would* be frozen.
 */
export function SettlementView({
  settlement,
  names,
  variant = 'final',
}: {
  settlement: FrozenSettlement;
  /** `playerId` -> display name. */
  names: Readonly<Record<string, string>>;
  variant?: 'preview' | 'final';
}) {
  const cashRows = settlement.lines.filter((line) => line.cashFromBox > 0);
  const transferTotal = settlement.transfers.reduce((acc, transfer) => acc + transfer.amount, 0);
  // A hand-edited settlement (WP11, Gaby round 1 F1) has no reconciliation: its
  // "Summe" is the sum of the amounts actually shown, and the automatic
  // reconciliation leftovers (unallocated / uncovered) do not apply, so they are
  // hidden — consistent with the already-hidden „Rechenweg“. The automatic path
  // keeps showing the cash box after payouts (which differs from Σ cashFromBox
  // exactly by `unallocatedCash`, spelled out below).
  const cashFromBoxTotal = settlement.lines.reduce((acc, line) => acc + line.cashFromBox, 0);
  const cashSum = settlement.isManual ? cashFromBoxTotal : settlement.cashBoxAfterPayouts;

  return (
    <div className="flex flex-col gap-4">
      {variant === 'preview' ? (
        <p className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs font-medium">
          Vorschau — so würde die Abrechnung gespeichert.
        </p>
      ) : null}

      {settlement.isManual ? (
        <p className="rounded-xl bg-black/5 px-3 py-2 text-xs font-medium dark:bg-white/10">
          Manuell bearbeitet — diese Abrechnung wurde von einem Admin von Hand gesetzt und nicht
          automatisch berechnet.
        </p>
      ) : null}

      {/* Block 1 --------------------------------------------------------- */}
      <Block title="Aus der Kasse">
        {cashRows.length === 0 ? (
          <p className="text-sm opacity-70">Es ist kein Bargeld zu verteilen.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {cashRows.map((line) => (
                <li key={line.playerId} className="flex items-baseline justify-between gap-3">
                  <span>{nameOf(names, line.playerId)} bekommt</span>
                  <span className="font-semibold tabular-nums">
                    {formatCents(line.cashFromBox)} bar
                  </span>
                </li>
              ))}
            </ul>
            {/*
              „Summe = Kasse“ (WP6, step 3): in the automatic path the sum line
              is the cash box after the early payouts, not Σ cashFromBox. The two
              differ exactly by `unallocatedCash`, spelled out below — so the
              reader can add the rows up and land on the box (Gaby WP6, F3). For a
              manual settlement it is the plain Σ cashFromBox (Gaby WP11 F1).
            */}
            <SumRow label="Summe" value={formatCents(cashSum)} />
          </>
        )}
        {!settlement.isManual && settlement.unallocatedCash > 0 ? (
          <Warning>
            Bleibt in der Kasse: {formatCents(settlement.unallocatedCash)} (Differenz)
          </Warning>
        ) : null}
      </Block>

      {/* Block 2 --------------------------------------------------------- */}
      <Block title="Überweisungen">
        {settlement.transfers.length === 0 ? (
          <p className="text-sm opacity-70">Keine Schulden, alles bar erledigt.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {settlement.transfers.map((transfer, index) => (
                <li
                  key={`${transfer.fromPlayerId}-${transfer.toPlayerId}-${index}`}
                  className="flex items-baseline justify-between gap-3 text-base"
                >
                  <span>
                    {nameOf(names, transfer.fromPlayerId)}
                    <span className="px-1.5 opacity-60">→</span>
                    {nameOf(names, transfer.toPlayerId)}
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatCents(transfer.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <SumRow label="Summe" value={formatCents(transferTotal)} />
          </>
        )}
        {!settlement.isManual && settlement.uncoveredClaims > 0 ? (
          <Warning>
            {formatCents(settlement.uncoveredClaims)} Anspruch ohne Deckung (Differenz)
          </Warning>
        ) : null}
        {!settlement.isManual && settlement.uncoveredDebts > 0 ? (
          <Warning>
            {formatCents(settlement.uncoveredDebts)} Schuld ohne Gläubiger (Differenz)
          </Warning>
        ) : null}
      </Block>

      {/* Block 3 --------------------------------------------------------- */}
      <Block title="Ergebnis des Abends">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[20rem] text-sm">
            <thead>
              <tr className="text-left text-xs opacity-60">
                <th scope="col" className="py-1 pr-2 font-medium">
                  Spieler
                </th>
                <th scope="col" className="py-1 px-2 text-right font-medium">
                  Bar
                </th>
                <th scope="col" className="py-1 px-2 text-right font-medium">
                  Liste
                </th>
                <th scope="col" className="py-1 px-2 text-right font-medium">
                  Stack
                </th>
                <th scope="col" className="py-1 px-2 text-right font-medium">
                  Ausgez.
                </th>
                <th scope="col" className="py-1 pl-2 text-right font-medium">
                  +/−
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedByResult(settlement).map((line) => (
                <tr key={line.playerId} className="border-t border-black/5 dark:border-white/10">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    {nameOf(names, line.playerId)}
                  </th>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {formatCents(line.cashIn)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {formatCents(line.creditIn)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{formatCents(line.stack)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {formatCents(line.payout)}
                  </td>
                  <td
                    className={`py-1.5 pl-2 text-right font-semibold tabular-nums ${resultColor(line.netResult)}`}
                  >
                    {formatSignedCents(line.netResult)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {settlement.discrepancy === 0 ? null : (
          <Warning>
            Differenz {formatSignedCents(settlement.discrepancy)} —{' '}
            {describeDiscrepancy(settlement.discrepancy)}
          </Warning>
        )}
      </Block>

      {/* The „Rechenweg“ explains the three automatic stages; for a hand-edited
          settlement those stages do not apply, so it is hidden (WP11). */}
      {settlement.isManual ? null : <CalculationDetails settlement={settlement} names={names} />}
    </div>
  );
}

/** The collapsible „Rechenweg“: what each player got out of which stage. */
function CalculationDetails({
  settlement,
  names,
}: {
  settlement: FrozenSettlement;
  names: Readonly<Record<string, string>>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left text-sm font-medium"
      >
        <span>Rechenweg</span>
        <span aria-hidden className="opacity-60">
          {open ? '▲' : '▼'}
        </span>
      </button>

      {open ? (
        <div className="flex flex-col gap-3 pt-2 text-sm">
          <p className="text-xs opacity-70">
            Bargeld geht zuerst an Bar-Zahler: Stufe 1 der eigene Bar-Einsatz zurück, Stufe 2 der
            Rest an die Bar-Zahler, Stufe 3 was dann noch übrig ist an Listen-Spieler.
          </p>
          <dl className="flex flex-col gap-2">
            <div className="flex justify-between gap-3">
              <dt className="opacity-70">Kasse zu Beginn (bar eingekauft)</dt>
              <dd className="tabular-nums">{formatCents(settlement.cashBoxStart)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="opacity-70">Kasse nach Bar-Auszahlungen</dt>
              <dd className="tabular-nums">{formatCents(settlement.cashBoxAfterPayouts)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="opacity-70">Buy-ins gesamt / Stacks gesamt</dt>
              <dd className="tabular-nums">
                {formatCents(settlement.totalBuyIn)} / {formatCents(settlement.totalStack)}
              </dd>
            </div>
          </dl>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
              <thead>
                <tr className="text-left text-xs opacity-60">
                  <th scope="col" className="py-1 pr-2 font-medium">
                    Spieler
                  </th>
                  <th scope="col" className="py-1 px-2 text-right font-medium">
                    Anspruch
                  </th>
                  <th scope="col" className="py-1 px-2 text-right font-medium">
                    Stufe 1
                  </th>
                  <th scope="col" className="py-1 px-2 text-right font-medium">
                    Stufe 2
                  </th>
                  <th scope="col" className="py-1 px-2 text-right font-medium">
                    Stufe 3
                  </th>
                  <th scope="col" className="py-1 pl-2 text-right font-medium">
                    Offen
                  </th>
                </tr>
              </thead>
              <tbody>
                {settlement.lines.map((line) => (
                  <tr key={line.playerId} className="border-t border-black/5 dark:border-white/10">
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                      {nameOf(names, line.playerId)}
                      {line.isCashPlayer ? null : (
                        <span className="pl-1 text-xs opacity-60">(Liste)</span>
                      )}
                    </th>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {formatCents(line.claim)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {formatCents(line.cashTier1)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {formatCents(line.cashTier2)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums">
                      {formatCents(line.cashTier3)}
                    </td>
                    <td
                      className={`py-1.5 pl-2 text-right tabular-nums ${resultColor(line.residual)}`}
                    >
                      {formatSignedCents(line.residual)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs opacity-60">
            „Offen“ ist der Rest nach Bargeld und Listen-Einsatz: positiv = bekommt noch,
            negativ = schuldet noch. Genau daraus entstehen die Überweisungen.
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2 px-4 py-3">
      <h3 className="text-base font-semibold">{title}</h3>
      {children}
    </Card>
  );
}

function SumRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-black/10 pt-2 text-sm dark:border-white/10">
      <span className="opacity-70">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
      {children}
    </p>
  );
}

/**
 * WP9, step 4: the plus/minus colours live in one place now, together with
 * their measured WCAG AA ratios (`src/lib/ui/amountTone.ts`).
 */
function resultColor(cents: number): string {
  return amountToneClasses(cents);
}

function nameOf(names: Readonly<Record<string, string>>, playerId: string): string {
  return names[playerId] ?? 'Unbekannt';
}
