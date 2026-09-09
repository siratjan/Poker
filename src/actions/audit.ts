'use server';

import { actionResult, AppError, type ActionResult } from '@/lib/actions/result';
import { requireUser } from '@/lib/auth/requireRole';
import { getAuditPage, type AuditPage } from '@/lib/queries/auditLog';
import { auditPageSchema } from '@/lib/validation/audit';
import { parseInput } from '@/lib/validation/parse';

/**
 * „Mehr laden“ of the audit log (docs/ARBEITSPAKETE.md WP8, step 3).
 *
 * A read, not a write — but it goes through a server action for the same reason
 * the writes do: the Supabase client with the user's cookies stays on the
 * server, so no client component ever talks to the database (CLAUDE.md). RLS
 * decides what comes back; every logged-in role may read the log (SPEC §4).
 */

const LOAD_FAILED = 'Das Log konnte gerade nicht geladen werden. Bitte noch einmal versuchen.';

export async function loadAuditPage(input: unknown): Promise<ActionResult<AuditPage>> {
  return actionResult(async () => {
    await requireUser();
    const { filters, cursor } = parseInput(auditPageSchema, input);

    const result = await getAuditPage(filters, cursor);
    if (!result.ok) throw new AppError('LOAD_FAILED', LOAD_FAILED);

    return result.data;
  });
}
