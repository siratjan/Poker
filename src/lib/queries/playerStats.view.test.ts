/**
 * Properties of the `player_stats` view (supabase/migrations/0007_player_stats.sql).
 *
 * The database is not reachable from the test run, so the promises of the view
 * are checked statically on the SQL text — the same way WP4 checks
 * `session_overview`. It catches the mistakes that would silently produce wrong
 * numbers or leak rows past RLS.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  join(__dirname, '..', '..', '..', 'supabase', 'migrations', '0007_player_stats.sql'),
  'utf8',
);

/** The SQL without comment lines — so a promise cannot be „kept“ in prose. */
const CODE = SQL.split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('0007_player_stats.sql', () => {
  it('creates the view idempotently', () => {
    expect(CODE).toContain('create or replace view public.player_stats');
  });

  it('runs with the querying user’s rights, so RLS still applies', () => {
    expect(CODE).toMatch(/with \(security_invoker = true\)/);
  });

  it('starts from players with a left join, so a player without sessions stays', () => {
    expect(CODE).toMatch(/from public\.players p/);
    expect(CODE).toMatch(/left join \(/g);
    // both aggregates are joined, never inner-joined
    expect(CODE.match(/left join \(/g)?.length).toBe(2);
    expect(CODE).not.toMatch(/\n\s*(inner )?join public\.(players|settlement_lines) /);
  });

  it('counts money only from closed sessions', () => {
    expect(CODE).toContain("where s.status = 'closed'");
    expect(CODE).toContain('from public.settlement_lines l');
  });

  it('reads the balance from the frozen settlement lines, never recomputed', () => {
    expect(CODE).toContain('sum(l.net_result_cents)');
    expect(CODE).toContain('sum(l.cash_in_cents + l.credit_in_cents)');
    expect(CODE).toContain('sum(l.stack_cents)');
  });

  it('counts running sessions separately', () => {
    expect(CODE).toContain("count(*) filter (where s.status = 'open')");
    expect(CODE).toContain('from public.session_players sp');
  });

  it('defaults every number to 0 and keeps integer cents', () => {
    for (const column of [
      'sessions_played',
      'total_buy_in_cents',
      'total_stack_cents',
      'net_cents',
      'open_sessions',
    ]) {
      const declaration = new RegExp(`coalesce\\([^;]*?, 0\\)::int\\s+as ${column}`);
      expect(CODE).toMatch(declaration);
    }
    expect(CODE).not.toMatch(/::numeric|::float|::real|::double/);
  });

  it('grants read access to logged-in users only', () => {
    expect(CODE).toContain('grant select on public.player_stats to authenticated');
    expect(CODE).not.toMatch(/grant[^;]*\banon\b/);
    expect(CODE).not.toMatch(/grant[^;]*\bpublic\b\s*;/);
  });

  it('never writes', () => {
    expect(CODE).not.toMatch(/\b(insert|update|delete|drop)\s+/i);
  });
});
