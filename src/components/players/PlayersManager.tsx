'use client';

import { clsx } from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { createPlayer, renamePlayer } from '@/actions/players';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { NetAmount } from '@/components/players/NetAmount';
import { useToast } from '@/components/ui/Toast';
import { formatCents } from '@/lib/money';
import {
  DEFAULT_SORT,
  SORT_KEYS,
  SORT_LABELS,
  nextSortState,
  visiblePlayers,
  type SortState,
} from '@/lib/players/stats';
import type { PlayerStats } from '@/lib/queries/players';

/**
 * Player overview (docs/ARBEITSPAKETE.md WP7, step 2): every player with his
 * totals over all closed evenings, searchable, sortable by tapping a column
 * head, balance coloured. Creating and renaming from WP4 stays.
 *
 * Deviation from „Tabelle“: five money columns are not readable on a 360 px
 * phone, so the column heads are a sort bar above the list and each row is a
 * card whose numbers sit in a fixed grid — they line up like a table without
 * the page ever scrolling sideways. WP7 allows „Tabelle/Karten“.
 *
 * The rows come pre-rendered from the server. After a write the action has
 * already revalidated `/players` and `router.refresh()` pulls the fresh server
 * component, so there is no client-side list state to keep in sync; searching
 * and sorting are pure functions over the server data
 * (`src/lib/players/stats.ts`).
 */
export function PlayersManager({
  players,
  canEdit,
}: {
  players: PlayerStats[];
  canEdit: boolean;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const rows = useMemo(() => visiblePlayers(players, query, sort), [players, query, sort]);

  if (players.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {canEdit ? <CreatePlayer /> : null}
        <EmptyState
          title="Noch keine Spieler."
          description={canEdit ? 'Leg den ersten Spieler an.' : 'Ein Bearbeiter kann Spieler anlegen.'}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? <CreatePlayer /> : null}

      <input
        type="search"
        value={query}
        maxLength={40}
        placeholder="Spieler suchen"
        aria-label="Spieler suchen"
        onChange={(event) => setQuery(event.target.value)}
        className="min-h-[44px] w-full rounded-xl border border-black/15 bg-transparent px-3 text-base outline-none focus:border-emerald-500 dark:border-white/20"
      />

      <SortBar sort={sort} onChange={(key) => setSort((current) => nextSortState(current, key))} />

      {rows.length === 0 ? (
        <EmptyState title="Kein Spieler gefunden." description="Andere Schreibweise probieren." />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((player) => (
            <li key={player.id}>
              <PlayerRow player={player} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The column heads: tap sorts, tapping the active one flips the direction. */
function SortBar({
  sort,
  onChange,
}: {
  sort: SortState;
  onChange: (key: (typeof SORT_KEYS)[number]) => void;
}) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label="Sortierung">
      {SORT_KEYS.map((key) => {
        const active = sort.key === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={active}
            aria-label={
              active
                ? `Nach ${SORT_LABELS[key]} sortieren, aktuell ${
                    sort.direction === 'asc' ? 'aufsteigend' : 'absteigend'
                  }`
                : `Nach ${SORT_LABELS[key]} sortieren`
            }
            className={clsx(
              'min-h-[44px] shrink-0 rounded-xl px-3 text-sm font-medium transition',
              active
                ? 'bg-emerald-600 text-white'
                : 'border border-black/15 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10',
            )}
          >
            {SORT_LABELS[key]}
            {active ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
          </button>
        );
      })}
    </div>
  );
}

function CreatePlayer() {
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await createPlayer({ name });
    setPending(false);

    if (result.ok) {
      setName('');
      showSuccess('Spieler angelegt.');
      router.refresh();
      return;
    }
    setError(result.error.message);
    if (result.error.code !== 'VALIDATION' && result.error.code !== 'PLAYER_EXISTS') {
      showError(result.error.message);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Input
        label="Spieler anlegen"
        name="name"
        type="text"
        value={name}
        maxLength={40}
        placeholder="Name"
        error={error}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" disabled={pending || name.trim().length === 0}>
        {pending ? 'Wird angelegt …' : 'Anlegen'}
      </Button>
    </form>
  );
}

function PlayerRow({ player, canEdit }: { player: PlayerStats; canEdit: boolean }) {
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function startEditing() {
    setName(player.name);
    setError(null);
    setEditing(true);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = await renamePlayer({ id: player.id, name });
    setPending(false);

    if (result.ok) {
      setEditing(false);
      showSuccess('Spieler umbenannt.');
      router.refresh();
      return;
    }
    setError(result.error.message);
    if (result.error.code !== 'VALIDATION' && result.error.code !== 'PLAYER_EXISTS') {
      showError(result.error.message);
    }
  }

  if (editing) {
    return (
      <Card className="p-3">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Input
            label="Neuer Name"
            name={`rename-${player.id}`}
            type="text"
            value={name}
            maxLength={40}
            autoFocus
            error={error}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || name.trim().length === 0} className="flex-1">
              {pending ? 'Speichert …' : 'Speichern'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Abbrechen
            </Button>
          </div>
        </form>
      </Card>
    );
  }

  return (
    <Card className="flex items-stretch transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
      <Link
        href={`/players/${player.id}`}
        className="flex min-h-[64px] flex-1 flex-col justify-center gap-1 py-2 pl-4 pr-2"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-base font-semibold">{player.name}</span>
            {player.openSessions > 0 ? <Badge tone="success">läuft</Badge> : null}
          </span>
          <NetAmount cents={player.netCents} played={player.sessionsPlayed > 0} />
        </div>

        <div className="grid grid-cols-[3.5rem_1fr_1fr] gap-2 text-xs tabular-nums opacity-70">
          <span>
            {player.sessionsPlayed}&nbsp;Sess.
          </span>
          <span className="truncate text-right">
            <span className="opacity-70">Buy-in </span>
            {formatCents(player.totalBuyInCents)}
          </span>
          <span className="truncate text-right">
            <span className="opacity-70">Stack </span>
            {formatCents(player.totalStackCents)}
          </span>
        </div>
      </Link>

      {canEdit ? (
        <button
          type="button"
          onClick={startEditing}
          aria-label={`${player.name} umbenennen`}
          className="flex w-11 shrink-0 items-center justify-center rounded-r-2xl text-base opacity-50 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        >
          ✎
        </button>
      ) : null}
    </Card>
  );
}
