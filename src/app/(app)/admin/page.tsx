import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { isAdmin } from '@/lib/auth/roles';

/**
 * Placeholder for the admin area (WP8 fills it).
 *
 * The point of having it already: the route is protected on the server, not
 * just hidden in the tab bar — typing /admin as an editor shows „Kein Zugriff“.
 */
export default async function AdminPage() {
  const user = await getCurrentUser();

  if (!isAdmin(user?.role)) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Kein Zugriff</h1>
        <p className="text-sm opacity-70">Diesen Bereich dürfen nur Admins sehen.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-lg font-semibold">Admin</h1>
      <p className="text-sm opacity-70">
        Rollen, Whitelist und Schnellbeträge kommen in einem späteren Paket.
      </p>
    </section>
  );
}
