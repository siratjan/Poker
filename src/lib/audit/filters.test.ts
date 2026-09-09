import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  auditFiltersToQuery,
  auditListKey,
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

/**
 * Gaby WP8-F1: a filter change keeps the route `/log`, so the list would stay
 * mounted and keep the entries and the cursor of the previous filter. The key
 * has to change with every filter combination, and the page has to use it.
 */
describe('auditListKey', () => {
  const combinations = [
    NO_AUDIT_FILTERS,
    { sessionId: SESSION, userId: null, tableName: null },
    { sessionId: null, userId: USER, tableName: null },
    { sessionId: null, userId: null, tableName: 'entries' },
    { sessionId: null, userId: null, tableName: 'sessions' },
    { sessionId: SESSION, userId: USER, tableName: 'entries' },
  ];

  it('gives every filter combination its own key', () => {
    const keys = combinations.map(auditListKey);
    expect(new Set(keys).size).toBe(combinations.length);
  });

  it('is stable for the same filters', () => {
    for (const filters of combinations) {
      expect(auditListKey(filters)).toBe(auditListKey({ ...filters }));
    }
  });

  it('changes as soon as a single filter changes', () => {
    const base = { sessionId: SESSION, userId: USER, tableName: 'entries' };
    expect(auditListKey({ ...base, tableName: 'players' })).not.toBe(auditListKey(base));
    expect(auditListKey({ ...base, sessionId: null })).not.toBe(auditListKey(base));
    expect(auditListKey({ ...base, userId: null })).not.toBe(auditListKey(base));
  });

  it('keys the log list, so a filter change throws the loaded pages away', () => {
    const root = join(__dirname, '..', '..', '..');
    const page = readFileSync(join(root, 'src', 'app', '(app)', 'log', 'page.tsx'), 'utf8');
    expect(page).toContain('key={auditListKey(filters)}');

    // Second line of defence inside the component: even without the key it
    // rebuilds its state when the filters of the props no longer match.
    const list = readFileSync(
      join(root, 'src', 'components', 'audit', 'AuditLogList.tsx'),
      'utf8',
    );
    expect(list).toContain('auditListKey(filters)');
    expect(list).toContain('if (loaded.filterKey !== filterKey)');
  });
});
