'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { signOut } from '@/actions/auth';
import { ROLE_LABELS } from '@/lib/auth/roles';
import type { Role } from '@/lib/auth/roles';

export type UserMenuProps = {
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: Role;
};

/**
 * Avatar, name and role badge in the header; tapping opens the menu with
 * „Abmelden“. Client component because the menu has open/closed state — the
 * sign-out itself is a server action.
 */
export function UserMenu({ displayName, email, avatarUrl, role }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-h-[44px] items-center gap-2 rounded-full py-1 pr-2 pl-1 text-left transition hover:bg-black/5 dark:hover:bg-white/10"
      >
        <Avatar url={avatarUrl} name={displayName} />
        <span className="flex flex-col leading-tight">
          <span className="max-w-[9rem] truncate text-sm font-medium">{displayName}</span>
          <span className="text-[11px] opacity-60">{ROLE_LABELS[role]}</span>
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-black/10 bg-[var(--background)] shadow-lg dark:border-white/15"
        >
          <div className="border-b border-black/10 px-4 py-3 dark:border-white/10">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="truncate text-xs opacity-60">{email}</p>
            <p className="mt-1 text-xs opacity-60">Rolle: {ROLE_LABELS[role]}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              className="flex min-h-[44px] w-full items-center px-4 text-sm font-medium text-red-600 transition hover:bg-black/5 dark:text-red-400 dark:hover:bg-white/10"
            >
              Abmelden
            </button>
          </form>
        </div>
      )}
    </div>
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
        className="size-9 rounded-full object-cover"
        onError={() => setBroken(true)}
        // The Google avatar host is not in next.config images.remotePatterns on
        // purpose: `unoptimized` skips the optimizer (and its host check), so a
        // profile picture from any Google CDN host renders instead of crashing
        // the shell. If it fails anyway, the initials below take over.
        unoptimized
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="flex size-9 items-center justify-center rounded-full bg-emerald-600/15 text-sm font-semibold text-emerald-700 dark:text-emerald-300"
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
