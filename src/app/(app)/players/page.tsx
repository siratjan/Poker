import { redirect } from 'next/navigation';
import { PlayersManager } from '@/components/players/PlayersManager';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { loginPathFor } from '@/lib/auth/paths';
import { canEdit } from '@/lib/auth/roles';
import { listPlayers } from '@/lib/queries/players';

/**
 * Player list (docs/ARBEITSPAKETE.md WP4, step 6). Preliminary — WP7 adds the
 * balances and sorting. Editors can create and rename; viewers read only.
 */
export default async function PlayersPage() {
  const user = await getCurrentUser();
  if (user === null) redirect(loginPathFor('/players'));

  const players = await listPlayers();

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Spieler</h1>
      <PlayersManager players={players} canEdit={canEdit(user.role)} />
    </section>
  );
}
