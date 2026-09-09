import { createClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/auth/roles';
import { DEFAULT_QUICK_AMOUNTS_CENTS, parseQuickAmounts } from './sessionDetail';

/**
 * Read queries for the admin area (docs/ARBEITSPAKETE.md WP8, step 2). Server
 * only. `app_users` is readable for everybody, `role_whitelist` only for admins
 * (0003) — the page is behind an admin check, and RLS is the real gate.
 */

export type AdminUser = {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: Role;
  /** Number of rows this user caused in `audit_log`. */
  logCount: number;
};

export type WhitelistEntry = {
  email: string;
  role: Role;
  note: string | null;
  createdAt: string;
};

export type AdminData = {
  users: AdminUser[];
  whitelist: WhitelistEntry[];
  quickAmountsCents: number[];
};

export async function getAdminData(): Promise<AdminData> {
  const supabase = await createClient();

  const [usersResult, whitelistResult, settingsResult] = await Promise.all([
    supabase
      .from('app_users')
      .select('id, email, display_name, avatar_url, role')
      .order('email', { ascending: true }),
    supabase
      .from('role_whitelist')
      .select('email, role, note, created_at')
      .order('email', { ascending: true }),
    supabase.from('settings').select('key, value').eq('key', 'quick_amounts_cents').maybeSingle(),
  ]);

  if (usersResult.error !== null) {
    console.error('[queries] getAdminData (app_users):', usersResult.error.message);
  }
  if (whitelistResult.error !== null) {
    console.error('[queries] getAdminData (role_whitelist):', whitelistResult.error.message);
  }
  if (settingsResult.error !== null) {
    console.error('[queries] getAdminData (settings):', settingsResult.error.message);
  }

  const userRows = usersResult.data ?? [];
  const logCounts = await countLogEntries(
    supabase,
    userRows.map((row) => row.id),
  );

  return {
    users: userRows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      role: row.role,
      logCount: logCounts.get(row.id) ?? 0,
    })),
    whitelist: (whitelistResult.data ?? []).map((row) => ({
      email: row.email,
      role: row.role,
      note: row.note,
      createdAt: row.created_at,
    })),
    quickAmountsCents: parseQuickAmounts(settingsResult.data?.value ?? null),
  };
}

export { DEFAULT_QUICK_AMOUNTS_CENTS };

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Log entries per user. One `head` count query per user — the app has a handful
 * of accounts, and counting them in the database beats pulling a five-figure
 * log into the server just to group it.
 */
async function countLogEntries(
  supabase: ServerClient,
  userIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (userIds.length === 0) return counts;

  const results = await Promise.all(
    userIds.map(async (id) => {
      const { count, error } = await supabase
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', id);

      if (error !== null) {
        console.error('[queries] getAdminData (audit count):', error.message);
        return [id, 0] as const;
      }
      return [id, count ?? 0] as const;
    }),
  );

  for (const [id, count] of results) counts.set(id, count);
  return counts;
}
