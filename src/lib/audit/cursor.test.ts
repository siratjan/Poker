import { describe, expect, it } from 'vitest';
import {
  auditCursorFilter,
  isAfterCursor,
  isAuditCursorTimestamp,
  type AuditCursor,
} from './cursor';

const CURSOR: AuditCursor = { at: '2026-09-12T19:14:00.123456+00:00', id: 4711 };

describe('auditCursorFilter', () => {
  it('asks for an older timestamp or the same timestamp with a smaller id', () => {
    expect(auditCursorFilter(CURSOR)).toBe(
      'at.lt.2026-09-12T19:14:00.123456+00:00,and(at.eq.2026-09-12T19:14:00.123456+00:00,id.lt.4711)',
    );
  });

  it('produces a filter without a stray comma outside the and(...) group', () => {
    // PostgREST splits `or=(…)` on top-level commas: exactly one belongs to us.
    const filter = auditCursorFilter(CURSOR);
    const outside = filter.replace(/and\([^)]*\)/, '');
    expect(outside.split(',').filter((part) => part !== '')).toHaveLength(1);
  });
});

describe('isAuditCursorTimestamp', () => {
  it('accepts the timestamps Postgres actually returns', () => {
    for (const value of [
      '2026-09-12T19:14:00.123456+00:00',
      '2026-09-12T19:00:00+00:00',
      '2026-09-12T19:00:00Z',
      '2026-09-12T19:00:00.5+02:00',
      '2026-09-12T19:00:00+0200',
    ]) {
      expect(isAuditCursorTimestamp(value)).toBe(true);
    }
  });

  it('rejects everything that could smuggle a condition into the or(…) filter', () => {
    for (const value of [
      '2026-01-01,id.gte.0',
      '2026-09-12T19:00:00+00:00,id.gte.0',
      '2026-09-12T19:00:00+00:00)or(true',
      'at.lt.2026-09-12',
      'abc',
      '',
      '2026-09-12',
      '2026-09-12T19:00:00',
      '2026-09-12T19:00:00-03',
      '2026-13-45T99:99:99+00:00',
      ' 2026-09-12T19:00:00+00:00',
      '2026-09-12T19:00:00+00:00 ',
      '2026-09-12T19:00:00+00:00\n2026-09-12T19:00:00+00:00',
    ]) {
      expect(isAuditCursorTimestamp(value)).toBe(false);
    }
  });
});

describe('isAfterCursor', () => {
  it('skips rows the previous page already showed', () => {
    expect(isAfterCursor(CURSOR, { at: CURSOR.at, id: CURSOR.id })).toBe(false);
    expect(isAfterCursor(CURSOR, { at: CURSOR.at, id: CURSOR.id + 1 })).toBe(false);
    expect(isAfterCursor(CURSOR, { at: '2026-09-12T19:15:00+00:00', id: 1 })).toBe(false);
  });

  it('takes an equal timestamp with a smaller id (same transaction)', () => {
    expect(isAfterCursor(CURSOR, { at: CURSOR.at, id: CURSOR.id - 1 })).toBe(true);
  });

  it('takes every older row', () => {
    expect(isAfterCursor(CURSOR, { at: '2026-09-12T19:13:59+00:00', id: 999999 })).toBe(true);
  });
});
