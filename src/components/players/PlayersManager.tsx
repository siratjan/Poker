'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createPlayer, renamePlayer } from '@/actions/players';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import type { PlayerListItem } from '@/lib/queries/players';

/**
 * Player administration (docs/ARBEITSPAKETE.md WP4, step 6): create a player,
 * rename inline. Editors only — a viewer gets the read-only list.
 *
 * The list comes pre-rendered from the server. After a write the action has
 * already revalidated `/players`, and `router.refresh()` pulls the fresh server
 * component, so there is no client-side list state to keep in sync.
 */
export function PlayersManager({
  players,
  canEdit,
}: {
  players: PlayerListItem[];
  canEdit: boolean;
}) {
  if (players.length === 0 && !canEdit) {
    return <EmptyState title="Noch keine Spieler." />;
  }

  return (
    <div className="flex flex-col gap-4">
      {canEdit ? <CreatePlayer /> : null}

      {players.length === 0 ? (
        <EmptyState title="Noch keine Spieler." description="Leg den ersten Spieler an." />
      ) : (
        <ul className="flex flex-col gap-2">
          {players.map((player) => (
            <li key={player.id}>
              <PlayerRow player={player} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
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

function PlayerRow({ player, canEdit }: { player: PlayerListItem; canEdit: boolean }) {
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
    <Card className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3">
      <span className="truncate font-medium">{player.name}</span>
      {canEdit ? (
        <Button variant="secondary" onClick={startEditing}>
          Umbenennen
        </Button>
      ) : null}
    </Card>
  );
}
