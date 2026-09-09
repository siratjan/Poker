/**
 * WP4 — Spieler-Verwaltung, Session-Liste, Session anlegen (Gaby).
 *
 * Schärft vier Zusagen des Pakets, die sonst kein Test dauerhaft festhält:
 *  1. Datum-Schema: echtes Kalenderdatum, höchstens heute + 1 Tag (Europe/Berlin),
 *     Vergangenheit erlaubt.
 *  2. Namens-Schemata: getrimmt, Session ≤ 60 / leer → null, Spieler 1..40.
 *  3. Rollenwächter: JEDE exportierte Server Action in src/actions/{sessions,players}
 *     ruft requireEditor/requireAdmin, und zwar vor dem ersten createClient().
 *  4. session_overview-View (0006): security_invoker, Integer-Cent (::int),
 *     nur buy_in, grant nur an authenticated.
 *
 * DB nicht eingespielt → die View wird statisch am SQL geprüft, nicht live.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSessionSchema,
  updateSessionMetaSchema,
  sessionIdSchema,
} from '@/lib/validation/session';
import { createPlayerSchema, renamePlayerSchema } from '@/lib/validation/player';
import { berlinToday, maxPlayedOn } from '@/lib/time';

const ROOT = join(__dirname, '..', '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/** Add whole days to a YYYY-MM-DD string (calendar arithmetic, UTC to avoid DST drift). */
function shiftDate(value: string, days: number): string {
  const [y, m, d] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

// -----------------------------------------------------------------------------
// 1. Datum: echtes Kalenderdatum, max heute+1 Berlin
// -----------------------------------------------------------------------------

describe('createSession date bounds', () => {
  it('accepts today (Berlin)', () => {
    expect(createSessionSchema.safeParse({ playedOn: berlinToday() }).success).toBe(true);
  });

  it('accepts exactly today + 1 (a night past midnight)', () => {
    expect(createSessionSchema.safeParse({ playedOn: maxPlayedOn() }).success).toBe(true);
    // maxPlayedOn is today + 1, not more
    expect(maxPlayedOn()).toBe(shiftDate(berlinToday(), 1));
  });

  it('rejects today + 2 as too far in the future', () => {
    const result = createSessionSchema.safeParse({ playedOn: shiftDate(berlinToday(), 2) });
    expect(result.success).toBe(false);
  });

  it('rejects a far-future date', () => {
    expect(createSessionSchema.safeParse({ playedOn: '2999-01-01' }).success).toBe(false);
  });

  it('allows a past date (no lower bound)', () => {
    expect(createSessionSchema.safeParse({ playedOn: '2020-01-01' }).success).toBe(true);
  });

  it('rejects impossible calendar dates', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', 'not-a-date']) {
      expect(createSessionSchema.safeParse({ playedOn: bad }).success, bad).toBe(false);
    }
  });

  it('updateSessionMeta applies the same date bound and needs a uuid id', () => {
    expect(
      updateSessionMetaSchema.safeParse({
        id: '33333333-3333-4333-8333-333333333333',
        playedOn: shiftDate(berlinToday(), 2),
      }).success,
    ).toBe(false);
    expect(
      updateSessionMetaSchema.safeParse({ id: 'nope', playedOn: berlinToday() }).success,
    ).toBe(false);
  });

  it('sessionIdSchema rejects a non-uuid', () => {
    expect(sessionIdSchema.safeParse('nope').success).toBe(false);
    expect(sessionIdSchema.safeParse('33333333-3333-4333-8333-333333333333').success).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 2. Namen: trim, Session ≤ 60 / leer → null, Spieler 1..40
// -----------------------------------------------------------------------------

describe('session name', () => {
  it('trims the name', () => {
    const parsed = createSessionSchema.parse({ playedOn: berlinToday(), name: '  Freitag  ' });
    expect(parsed.name).toBe('Freitag');
  });

  it('collapses an empty / whitespace-only name to null', () => {
    expect(createSessionSchema.parse({ playedOn: berlinToday(), name: '   ' }).name).toBeNull();
    expect(createSessionSchema.parse({ playedOn: berlinToday() }).name).toBeNull();
  });

  it('rejects a name longer than 60 characters (after trim)', () => {
    expect(
      createSessionSchema.safeParse({ playedOn: berlinToday(), name: 'x'.repeat(61) }).success,
    ).toBe(false);
    expect(
      createSessionSchema.safeParse({ playedOn: berlinToday(), name: 'x'.repeat(60) }).success,
    ).toBe(true);
  });
});

describe('player name', () => {
  it('trims and requires 1..40 characters', () => {
    expect(createPlayerSchema.parse({ name: '  Ali  ' }).name).toBe('Ali');
    expect(createPlayerSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createPlayerSchema.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
    expect(createPlayerSchema.safeParse({ name: 'x'.repeat(40) }).success).toBe(true);
  });

  it('renamePlayer needs a uuid id and a valid name', () => {
    expect(renamePlayerSchema.safeParse({ id: 'nope', name: 'Ali' }).success).toBe(false);
    expect(
      renamePlayerSchema.safeParse({ id: '22222222-2222-4222-8222-222222222222', name: 'Ali' })
        .success,
    ).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 3. Rollenwächter in JEDER Action, vor dem ersten DB-Zugriff
// -----------------------------------------------------------------------------

describe('every server action guards the role before touching the database', () => {
  const files = ['src/actions/sessions.ts', 'src/actions/players.ts'];

  for (const file of files) {
    it(`${file}: each exported action calls requireEditor/requireAdmin first`, () => {
      const source = read(file);
      const exports = [...source.matchAll(/export async function (\w+)\s*\(/g)];
      expect(exports.length).toBeGreaterThan(0);

      for (const match of exports) {
        const name = match[1];
        const start = match.index ?? 0;
        // slice from this export to the next export (or EOF) = one action body
        const nextIndex = source.indexOf('export async function', start + 1);
        const body = source.slice(start, nextIndex === -1 ? undefined : nextIndex);

        const guardAt = body.search(/require(Editor|Admin)\s*\(/);
        const clientAt = body.search(/createClient\s*\(/);
        expect(guardAt, `${name}: no requireEditor/requireAdmin`).toBeGreaterThanOrEqual(0);
        if (clientAt >= 0) {
          expect(guardAt, `${name}: DB client before role guard`).toBeLessThan(clientAt);
        }
      }
    });
  }
});

// -----------------------------------------------------------------------------
// 4. session_overview-View: security_invoker, Integer-Cent, nur buy_in
// -----------------------------------------------------------------------------

describe('0006_session_overview.sql properties (static — DB not applied)', () => {
  const sql = read('supabase/migrations/0006_session_overview.sql');

  it('runs with security_invoker so the user RLS applies', () => {
    expect(sql).toMatch(/security_invoker\s*=\s*true/);
  });

  it('keeps money integer (casts the aggregates to int)', () => {
    expect(sql).toMatch(/total_buy_in_cents/);
    expect(sql).toMatch(/::int/);
  });

  it('sums only buy_in entries, not cash_out/payout', () => {
    expect(sql).toMatch(/where\s+type\s*=\s*'buy_in'/i);
  });

  it('grants select only to authenticated (never anon)', () => {
    expect(sql).toMatch(/grant\s+select\s+on\s+public\.session_overview\s+to\s+authenticated/i);
    expect(sql).not.toMatch(/to\s+anon/i);
  });
});
