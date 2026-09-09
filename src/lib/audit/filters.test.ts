import { describe, expect, it } from 'vitest';
import {
  auditFiltersToQuery,
  hasAuditFilters,
  NO_AUDIT_FILTERS,
  parseAuditFilters,
  sessionLogHref,
} from './filters';

const SESSION = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

describe('parseAuditFilters', () => {
  it('reads the three filters from the query', () => {
    expect(parseAuditFilters({ session: SESSION, user: USER, table: 'entries' })).toEqual({
      sessionId: SESSION,
      userId: USER,
      tableName: 'entries',
    });
  });

  it('drops ids that are not UUIDs', () => {
    expect(parseAuditFilters({ session: "' or 1=1--", user: '42' })).toEqual(NO_AUDIT_FILTERS);
  });

  it('drops a table nobody audits', () => {
    expect(parseAuditFilters({ table: 'auth.users' }).tableName).toBeNull();
    expect(parseAuditFilters({ table: 'role_whitelist' }).tableName).toBeNull();
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parseAuditFilters({ session: [SESSION, USER] }).sessionId).toBe(SESSION);
  });

  it('handles missing parameters', () => {
    expect(parseAuditFilters(undefined)).toEqual(NO_AUDIT_FILTERS);
    expect(parseAuditFilters({})).toEqual(NO_AUDIT_FILTERS);
  });
});

describe('auditFiltersToQuery', () => {
  it('is empty without filters', () => {
    expect(auditFiltersToQuery(NO_AUDIT_FILTERS)).toBe('');
    expect(hasAuditFilters(NO_AUDIT_FILTERS)).toBe(false);
  });

  it('round-trips through parseAuditFilters', () => {
    const filters = { sessionId: SESSION, userId: USER, tableName: 'sessions' };
    const query = auditFiltersToQuery(filters);
    const params = Object.fromEntries(new URLSearchParams(query.slice(1)));
    expect(parseAuditFilters(params)).toEqual(filters);
    expect(hasAuditFilters(filters)).toBe(true);
  });

  it('links the log of one session', () => {
    expect(sessionLogHref(SESSION)).toBe(`/log?session=${SESSION}`);
  });
});
