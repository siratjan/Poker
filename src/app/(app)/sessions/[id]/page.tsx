import { notFound, redirect } from 'next/navigation';
import { SessionDetailClient } from '@/components/sessions/SessionDetailClient';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { loginPathFor } from '@/lib/auth/paths';
import { canEdit } from '@/lib/auth/roles';
import { listPlayers } from '@/lib/queries/players';
import { getSessionDetail } from '@/lib/queries/sessionDetail';

/**
 * Session detail (docs/ARBEITSPAKETE.md WP5, step 4). The server component
 * loads the whole screen once; `SessionDetailClient` keeps it live via realtime
 * and refreshes this component after every write.
 *
 * A failed query is *not* rendered as „nothing here“ (Gaby WP4, F1/F2): a
 * missing row is a 404, a broken query gets its own hint, so a transient error
 * can never look like an empty session.
 */
export default async function SessionDetailPage({ params }: PageProps<'/sessions/[id]'>) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (user === null) redirect(loginPathFor(`/sessions/${id}`));

  const result = await getSessionDetail(id);
  if (!result.ok && result.reason === 'not_found') notFound();

  if (!result.ok) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">Session</h1>
        <p className="rounded-2xl border border-dashed border-red-500/40 px-4 py-6 text-sm">
          Die Session konnte gerade nicht geladen werden. Bitte die Seite neu laden.
        </p>
      </section>
    );
  }

  const mayEdit = canEdit(user.role);
  // The player list is only needed for the „Teilnehmer hinzufügen“ sheet.
  const allPlayers = mayEdit && result.data.session.status === 'open' ? await listPlayers() : [];

  return (
    <SessionDetailClient detail={result.data} allPlayers={allPlayers} canEdit={mayEdit} />
  );
}
