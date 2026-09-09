import { redirect } from 'next/navigation';
import { PlayersManager } from '@/components/players/PlayersManager';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { loginPathFor } from '@/lib/auth/paths';
import { canEdit } from '@/lib/auth/roles';
import { listPlayerStats } from '@/lib/queries/players';

/**
 * Player overview (docs/ARBEITSPAKETE.md WP7, step 2): every player with the
 * totals over all closed evenings, searchable and sortable. Editors can create
 * and rename (WP4), viewers read only.
 *
 * A failed query is not rendered as „nobody there“ (Gaby WP5, F6): it gets its
 * own hint, so a transient error can never look like an empty list.
 */
export default async function PlayersPage() {
  const user = await getCurrentUser();
  if (user === null) redirect(loginPathFor('/players'));

  const result = await listPlayerStats();

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Spieler</h1>

      {result.ok ? (
        <PlayersManager players={result.data} canEdit={canEdit(user.role)} />
      ) : (
        <p className="rounded-2xl border border-dashed border-red-500/40 px-4 py-6 text-sm">
          Die Spieler konnten gerade nicht geladen werden. Bitte die Seite neu laden.
        </p>
      )}
    </section>
  );
}
