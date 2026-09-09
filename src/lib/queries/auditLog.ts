import { createClient } from '@/lib/supabase/server';
import { auditCursorFilter, type AuditCursor } from '@/lib/audit/cursor';
import { referencedIds, type AuditEntry, type AuditNames } from '@/lib/audit/describe';
import { NO_AUDIT_FILTERS, type AuditFilters } from '@/lib/audit/filters';
import { formatPlayedOn } from '@/lib/time';
import type { QueryResult } from './sessionDetail';

/**
 * Read queries for the audit log view (docs/ARBEITSPAKETE.md WP8, step 3).
 * Server only — `createClient` reads request cookies, so RLS applies; every
 * logged-in user may read `audit_log`, nobody may write it (SPEC §4).
 *
 * Paging is keyset, not offset: rows are ordered `at desc, id desc` and the
 * next page continues *after* the last row of the previous one. Two rows written
 * in the same transaction share `at` to the microsecond, and an offset would
 * then skip or repeat them (WP8 Testauftrag).
 */

export const AUDIT_PAGE_SIZE = 50;

export type { AuditCursor };

export type AuditPage = {
  entries: AuditEntry[];
  names: AuditNames;
  /** `null` when this was the last page. */
  nextCursor: AuditCursor | null;
};

export async function getAuditPage(
  filters: AuditFilters = NO_AUDIT_FILTERS,
  cursor: AuditCursor | null = null,
): Promise<QueryResult<AuditPage>> {
  const supabase = await createClient();

  let query = supabase
    .from('audit_log')
    .select('id, at, user_id, user_email, table_name, row_id, action, old_data, new_data, session_id')
    .order('at', { ascending: false })
    .order('id', { ascending: false })
    // One row more than the page: its existence is the „Mehr laden“ button.
    .limit(AUDIT_PAGE_SIZE + 1);

  if (filters.sessionId !== null) query = query.eq('session_id', filters.sessionId);
  if (filters.userId !== null) query = query.eq('user_id', filters.userId);
  if (filters.tableName !== null) query = query.eq('table_name', filters.tableName);
  if (cursor !== null) query = query.or(auditCursorFilter(cursor));

  const { data, error } = await query;
  if (error !== null) {
    console.error('[queries] getAuditPage:', error.message);
    return { ok: false, reason: 'error' };
  }

  const rows = data ?? [];
  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  const page = hasMore ? rows.slice(0, AUDIT_PAGE_SIZE) : rows;

  const entries: AuditEntry[] = page.map((row) => ({
    id: row.id,
    at: row.at,
    userId: row.user_id,
    userEmail: row.user_email,
    userName: null,
    tableName: row.table_name,
    rowId: row.row_id,
    action: row.action,
    oldData: row.old_data,
    newData: row.new_data,
    sessionId: row.session_id,
  }));

  const names = await resolveNames(supabase, entries);
  await resolveUserNames(supabase, entries);

  const last = entries.at(-1);
  return {
    ok: true,
    data: {
      entries,
      names,
      nextCursor: hasMore && last !== undefined ? { at: last.at, id: last.id } : null,
    },
  };
}

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Player and session names for the descriptions: one `in (...)` per table for
 * the whole page, never one query per row.
 */
async function resolveNames(supabase: ServerClient, entries: AuditEntry[]): Promise<AuditNames> {
  const playerIds = new Set<string>();
  const sessionIds = new Set<string>();

  for (const entry of entries) {
    const referenced = referencedIds(entry);
    for (const id of referenced.playerIds) playerIds.add(id);
    for (const id of referenced.sessionIds) sessionIds.add(id);
  }

  const [players, sessions] = await Promise.all([
    lookupPlayers(supabase, [...playerIds]),
    lookupSessions(supabase, [...sessionIds]),
  ]);

  return { players, sessions };
}

async function lookupPlayers(
  supabase: ServerClient,
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};

  const { data, error } = await supabase.from('players').select('id, name').in('id', ids);
  if (error !== null) {
    console.error('[queries] getAuditPage (players):', error.message);
    return {};
  }
  return Object.fromEntries((data ?? []).map((row) => [row.id, row.name]));
}

async function lookupSessions(
  supabase: ServerClient,
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};

  const { data, error } = await supabase.from('sessions').select('id, played_on').in('id', ids);
  if (error !== null) {
    console.error('[queries] getAuditPage (sessions):', error.message);
    return {};
  }
  return Object.fromEntries((data ?? []).map((row) => [row.id, formatPlayedOn(row.played_on)]));
}

/**
 * Display names of the acting users, filled into the entries in place. The row
 * keeps its `user_email` from the moment of the action, so a failure here only
 * costs the friendly name, never the line.
 */
async function resolveUserNames(supabase: ServerClient, entries: AuditEntry[]): Promise<void> {
  const ids = [
    ...new Set(entries.map((entry) => entry.userId).filter((id): id is string => id !== null)),
  ];
  if (ids.length === 0) return;

  const { data, error } = await supabase.from('app_users').select('id, display_name').in('id', ids);
  if (error !== null) {
    console.error('[queries] getAuditPage (app_users):', error.message);
    return;
  }

  const byId = new Map((data ?? []).map((row) => [row.id, row.display_name]));
  for (const entry of entries) {
    if (entry.userId === null) continue;
    entry.userName = byId.get(entry.userId) ?? null;
  }
}

export type AuditFilterOption = { value: string; label: string };

export type AuditFilterOptions = {
  users: AuditFilterOption[];
  sessions: AuditFilterOption[];
};

/** Most recent sessions and every known user, for the two filter dropdowns. */
export async function getAuditFilterOptions(): Promise<AuditFilterOptions> {
  const supabase = await createClient();

  const [usersResult, sessionsResult] = await Promise.all([
    supabase.from('app_users').select('id, display_name, email').order('email'),
    supabase
      .from('sessions')
      .select('id, played_on, name')
      .order('played_on', { ascending: false })
      .limit(100),
  ]);

  if (usersResult.error !== null) {
    console.error('[queries] getAuditFilterOptions (app_users):', usersResult.error.message);
  }
  if (sessionsResult.error !== null) {
    console.error('[queries] getAuditFilterOptions (sessions):', sessionsResult.error.message);
  }

  return {
    users: (usersResult.data ?? []).map((row) => ({
      value: row.id,
      label: row.display_name ?? row.email,
    })),
    sessions: (sessionsResult.data ?? []).map((row) => ({
      value: row.id,
      label:
        row.name === null || row.name.trim() === ''
          ? formatPlayedOn(row.played_on)
          : `${formatPlayedOn(row.played_on)} · ${row.name}`,
    })),
  };
}
