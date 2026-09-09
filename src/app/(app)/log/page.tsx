import { redirect } from 'next/navigation';
import { AuditLogList } from '@/components/audit/AuditLogList';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { loginPathFor } from '@/lib/auth/paths';
import { parseAuditFilters } from '@/lib/audit/filters';
import { getAuditFilterOptions, getAuditPage } from '@/lib/queries/auditLog';

/**
 * Audit log (docs/ARBEITSPAKETE.md WP8, step 3). Readable for every logged-in
 * role (SPEC §4) — nobody can write it, so there is no role check beyond being
 * logged in; RLS enforces the rest.
 *
 * The first page and the filter options are rendered on the server; the client
 * component appends further pages through a server action.
 */
export default async function LogPage({ searchParams }: PageProps<'/log'>) {
  const user = await getCurrentUser();
  if (user === null) redirect(loginPathFor('/log'));

  const filters = parseAuditFilters(await searchParams);
  const [page, options] = await Promise.all([getAuditPage(filters), getAuditFilterOptions()]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Log</h1>
        <p className="text-sm opacity-70">
          Jede Änderung, neueste zuerst. Nichts hier lässt sich ändern oder löschen.
        </p>
      </div>

      {page.ok ? (
        <AuditLogList
          initialEntries={page.data.entries}
          initialNames={page.data.names}
          initialCursor={page.data.nextCursor}
          filters={filters}
          options={options}
        />
      ) : (
        <p className="rounded-2xl border border-dashed border-red-500/40 px-4 py-6 text-sm">
          Das Log konnte gerade nicht geladen werden. Bitte die Seite neu laden.
        </p>
      )}
    </section>
  );
}
