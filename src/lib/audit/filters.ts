import { AUDITED_TABLES } from './describe';

/**
 * The three filters of the log view (docs/ARBEITSPAKETE.md WP8, step 3):
 * session, user, table. They live in the URL, so a filtered log can be linked
 * to — that is exactly what „Log dieser Session“ on the session detail page
 * does.
 *
 * Everything from the URL is untrusted text: an id that is not a UUID or a
 * table nobody audits is dropped instead of being sent to PostgREST.
 */

export type AuditFilters = {
  sessionId: string | null;
  userId: string | null;
  tableName: string | null;
};

export const NO_AUDIT_FILTERS: AuditFilters = {
  sessionId: null,
  userId: null,
  tableName: null,
};

/** Query parameter names, also used by the filter form of the log page. */
export const AUDIT_PARAM = {
  session: 'session',
  user: 'user',
  table: 'table',
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Record<string, string | string[] | undefined>;

export function parseAuditFilters(params: SearchParams | undefined): AuditFilters {
  if (params === undefined) return NO_AUDIT_FILTERS;

  return {
    sessionId: uuidOrNull(single(params[AUDIT_PARAM.session])),
    userId: uuidOrNull(single(params[AUDIT_PARAM.user])),
    tableName: tableOrNull(single(params[AUDIT_PARAM.table])),
  };
}

/** The filters as a query string, e.g. `?session=…` — empty when nothing is set. */
export function auditFiltersToQuery(filters: AuditFilters): string {
  const params = new URLSearchParams();
  if (filters.sessionId !== null) params.set(AUDIT_PARAM.session, filters.sessionId);
  if (filters.userId !== null) params.set(AUDIT_PARAM.user, filters.userId);
  if (filters.tableName !== null) params.set(AUDIT_PARAM.table, filters.tableName);

  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/** `/log?session=…` — the „Log dieser Session“ link of the session detail page. */
export function sessionLogHref(sessionId: string): string {
  return `/log${auditFiltersToQuery({ ...NO_AUDIT_FILTERS, sessionId })}`;
}

export function hasAuditFilters(filters: AuditFilters): boolean {
  return filters.sessionId !== null || filters.userId !== null || filters.tableName !== null;
}

function single(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function uuidOrNull(value: string | null): string | null {
  return value !== null && UUID.test(value) ? value.toLowerCase() : null;
}

function tableOrNull(value: string | null): string | null {
  return value !== null && AUDITED_TABLES.includes(value) ? value : null;
}
