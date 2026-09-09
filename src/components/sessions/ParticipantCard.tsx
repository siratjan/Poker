'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { formatCents } from '@/lib/money';
import type { DerivedParticipant } from '@/lib/session/derive';
import { buyInLabel, formatSignedCents, stackLabel } from '@/lib/session/labels';

/**
 * One participant of the session (docs/ARBEITSPAKETE.md WP5, step 4): name,
 * buy-ins split into cash and list, stack or „spielt noch“, payout, and the
 * result coloured as soon as a stack exists.
 *
 * Tapping opens the action sheet. A viewer (or a closed session) gets the same
 * card without the tap target — the UI only hides what RLS forbids anyway.
 */
export function ParticipantCard({
  participant,
  interactive,
  pendingBuyIns,
  onPrimary,
  onMenu,
}: {
  participant: DerivedParticipant;
  interactive: boolean;
  /** Number of buy-ins of this player that are still being saved. */
  pendingBuyIns: number;
  /**
   * Tap on the card itself: the buy-in sheet while the player is still
   * playing (that keeps a buy-in at three taps, DoD), the action sheet once
   * he has a stack.
   */
  onPrimary: () => void;
  /** The „…“ button: always the full action sheet. */
  onMenu: () => void;
}) {
  const body = (
    <div className="flex w-full items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-base font-semibold">{participant.name}</span>
        <span className="text-xs opacity-70">{buyInLabel(participant)}</span>
        <span className="text-xs opacity-70">
          {stackLabel(participant)}
          {participant.payout > 0 ? ` · bar erhalten ${formatCents(participant.payout)}` : ''}
        </span>
        {pendingBuyIns > 0 ? <span className="text-xs opacity-60">wird gespeichert …</span> : null}
      </div>

      <div className="shrink-0 text-right">
        {participant.net === null ? (
          <span className="text-sm opacity-50">–</span>
        ) : (
          <span
            className={clsx(
              'text-base font-semibold tabular-nums',
              participant.net > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : participant.net < 0
                  ? 'text-red-600 dark:text-red-400'
                  : 'opacity-70',
            )}
          >
            {formatSignedCents(participant.net)}
          </span>
        )}
      </div>
    </div>
  );

  // Without the action sheet (viewer, or a closed session) the whole card is
  // the link to the player's overall balance (WP7, step 4). With it, that link
  // sits in the action sheet, so the tap on the card stays the buy-in.
  if (!interactive) {
    return (
      <Link href={`/players/${participant.playerId}`} className="block">
        <Card className="flex min-h-[72px] items-center px-4 py-3 transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
          {body}
        </Card>
      </Link>
    );
  }

  return (
    <Card className="flex items-stretch transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
      <button
        type="button"
        onClick={onPrimary}
        aria-label={
          participant.stack === null
            ? `Buy-in für ${participant.name}`
            : `Aktionen für ${participant.name}`
        }
        className="flex min-h-[72px] flex-1 items-center py-3 pl-4 text-left"
      >
        {body}
      </button>
      <button
        type="button"
        onClick={onMenu}
        aria-label={`Weitere Aktionen für ${participant.name}`}
        className="flex w-11 shrink-0 items-center justify-center rounded-r-2xl text-lg opacity-50 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
      >
        ⋯
      </button>
    </Card>
  );
}
