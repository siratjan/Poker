import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PostgrestError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  DB_ERROR_CODES,
  DB_ERROR_MESSAGES,
  isDbErrorCode,
  messageForDbErrorCode,
  translateDbError,
} from './de';

/**
 * The German error table must cover every code the database can raise
 * (docs/ARBEITSPAKETE.md WP5 Testauftrag: „Fehlercode-Mapping vollständig“).
 * The completeness check reads the migration itself, so a new trigger code
 * without a translation fails here instead of showing raw SQL to a user.
 */

function postgrestError(fields: Partial<PostgrestError>): PostgrestError {
  return {
    name: 'PostgrestError',
    message: '',
    details: '',
    hint: '',
    code: 'P0001',
    ...fields,
  } as PostgrestError;
}

function codesRaisedByMigrations(): string[] {
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '0002_functions_triggers.sql'),
    'utf8',
  );
  const matches = sql.matchAll(/raise exception '([A-Z_]+)'/g);
  return [...new Set([...matches].map((match) => match[1]))].sort();
}

describe('DB_ERROR_MESSAGES', () => {
  it('has a German message for every code raised in 0002', () => {
    const raised = codesRaisedByMigrations();

    expect(raised.length).toBeGreaterThan(15);
    expect(raised.filter((code) => !isDbErrorCode(code))).toEqual([]);
  });

  it('has no empty or English-looking message', () => {
    for (const code of DB_ERROR_CODES) {
      const message = messageForDbErrorCode(code);
      expect(message.length, code).toBeGreaterThan(10);
      // A translated sentence ends like a sentence, never with the raw code.
      expect(message, code).not.toContain(code);
      expect(message, code).toMatch(/[.!?]$/);
    }
  });

  it('lists every code exactly once', () => {
    expect(new Set(DB_ERROR_CODES).size).toBe(DB_ERROR_CODES.length);
    expect(Object.keys(DB_ERROR_MESSAGES)).toHaveLength(DB_ERROR_CODES.length);
  });
});

describe('translateDbError', () => {
  it('translates a trigger code that arrives as the message', () => {
    const error = translateDbError(postgrestError({ message: 'PLAYER_ALREADY_CASHED_OUT' }));

    expect(error?.code).toBe('PLAYER_ALREADY_CASHED_OUT');
    expect(error?.message).toBe(DB_ERROR_MESSAGES.PLAYER_ALREADY_CASHED_OUT);
  });

  it('finds the code inside a wrapped message', () => {
    const error = translateDbError(
      postgrestError({ message: 'ERROR: SESSION_CLOSED (SQLSTATE P0001)' }),
    );

    expect(error?.code).toBe('SESSION_CLOSED');
  });

  it('does not confuse a code with a longer word containing it', () => {
    const error = translateDbError(postgrestError({ message: 'FORBIDDEN_EDITOR', code: 'XXXXX' }));

    expect(error).toBeNull();
  });

  it('translates an RLS denial (42501) even without a trigger message', () => {
    const error = translateDbError(
      postgrestError({ code: '42501', message: 'new row violates row-level security policy' }),
    );

    expect(error?.code).toBe('FORBIDDEN');
    expect(error?.message).toContain('Rechte');
  });

  it('maps a unique violation and a foreign-key violation', () => {
    expect(translateDbError(postgrestError({ code: '23505', message: 'duplicate key' }))?.code).toBe(
      'DUPLICATE',
    );
    expect(
      translateDbError(postgrestError({ code: '23503', message: 'violates foreign key' }))?.code,
    ).toBe('REFERENCE_MISSING');
  });

  it('returns null for an unknown error so the caller answers generically', () => {
    expect(translateDbError(postgrestError({ code: '08006', message: 'connection failure' }))).toBeNull();
  });

  it('never leaks the raw Postgres text into the German message', () => {
    const raw = 'ERROR: null value in column "amount_cents" violates not-null constraint';
    const error = translateDbError(postgrestError({ code: '23502', message: raw }));

    expect(error).toBeNull();
  });
});
