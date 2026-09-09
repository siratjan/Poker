import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { NetAmount } from '@/components/players/NetAmount';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { loginPathFor } from '@/lib/auth/paths';
import { formatCents } from '@/lib/money';
import { getPlayerDetail, type PlayerSessionRow, type PlayerStats } from '@/lib/queries/players';
import { formatPlayedOn } from '@/lib/time';

/**
 * Player detail (docs/ARBEITSPAKETE.md WP7, step 3): the overall balance on
 * top, then one row per evening, newest first, each linking to its session.
 *
 * A closed evening shows the frozen numbers of its settlement line — never a
 * recomputation (CLAUDE.md). A running evening shows what has been recorded so
 * far and is marked „läuft“ without a result.
 *
 * A missing player is a 404, a broken query gets its own hint (Gaby WP4,
 * F1/F2).
 */
export default async function PlayerDetailPage({ params }: PageProps<'/players/[id]'>) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (user === null) redirect(loginPathFor(`/players/${id}`));

  const result = await getPlayerDetail(id);
  if (!result.ok && result.reason === 'not_found') notFound();

  if (!result.ok) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Spieler</h1>
        <p className="rounded-2xl border border-dashed border-red-500/40 px-4 py-6 text-sm">
          Der Spieler konnte gerade nicht geladen werden. Bitte die Seite neu laden.
        </p>
      </section>
    );
  }

  const { stats, sessions } = result.data;

  return (
    <section className="flex flex-col gap-4">
      <Link href="/players" className="text-sm opacity-70 hover:opacity-100">
        ← Alle Spieler
      </Link>

      <PlayerHeader stats={stats} />

      <div className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">Abende</h2>

        {sessions.length === 0 ? (
          <EmptyState
            title="Noch keine Session."
            description={`${stats.name} war bisher an keinem Abend dabei.`}
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((session) => (
              <li key={session.sessionId}>
                <SessionRow session={session} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function PlayerHeader({ stats }: { stats: PlayerStats }) {
  const played = stats.sessionsPlayed > 0;

  return (
    <Card className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="truncate text-xl font-semibold">{stats.name}</h1>
        <NetAmount cents={stats.netCents} played={played} className="text-xl" />
      </div>

      <p className="text-xs opacity-70">
        {played
          ? `Gesamtbilanz aus ${stats.sessionsPlayed} abgeschlossenen ${
              stats.sessionsPlayed === 1 ? 'Abend' : 'Abenden'
            }`
          : 'Noch kein abgeschlossener Abend.'}
      </p>

      <dl className="grid grid-cols-2 gap-y-1 text-sm tabular-nums">
        <dt className="opacity-70">Buy-ins</dt>
        <dd className="text-right">{formatCents(stats.totalBuyInCents)}</dd>
        <dt className="opacity-70">Stacks</dt>
        <dd className="text-right">{formatCents(stats.totalStackCents)}</dd>
        <dt className="opacity-70">Zuletzt gespielt</dt>
        <dd className="text-right">
          {stats.lastPlayedOn === null ? '–' : formatPlayedOn(stats.lastPlayedOn)}
        </dd>
      </dl>

      {stats.openSessions > 0 ? (
        <p className="text-xs">
          <Badge tone="success">
            {stats.openSessions === 1 ? 'Eine offene Session' : `${stats.openSessions} offene Sessions`}
          </Badge>
        </p>
      ) : null}
    </Card>
  );
}

function SessionRow({ session }: { session: PlayerSessionRow }) {
  const isOpen = session.status === 'open';

  const buyIns: string[] = [];
  if (session.cashInCents > 0) buyIns.push(`${formatCents(session.cashInCents)} bar`);
  if (session.creditInCents > 0) buyIns.push(`${formatCents(session.creditInCents)} Liste`);

  return (
    <Link href={`/sessions/${session.sessionId}`} className="block">
      <Card className="flex min-h-[64px] flex-col justify-center gap-1 px-4 py-3 transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold">
              {formatPlayedOn(session.playedOn)}
            </span>
            {session.sessionName === null ? null : (
              <span className="truncate text-sm opacity-70">{session.sessionName}</span>
            )}
          </span>

          {session.netCents !== null ? (
            <NetAmount cents={session.netCents} />
          ) : isOpen ? (
            <Badge tone="success">läuft</Badge>
          ) : (
            // Closed without a settlement line — cannot happen through the app,
            // shown as „kein Ergebnis“ rather than as a made-up 0,00 €.
            <span className="shrink-0 text-sm opacity-70">kein Ergebnis</span>
          )}
        </div>

        <div className="flex justify-between gap-3 text-xs tabular-nums opacity-70">
          <span className="truncate">
            {buyIns.length === 0 ? 'noch kein Buy-in' : buyIns.join(' + ')}
          </span>
          <span className="shrink-0">
            {session.stackCents === null
              ? 'spielt noch'
              : `Stack ${formatCents(session.stackCents)}`}
          </span>
        </div>
      </Card>
    </Link>
  );
}
