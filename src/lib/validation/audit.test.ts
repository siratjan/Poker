import { describe, expect, it } from 'vitest';
import { auditPageSchema } from './audit';

const SESSION = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

const FILTERS = { sessionId: null, userId: null, tableName: null };

describe('auditPageSchema – filters', () => {
  it('takes the three known filters', () => {
    const result = auditPageSchema.safeParse({
      filters: { sessionId: SESSION, userId: USER, tableName: 'entries' },
      cursor: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects ids that are not UUIDs and tables nobody audits', () => {
    expect(
      auditPageSchema.safeParse({ filters: { ...FILTERS, sessionId: 'id.gte.0' }, cursor: null })
        .success,
    ).toBe(false);
    expect(
      auditPageSchema.safeParse({ filters: { ...FILTERS, tableName: 'role_whitelist' }, cursor: null })
        .success,
    ).toBe(false);
  });
});

describe('auditPageSchema – cursor', () => {
  it('takes a cursor as the server hands it out', () => {
    for (const at of ['2026-09-12T19:00:00+00:00', '2026-09-12T19:14:00.123456+00:00']) {
      expect(auditPageSchema.safeParse({ filters: FILTERS, cursor: { at, id: 42 } }).success).toBe(
        true,
      );
    }
    expect(auditPageSchema.safeParse({ filters: FILTERS, cursor: null }).success).toBe(true);
  });

  it('rejects anything in `at` that is not a timestamp', () => {
    // Gaby WP8-F2: `at` goes verbatim into the PostgREST `or(…)` expression.
    // Each of these would add its own condition there or blow up in Postgres.
    for (const at of [
      '2026-01-01,id.gte.0',
      '2026-09-12T19:00:00+00:00,id.gte.0',
      '2026-09-12T19:00:00+00:00,or(true)',
      '2026-09-12T19:00:00+00:00)or(id.gte.0',
      "2026-09-12T19:00:00+00:00' or '1'='1",
      'at.lt.2026-09-12T19:00:00+00:00',
      'abc',
      '',
      '2026-09-12',
    ]) {
      expect(auditPageSchema.safeParse({ filters: FILTERS, cursor: { at, id: 1 } }).success).toBe(
        false,
      );
    }
  });

  it('rejects an id that is not a non-negative integer', () => {
    const at = '2026-09-12T19:00:00+00:00';
    for (const id of ['1', 1.5, -1, Number.NaN, null]) {
      expect(auditPageSchema.safeParse({ filters: FILTERS, cursor: { at, id } }).success).toBe(
        false,
      );
    }
  });
});
