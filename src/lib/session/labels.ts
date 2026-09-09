import { formatCents } from '@/lib/money';
import type { DerivedParticipant, SessionEntry } from '@/lib/session/derive';

/**
 * German labels of the session detail screen (docs/ARBEITSPAKETE.md WP5,
 * step 4). Pure string building, kept out of the components so the wording the
 * user reads is covered by unit tests.
 */

/** A result always carries its sign: `+50,00 €` / `-50,00 €` / `0,00 €`. */
export function formatSignedCents(cents: number): string {
  return cents > 0 ? `+${formatCents(cents)}` : formatCents(cents);
}

/** „100,00 € bar + 50,00 € Liste“, or a hint when nothing was bought yet. */
export function buyInLabel(participant: DerivedParticipant): string {
  const parts: string[] = [];
  if (participant.cashIn > 0) parts.push(`${formatCents(participant.cashIn)} bar`);
  if (participant.creditIn > 0) parts.push(`${formatCents(participant.creditIn)} Liste`);
  return parts.length === 0 ? 'noch kein Buy-in' : parts.join(' + ');
}

/** „Stack 250,00 €“ or „spielt noch“. */
export function stackLabel(participant: DerivedParticipant): string {
  return participant.stack === null ? 'spielt noch' : `Stack ${formatCents(participant.stack)}`;
}

/**
 * One line of the history: „Buy-in 100,00 € bar“, „Stack 250,00 €“,
 * „Bar-Auszahlung 180,00 €“. The time, the player and the author are rendered
 * around it by the list.
 */
export function describeEntry(entry: Pick<SessionEntry, 'type' | 'amountCents' | 'payment'>): string {
  const amount = formatCents(entry.amountCents);

  if (entry.type === 'buy_in') {
    return `Buy-in ${amount} ${entry.payment === 'credit' ? 'Liste' : 'bar'}`;
  }
  if (entry.type === 'cash_out') return `Stack ${amount}`;
  return `Bar-Auszahlung ${amount}`;
}

/** Success toast after a buy-in: „100,00 € bar für Ali eingetragen“. */
export function buyInToast(amountCents: number, payment: 'cash' | 'credit', name: string): string {
  return `${formatCents(amountCents)} ${payment === 'credit' ? 'auf Liste' : 'bar'} für ${name} eingetragen`;
}
