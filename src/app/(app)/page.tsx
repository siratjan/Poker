import { RoleGate } from '@/components/auth/RoleGate';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { ROLE_LABELS } from '@/lib/auth/roles';

/**
 * Placeholder start page (WP2). WP4 replaces it with the session list.
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user === null) return null; // the layout has already redirected

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-2xl border border-black/10 p-4 dark:border-white/10">
        <h1 className="text-lg font-semibold">Angemeldet</h1>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="opacity-60">Name</dt>
          <dd>{user.displayName}</dd>
          <dt className="opacity-60">E-Mail</dt>
          <dd className="truncate">{user.email}</dd>
          <dt className="opacity-60">Rolle</dt>
          <dd>
            <span className="rounded-full bg-emerald-600/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              {ROLE_LABELS[user.role]}
            </span>
          </dd>
        </dl>
      </div>

      <RoleGate
        role={user.role}
        minimum="editor"
        fallback={
          <p className="text-sm opacity-70">
            Als Betrachter kannst du alles lesen, aber nichts erfassen.
          </p>
        }
      >
        <p className="text-sm opacity-70">
          Du darfst Sessions anlegen und Buy-ins erfassen. Die Ansichten dazu kommen im nächsten
          Paket.
        </p>
      </RoleGate>
    </section>
  );
}
