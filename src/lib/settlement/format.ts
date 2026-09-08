import { formatCents } from '@/lib/money';
import type { Transfer } from './types';

/** Fallback for a player that is missing from the name lookup. */
const UNKNOWN_PLAYER = 'Unbekannt';

/**
 * Renders one transfer as the German sentence shown in the debt list,
 * e.g. `"Can schuldet Ali 40,00 €"`.
 *
 * `names` maps `playerId` to display name; unknown ids render as `"Unbekannt"`
 * so that a missing name never leaks a raw id into the UI.
 */
export function describeTransfer(
  transfer: Transfer,
  names: Readonly<Record<string, string>>,
): string {
  const from = names[transfer.fromPlayerId] ?? UNKNOWN_PLAYER;
  const to = names[transfer.toPlayerId] ?? UNKNOWN_PLAYER;

  return `${from} schuldet ${to} ${formatCents(transfer.amount)}`;
}
