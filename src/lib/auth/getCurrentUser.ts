import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { isRole, type Role } from './roles';

export type CurrentUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: Role;
};

/**
 * The logged-in user together with the role from `app_users`, or `null`.
 *
 * Wrapped in `React.cache()`, so a request that asks several times (layout,
 * page, server action) hits Supabase only once.
 *
 * `auth.getUser()` is deliberately used instead of `auth.getSession()`: only
 * `getUser()` verifies the token against the auth server, cookies alone are
 * not trusted.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError !== null || user === null) return null;

  const { data: profile, error: profileError } = await supabase
    .from('app_users')
    .select('id, email, display_name, avatar_url, role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError !== null) {
    // The session is valid but the profile row cannot be read (RLS, migrations
    // not applied yet). Treating this as "logged out" would hide the cause, so
    // it is logged and the caller sees a viewer without a name.
    console.error('[auth] app_users konnte nicht gelesen werden:', profileError.message);
  }

  const email = profile?.email ?? user.email ?? '';

  return {
    id: user.id,
    email,
    displayName: displayNameFor(profile?.display_name ?? null, user.user_metadata, email),
    avatarUrl: profile?.avatar_url ?? avatarFrom(user.user_metadata),
    // The database is the single source of truth for the role; without a row
    // the safest assumption is the weakest role (see WORKFLOW: "im Zweifel
    // verbieten"). RLS enforces the real rights either way.
    role: isRole(profile?.role) ? profile.role : 'viewer',
  };
});

function displayNameFor(
  stored: string | null,
  metadata: Record<string, unknown> | undefined,
  email: string,
): string {
  const candidates = [
    stored,
    stringOrNull(metadata?.full_name),
    stringOrNull(metadata?.name),
    email.split('@')[0],
  ];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value) return value;
  }
  return 'Unbekannt';
}

function avatarFrom(metadata: Record<string, unknown> | undefined): string | null {
  return stringOrNull(metadata?.avatar_url) ?? stringOrNull(metadata?.picture);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
