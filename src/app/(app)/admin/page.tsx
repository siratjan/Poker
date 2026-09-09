import { redirect } from 'next/navigation';
import { QuickAmountsEditor } from '@/components/admin/QuickAmountsEditor';
import { UserRoleList } from '@/components/admin/UserRoleList';
import { WhitelistManager } from '@/components/admin/WhitelistManager';
import { Card } from '@/components/ui/Card';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { loginPathFor } from '@/lib/auth/paths';
import { isAdmin } from '@/lib/auth/roles';
import { getAdminData } from '@/lib/queries/admin';

/**
 * Admin area (docs/ARBEITSPAKETE.md WP8, step 2): roles, whitelist, quick
 * amounts.
 *
 * The route is protected on the server, not just hidden in the tab bar —
 * calling /admin as an editor shows „Kein Zugriff“ and loads nothing. RLS is
 * the actual boundary: even if this check were bypassed, `role_whitelist` reads
 * empty and every write is refused for anyone but an admin (0003).
 */
export default async function AdminPage() {
  const user = await getCurrentUser();
  if (user === null) redirect(loginPathFor('/admin'));

  if (!isAdmin(user.role)) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Kein Zugriff</h1>
        <p className="text-sm opacity-70">Diesen Bereich dürfen nur Admins sehen.</p>
      </section>
    );
  }

  const { users, whitelist, quickAmountsCents } = await getAdminData();

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Admin</h1>

      <Section
        title="Nutzer"
        description="Rolle ändern wirkt sofort. Der letzte Admin kann nicht degradiert werden."
      >
        <UserRoleList users={users} />
      </Section>

      <Section
        title="Whitelist"
        description="Rolle für Adressen, die sich noch nie angemeldet haben."
      >
        <WhitelistManager entries={whitelist} />
      </Section>

      <Section title="Schnellbeträge" description="Die Buttons im Buy-in-Fenster.">
        <QuickAmountsEditor amountsCents={quickAmountsCents} />
      </Section>
    </section>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 px-4 py-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs opacity-60">{description}</p>
      </div>
      {children}
    </Card>
  );
}
