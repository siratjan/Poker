'use client';

import { Card } from '@/components/ui/Card';
import type { SessionEntry } from '@/lib/session/derive';
import { describeEntry } from '@/lib/session/labels';
import { formatBerlinTime } from '@/lib/time';

/**
 * Chronological history of all entries (docs/ARBEITSPAKETE.md WP5, step 4):
 * `21:14 · Ali · Buy-in 100,00 € bar · von sirat@…`, newest first.
 *
 * Deleted entries do not appear here — they live in the audit log (SPEC §4).
 * Editors can delete an entry; the confirmation sheet belongs to the parent.
 */
export function HistoryList({
  entries,
  nameFor,
  canEdit,
  onDelete,
}: {
  /** Already sorted, newest first. */
  entries: readonly SessionEntry[];
  nameFor: (playerId: string) => string;
  canEdit: boolean;
  onDelete: (entry: SessionEntry) => void;
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-black/15 px-4 py-6 text-center text-sm opacity-70 dark:border-white/15">
        Noch keine Einträge.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li key={entry.id}>
          <Card className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm">
                <span className="tabular-nums opacity-60">{formatBerlinTime(entry.createdAt)}</span>
                {' · '}
                <span className="font-medium">{nameFor(entry.playerId)}</span>
                {' · '}
                {describeEntry(entry)}
              </span>
              <span className="truncate text-xs opacity-60">
                {entry.createdByName === null ? 'Erfasser unbekannt' : `von ${entry.createdByName}`}
              </span>
            </div>

            {canEdit ? (
              <button
                type="button"
                onClick={() => onDelete(entry)}
                aria-label={`Eintrag löschen: ${describeEntry(entry)} für ${nameFor(entry.playerId)}`}
                className="flex size-11 shrink-0 items-center justify-center rounded-full text-base opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
              >
                ✕
              </button>
            ) : null}
          </Card>
        </li>
      ))}
    </ul>
  );
}
