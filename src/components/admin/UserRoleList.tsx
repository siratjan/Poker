'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { setUserRole } from '@/actions/admin';
import { useWritesBlocked } from '@/components/app/ConnectionProvider';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { isRole, ROLE_LABELS, ROLES, type Role } from '@/lib/auth/roles';
import type { AdminUser } from '@/lib/queries/admin';

/**
 * The user list of the admin area (docs/ARBEITSPAKETE.md WP8, step 2): avatar,
 * name, e-mail, role dropdown, number of log entries.
 *
 * Changing the dropdown writes immediately through the server action. If the
 * database refuses — `LAST_ADMIN` is the case that matters (SPEC §3) — the
 * dropdown falls back to the stored role and the reason appears as a toast, so
 * the screen never shows a role that was not saved.
 */
export function UserRoleList({ users }: { users: AdminUser[] }) {
  if (users.length === 0) {
    return <p className="text-sm opacity-70">Noch hat sich niemand angemeldet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {users.map((user) => (
        <li key={user.id}>
          <UserRow user={user} />
        </li>
      ))}
    </ul>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const router = useRouter();
  const { showSuccess, showError } = useToast();
  const [role, setRole] = useState<Role>(user.role);
  const [pending, setPending] = useState(false);
  const offline = useWritesBlocked();

  async function onChange(next: Role) {
    if (offline) return;
    const previous = role;
    setRole(next);
    setPending(true);

    const result = await setUserRole({ userId: user.id, role: next });
    setPending(false);

    if (!result.ok) {
      setRole(previous);
      showError(result.error.message);
      return;
    }

    showSuccess(`${user.displayName ?? user.email} ist jetzt ${ROLE_LABELS[next]}.`);
    router.refresh();
  }

  return (
    <Card className="flex items-center gap-3 px-4 py-3">
      <Avatar url={user.avatarUrl} name={user.displayName ?? user.email} />

      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium">{user.displayName ?? user.email}</span>
        <span className="truncate text-xs opacity-60">{user.email}</span>
        <span className="text-xs opacity-60">
          {user.logCount === 1 ? '1 Eintrag im Log' : `${user.logCount} Einträge im Log`}
        </span>
      </div>

      <label className="sr-only" htmlFor={`role-${user.id}`}>
        Rolle von {user.displayName ?? user.email}
      </label>
      <select
        id={`role-${user.id}`}
        value={role}
        disabled={pending || offline}
        onChange={(event) => {
          const value = event.target.value;
          if (isRole(value)) void onChange(value);
        }}
        className="min-h-[44px] rounded-xl border border-black/15 bg-transparent px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 disabled:opacity-60 dark:border-white/20"
      >
        {ROLES.map((value) => (
          <option
            key={value}
            value={value}
            className="bg-[var(--background)] text-[var(--foreground)]"
          >
            {ROLE_LABELS[value]}
          </option>
        ))}
      </select>
    </Card>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }) {
  const [broken, setBroken] = useState(false);

  if (url !== null && !broken) {
    return (
      <Image
        src={url}
        alt=""
        width={36}
        height={36}
        className="size-9 shrink-0 rounded-full object-cover"
        onError={() => setBroken(true)}
        // Same reasoning as in UserMenu: skip the optimizer, so any Google CDN
        // host works; the initials take over if the picture fails anyway.
        unoptimized
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-600/15 text-sm font-semibold text-emerald-700 dark:text-emerald-300"
    >
      {initials(name)}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
