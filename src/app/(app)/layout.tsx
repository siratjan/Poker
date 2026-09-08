import { redirect } from 'next/navigation';
import { TabBar } from '@/components/app/TabBar';
import { UserMenu } from '@/components/app/UserMenu';
import { getCurrentUser } from '@/lib/auth/getCurrentUser';
import { loginPathFor } from '@/lib/auth/paths';
import { isAdmin } from '@/lib/auth/roles';

/**
 * App shell for everything behind the login: header with avatar, name and role
 * badge, content, bottom tab bar. Mobile first.
 *
 * The proxy already redirects visitors without a session; the check here is the
 * second lock, for the case that the proxy is ever bypassed (matcher change,
 * direct RSC request).
 */
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await getCurrentUser();
  if (user === null) redirect(loginPathFor('/'));

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-[var(--background)]/95 backdrop-blur dark:border-white/10">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2">
          <span className="text-base font-semibold tracking-tight">Poker-Kasse</span>
          <UserMenu
            displayName={user.displayName}
            email={user.email}
            avatarUrl={user.avatarUrl}
            role={user.role}
          />
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-28">{children}</main>

      <TabBar showAdmin={isAdmin(user.role)} />
    </div>
  );
}
