import { notFound, redirect } from 'next/navigation';
import { SessionStatusBadge } from '@/components/ui/Badge';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { loginPathFor } from '@/lib/auth/paths';
import { getSessionHeader } from '@/lib/queries/sessions';
import { formatPlayedOn } from '@/lib/time';

/**
 * Session detail (docs/ARBEITSPAKETE.md WP4, step 8). Preliminary: header only
 * (date, name, status). WP5 fills participants, entries and realtime.
 */
export default async function SessionDetailPage({ params }: PageProps<'/sessions/[id]'>) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (user === null) redirect(loginPathFor(`/sessions/${id}`));

  const session = await getSessionHeader(id);
  if (session === null) notFound();

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{formatPlayedOn(session.playedOn)}</h1>
          <SessionStatusBadge status={session.status} />
        </div>
        {session.name ? <p className="text-sm opacity-80">{session.name}</p> : null}
      </header>

      <p className="rounded-2xl border border-dashed border-black/15 px-4 py-6 text-sm opacity-70 dark:border-white/15">
        Teilnehmer, Buy-ins und Abrechnung kommen mit dem nächsten Arbeitspaket.
      </p>
    </section>
  );
}
