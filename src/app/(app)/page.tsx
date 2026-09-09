import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SessionStatusBadge } from '@/components/ui/Badge';
import { buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { loginPathFor } from '@/lib/auth/paths';
import { canEdit } from '@/lib/auth/roles';
import { formatCents } from '@/lib/money';
import { listSessions, type SessionListItem } from '@/lib/queries/sessions';
import { formatPlayedOn } from '@/lib/time';

/**
 * Session list / start page (docs/ARBEITSPAKETE.md WP4, step 4). Newest first,
 * one card per session, sticky „Neue Session“ button for editors.
 */
export default async function SessionsPage() {
  const user = await getCurrentUser();
  if (user === null) redirect(loginPathFor('/'));

  const result = await listSessions();
  const mayEdit = canEdit(user.role);

  // A failed query gets its own hint instead of looking like „no session yet“
  // (Gaby WP5, F6).
  if (!result.ok) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Sessions</h1>
        <p className="rounded-2xl border border-dashed border-red-500/40 px-4 py-6 text-sm">
          Die Sessions konnten gerade nicht geladen werden. Bitte die Seite neu laden.
        </p>
      </section>
    );
  }

  const sessions = result.data;

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Sessions</h1>

      {sessions.length === 0 ? (
        <EmptyState
          title="Noch keine Session."
          description={mayEdit ? 'Leg die erste an.' : 'Ein Bearbeiter kann die erste anlegen.'}
          action={
            mayEdit ? (
              <Link href="/sessions/new" className={buttonClasses({ size: 'lg' })}>
                Neue Session
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.map((session) => (
            <li key={session.id}>
              <SessionCard session={session} />
            </li>
          ))}
        </ul>
      )}

      {mayEdit && sessions.length > 0 ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 px-4"
          style={{ paddingBottom: 'calc(72px + env(safe-area-inset-bottom))' }}
        >
          <div className="mx-auto max-w-2xl">
            <Link
              href="/sessions/new"
              className={buttonClasses({ size: 'lg', className: 'w-full shadow-lg' })}
            >
              Neue Session
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function SessionCard({ session }: { session: SessionListItem }) {
  // „Spieler“ is the same in singular and plural.
  const participants = `${session.participantCount} Spieler`;
  const buyIns = `${formatCents(session.totalBuyInCents)} Buy-ins`;

  return (
    <Link href={`/sessions/${session.id}`} className="block">
      <Card className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-semibold">{formatPlayedOn(session.playedOn)}</span>
          {session.name ? <span className="truncate text-sm opacity-80">{session.name}</span> : null}
          <span className="text-xs opacity-60">
            {participants} · {buyIns}
          </span>
        </div>
        <SessionStatusBadge status={session.status} />
      </Card>
    </Link>
  );
}
