'use server';

import { revalidatePath } from 'next/cache';
import type { PostgrestError } from '@supabase/supabase-js';
import { actionResult, AppError, type ActionResult } from '@/lib/actions/result';
import { requireAdmin } from '@/lib/auth/requireRole';
import type { Role } from '@/lib/auth/roles';
import { translateDbError } from '@/lib/errors/de';
import { createClient } from '@/lib/supabase/server';
import { parseInput } from '@/lib/validation/parse';
import {
  removeWhitelistSchema,
  setQuickAmountsSchema,
  setUserRoleSchema,
  upsertWhitelistSchema,
} from '@/lib/validation/admin';

/**
 * Admin server actions (docs/ARBEITSPAKETE.md WP8, step 1): roles, whitelist,
 * quick buy-in amounts.
 *
 * `requireAdmin()` is politeness for a readable message; the boundary is the
 * database (CLAUDE.md): the RLS policies of 0003 let only an admin write
 * `app_users.role`, `role_whitelist` and `settings`, the trigger
 * `protect_app_user_columns` refuses everything but the role column, and
 * `protect_last_admin` refuses the demotion that would leave the app without an
 * admin (`LAST_ADMIN`, SPEC §3).
 */

const QUICK_AMOUNTS_KEY = 'quick_amounts_cents';
const USER_NOT_FOUND = 'Diesen Nutzer gibt es nicht (mehr).';
const WHITELIST_NOT_FOUND = 'Diese Adresse steht nicht auf der Liste.';

/** Changes the role of another user (or one's own, unless it is the last admin). */
export async function setUserRole(input: unknown): Promise<ActionResult<{ userId: string; role: Role }>> {
  return actionResult(async () => {
    await requireAdmin();
    const { userId, role } = parseInput(setUserRoleSchema, input);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('app_users')
      .update({ role })
      .eq('id', userId)
      .select('id, role')
      .maybeSingle();

    if (error !== null) throw mapAdminError(error, 'setUserRole');
    if (data === null) throw new AppError('USER_NOT_FOUND', USER_NOT_FOUND);

    revalidatePath('/admin');
    return { userId: data.id, role: data.role };
  });
}

/**
 * Replaces the quick buy-in amounts. The schema sorts them and rejects
 * duplicates, so `settings.quick_amounts_cents` always holds 1–6 ascending
 * integer amounts.
 */
export async function setQuickAmounts(input: unknown): Promise<ActionResult<{ cents: number[] }>> {
  return actionResult(async () => {
    await requireAdmin();
    const { cents } = parseInput(setQuickAmountsSchema, input);

    const supabase = await createClient();
    const { error } = await supabase
      .from('settings')
      .upsert({ key: QUICK_AMOUNTS_KEY, value: cents }, { onConflict: 'key' });

    if (error !== null) throw mapAdminError(error, 'setQuickAmounts');

    // Every screen with a buy-in sheet shows these buttons.
    revalidatePath('/admin');
    revalidatePath('/', 'layout');
    return { cents };
  });
}

/** Adds an address to the whitelist, or changes the role it will get. */
export async function upsertWhitelist(
  input: unknown,
): Promise<ActionResult<{ email: string; role: Role }>> {
  return actionResult(async () => {
    await requireAdmin();
    const { email, role } = parseInput(upsertWhitelistSchema, input);

    const supabase = await createClient();
    const { error } = await supabase
      .from('role_whitelist')
      .upsert({ email, role }, { onConflict: 'email' });

    if (error !== null) throw mapAdminError(error, 'upsertWhitelist');

    revalidatePath('/admin');
    return { email, role };
  });
}

/** Removes an address from the whitelist. Existing accounts keep their role. */
export async function removeWhitelist(input: unknown): Promise<ActionResult<{ email: string }>> {
  return actionResult(async () => {
    await requireAdmin();
    const { email } = parseInput(removeWhitelistSchema, input);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from('role_whitelist')
      .delete()
      .eq('email', email)
      .select('email')
      .maybeSingle();

    if (error !== null) throw mapAdminError(error, 'removeWhitelist');
    if (data === null) throw new AppError('WHITELIST_NOT_FOUND', WHITELIST_NOT_FOUND);

    revalidatePath('/admin');
    return { email: data.email };
  });
}

/**
 * Trigger codes (`LAST_ADMIN`, `ONLY_ROLE_EDITABLE`) and RLS refusals become
 * German sentences; anything unknown is logged and answered generically, so no
 * Postgres text ever reaches the browser.
 */
function mapAdminError(error: PostgrestError, where: string): AppError {
  const translated = translateDbError(error);
  if (translated !== null) return translated;

  console.error(`[admin] ${where}:`, error);
  throw new Error(error.message);
}
