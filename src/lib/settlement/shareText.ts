import { formatCents, formatSignedCents } from '@/lib/money';
import { formatPlayedOn } from '@/lib/time';
import { describeTransfer } from './format';
import type { FrozenSettlement } from './types';

/**
 * Plain-text rendering of a settlement for the „Abrechnung kopieren“ button
 * (docs/ARBEITSPAKETE.md WP6, step 5) — meant to be pasted into WhatsApp, so no
 * markup, no table, no character that a messenger might swallow.
 *
 * Same three blocks as `SettlementView`, in the same order and with the same
 * wording, so the text and the screen can be compared line by line at the table.
 */

/** Fallback for a player that is missing from the name lookup. */
const UNKNOWN_PLAYER = 'Unbekannt';

export type ShareTextInput = {
  /** `played_on` as `YYYY-MM-DD`. */
  playedOn: string;
  /** Optional session name. */
  name: string | null;
  settlement: FrozenSettlement;
  /** `playerId` -> display name. */
  names: Readonly<Record<string, string>>;
};

export function buildShareText({ playedOn, name, settlement, names }: ShareTextInput): string {
  const heading =
    name === null || name.trim() === ''
      ? `Poker-Kasse · ${formatPlayedOn(playedOn)}`
      : `Poker-Kasse · ${formatPlayedOn(playedOn)} · ${name.trim()}`;

  const blocks = [
    heading,
    cashBlock(settlement, names),
    transferBlock(settlement, names),
    resultBlock(settlement, names),
  ];

  return blocks.join('\n\n');
}

/** Block 1 — who takes how much cash out of the box. */
function cashBlock(settlement: FrozenSettlement, names: Readonly<Record<string, string>>): string {
  const rows = settlement.lines
    .filter((line) => line.cashFromBox > 0)
    .map((line) => `- ${nameOf(names, line.playerId)} bekommt ${formatCents(line.cashFromBox)} bar`);

  const lines = ['Aus der Kasse:'];
  if (rows.length === 0) {
    lines.push('- Es ist kein Bargeld zu verteilen.');
  } else {
    lines.push(...rows);
    lines.push(`Summe: ${formatCents(sumCashFromBox(settlement))}`);
  }
  if (settlement.unallocatedCash > 0) {
    lines.push(`Bleibt in der Kasse: ${formatCents(settlement.unallocatedCash)} (Differenz)`);
  }
  return lines.join('\n');
}

/** Block 2 — who owes whom. */
function transferBlock(
  settlement: FrozenSettlement,
  names: Readonly<Record<string, string>>,
): string {
  const lines = ['Überweisungen:'];

  if (settlement.transfers.length === 0) {
    lines.push('- Keine Schulden, alles bar erledigt.');
  } else {
    for (const transfer of settlement.transfers) {
      lines.push(`- ${describeTransfer(transfer, names)}`);
    }
    lines.push(
      `Summe: ${formatCents(settlement.transfers.reduce((acc, t) => acc + t.amount, 0))}`,
    );
  }

  if (settlement.uncoveredClaims > 0) {
    lines.push(`Achtung: ${formatCents(settlement.uncoveredClaims)} Anspruch ohne Deckung (Differenz)`);
  }
  if (settlement.uncoveredDebts > 0) {
    lines.push(`Achtung: ${formatCents(settlement.uncoveredDebts)} Schuld ohne Gläubiger (Differenz)`);
  }
  return lines.join('\n');
}

/** Block 3 — the plus/minus of the evening, biggest winner first. */
function resultBlock(settlement: FrozenSettlement, names: Readonly<Record<string, string>>): string {
  const lines = ['Ergebnis des Abends:'];

  for (const line of sortedByResult(settlement)) {
    lines.push(`- ${nameOf(names, line.playerId)}: ${formatSignedCents(line.netResult)}`);
  }
  if (settlement.discrepancy !== 0) {
    lines.push(
      `Differenz: ${formatSignedCents(settlement.discrepancy)} (${describeDiscrepancy(settlement.discrepancy)})`,
    );
  }
  return lines.join('\n');
}

/** Lines of the result block: biggest plus first, ties keep the join order. */
export function sortedByResult(settlement: FrozenSettlement): FrozenSettlement['lines'] {
  return [...settlement.lines]
    .map((line, index) => ({ line, index }))
    .sort((a, b) =>
      b.line.netResult !== a.line.netResult
        ? b.line.netResult - a.line.netResult
        : a.index - b.index,
    )
    .map((entry) => entry.line);
}

/** „20,00 € weniger gezählt als eingekauft“ / „… mehr gezählt …“. */
export function describeDiscrepancy(discrepancy: number): string {
  if (discrepancy === 0) return 'Buy-ins und Stacks stimmen überein';
  return discrepancy < 0
    ? `${formatCents(-discrepancy)} weniger gezählt als eingekauft`
    : `${formatCents(discrepancy)} mehr gezählt als eingekauft`;
}

export function sumCashFromBox(settlement: FrozenSettlement): number {
  return settlement.lines.reduce((acc, line) => acc + line.cashFromBox, 0);
}

function nameOf(names: Readonly<Record<string, string>>, playerId: string): string {
  return names[playerId] ?? UNKNOWN_PLAYER;
}
