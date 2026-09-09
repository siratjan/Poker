/**
 * WP7 – Spieler-Übersicht und Spieler-Detail (Gaby).
 *
 * Geprüft wird:
 *  1. das View-SQL `0007_player_stats.sql` statisch (die DB ist aus dem Testlauf
 *     nicht erreichbar) – strenger als Siris eigener Textcheck: das Geld darf
 *     ausschliesslich aus `settlement_lines` abgeschlossener Sessions kommen,
 *     `payout_cents` gehoert nicht in den Buy-in, kein `security_definer`,
 *     keine Rechte fuer `anon`/`public`.
 *  2. die Konsistenz-Zusage des Testauftrags mit einem Fixture, dessen Zahlen
 *     aus dem echten `computeSettlement` stammen (nicht von Hand gesetzt):
 *     Summe aller `net_cents` ueber alle Spieler = Summe aller
 *     `discrepancy_cents` ueber alle abgeschlossenen Sessions.
 *  3. `getPlayerDetail` gegen einen gefaelschten Supabase-Client: feste Anzahl
 *     Queries (kein N+1), abgeschlossene Abende aus der eingefrorenen Zeile,
 *     offene aus `entries`, `payout` faellt nicht in Buy-in/Stack, Fehler wird
 *     als `{ ok: false }` gemeldet und nie als leere Liste.
 *  4. Sortierung und Suche als reine Funktionen (inkl. Property-Tests).
 *  5. statische UI-Zusagen: Geld nie als Float, `tabular-nums`, 44-px-Ziele,
 *     sichtbarer Fehlerhinweis statt stiller Leerliste.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeSettlement, type SettlementParticipant } from '@/lib/settlement';
import {
  DEFAULT_SORT,
  SORT_KEYS,
  filterPlayers,
  initialDirection,
  nextSortState,
  normalizeName,
  sortPlayers,
  totalNetCents,
  visiblePlayers,
  type SortState,
  type SortablePlayer,
} from '@/lib/players/stats';

const ROOT = join(__dirname, '..', '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

// ---------------------------------------------------------------------------
// 1. View-SQL
// ---------------------------------------------------------------------------

const VIEW_SQL = read('supabase/migrations/0007_player_stats.sql');
/** Ohne Kommentarzeilen: eine Zusage im Fliesstext ist keine Zusage. */
const VIEW_CODE = VIEW_SQL.split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');
/** Nur die Anweisungen, ohne den `comment on view`-Text am Ende. */
const VIEW_BODY = VIEW_CODE.slice(0, VIEW_CODE.indexOf('comment on view'));

describe('WP7 – player_stats view (SQL)', () => {
  it('laeuft mit den Rechten des Aufrufers und nie als Owner', () => {
    expect(VIEW_CODE).toMatch(/with \(security_invoker\s*=\s*true\)/);
    expect(VIEW_CODE).not.toMatch(/security_definer/i);
    expect(VIEW_CODE).not.toMatch(/security_invoker\s*=\s*false/i);
  });

  it('gibt nur eingeloggten Nutzern Leserechte', () => {
    expect(VIEW_CODE).toMatch(/grant select on public\.player_stats to authenticated/);
    const grants = VIEW_CODE.match(/grant[^;]*;/gi) ?? [];
    expect(grants.length).toBe(1);
    for (const grant of grants) {
      expect(grant).not.toMatch(/\banon\b/i);
      expect(grant).not.toMatch(/\bpublic\b\s*;/i);
      expect(grant).not.toMatch(/\ball\b/i);
      expect(grant).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/i);
    }
  });

  it('startet bei players, damit ein Spieler ohne Abend nicht verschwindet', () => {
    expect(VIEW_CODE).toMatch(/from public\.players p\b/);
    // keine einzige innere Verknuepfung auf der obersten Ebene
    expect(VIEW_CODE).not.toMatch(/^\s*(inner\s+)?join public\.(settlement_lines|session_players)/m);
    // jede Kennzahl faellt auf 0 zurueck
    for (const column of [
      'sessions_played',
      'total_buy_in_cents',
      'total_stack_cents',
      'net_cents',
      'open_sessions',
    ]) {
      expect(VIEW_CODE).toMatch(new RegExp(`coalesce\\([^)]*\\)::int\\s+as ${column}`));
    }
  });

  it('nimmt Geld ausschliesslich aus den eingefrorenen Zeilen abgeschlossener Sessions', () => {
    // Der Geld-Teilbaum ist alles zwischen `settlement_lines` und dem Ende des
    // ersten Unterselects.
    const start = VIEW_CODE.indexOf('from public.settlement_lines');
    expect(start).toBeGreaterThan(-1);
    const moneyBlock = VIEW_CODE.slice(VIEW_CODE.indexOf('sum('), VIEW_CODE.indexOf(') c on'));

    expect(moneyBlock).toContain("where s.status = 'closed'");
    expect(moneyBlock).toContain('sum(l.cash_in_cents + l.credit_in_cents)');
    expect(moneyBlock).toContain('sum(l.stack_cents)');
    expect(moneyBlock).toContain('sum(l.net_result_cents)');
    // payout ist bereits ausgezahltes Bargeld, kein Buy-in und kein Stack
    expect(moneyBlock).not.toContain('payout_cents');
    // niemals aus entries neu gerechnet (CLAUDE.md: eingefroren, nie neu)
    expect(VIEW_CODE).not.toMatch(/public\.entries/);
  });

  it('haelt Geld in Integer-Cent, ohne Division und ohne Float', () => {
    expect(VIEW_BODY).not.toMatch(/::numeric|::float|::real|::double|::decimal/i);
    expect(VIEW_BODY).not.toMatch(/\bavg\s*\(/i);
    expect(VIEW_BODY).not.toMatch(/_cents[^,\n]*\//);
  });

  it('zaehlt offene Abende getrennt und schreibt nichts', () => {
    expect(VIEW_CODE).toMatch(/count\(\*\) filter \(where s\.status = 'open'\)/);
    expect(VIEW_CODE).toMatch(/from public\.session_players sp/);
    expect(VIEW_CODE).not.toMatch(/\b(insert into|update |delete from|drop table|truncate)\b/i);
  });

  it('leitet last_played_on aus der Teilnahme ab, nicht aus der Abrechnung', () => {
    // Bewusst offen formuliert: ob offene Abende mitzaehlen, entscheidet der
    // Planer (Siris offene Frage 1). Falsch waere nur, das Datum aus
    // settlement_lines zu ziehen – dann waere „zuletzt gespielt“ in Wahrheit
    // „zuletzt abgerechnet“.
    const participation = VIEW_BODY.slice(VIEW_BODY.indexOf('from public.session_players sp'));
    expect(VIEW_CODE).toMatch(/max\(s\.played_on\)\s+as last_played_on/);
    expect(participation).not.toContain('settlement_lines');
  });
});

// ---------------------------------------------------------------------------
// 2. Konsistenz: Sigma net_cents (alle Spieler) = Sigma discrepancy (alle Sessions)
// ---------------------------------------------------------------------------

type LineOfEvening = {
  sessionId: string;
  playerId: string;
  cashIn: number;
  creditIn: number;
  stack: number;
  netResult: number;
};

/**
 * Ein abgeschlossener Abend, wie ihn WP6 speichert: die Zeilen kommen aus dem
 * echten Algorithmus, nicht aus der Hand des Testschreibers.
 */
function closeEvening(sessionId: string, participants: SettlementParticipant[]) {
  const result = computeSettlement(participants);
  const lines: LineOfEvening[] = result.lines.map((line) => ({
    sessionId,
    playerId: line.playerId,
    cashIn: line.cashIn,
    creditIn: line.creditIn,
    stack: line.stack,
    netResult: line.netResult,
  }));
  return { lines, discrepancy: result.discrepancy };
}

/**
 * Nachbau der View-Aggregation in TypeScript – unabhaengig von Siris Fassung.
 * Nur `closed` liefert Geld; jeder Spieler bleibt in der Liste.
 */
function aggregate(
  players: readonly { id: string; name: string }[],
  closedLines: readonly LineOfEvening[],
): (SortablePlayer & { id: string })[] {
  return players.map((player) => {
    const own = closedLines.filter((line) => line.playerId === player.id);
    return {
      id: player.id,
      name: player.name,
      sessionsPlayed: own.length,
      totalBuyInCents: own.reduce((sum, line) => sum + line.cashIn + line.creditIn, 0),
      totalStackCents: own.reduce((sum, line) => sum + line.stack, 0),
      netCents: own.reduce((sum, line) => sum + line.netResult, 0),
    };
  });
}

const p = (
  playerId: string,
  position: number,
  cashIn: number,
  creditIn: number,
  stack: number,
  payout = 0,
): SettlementParticipant => ({ playerId, position, cashIn, creditIn, stack, payout });

describe('WP7 – Uebersicht gegen die Session-Ergebnisse (Fixture)', () => {
  // TV2-artig, sauber: A bar 100 -> 250, B bar 100 -> 50, C Liste 100 -> 0
  const clean = closeEvening('s1', [
    p('a', 1, 10000, 0, 25000),
    p('b', 2, 10000, 0, 5000),
    p('c', 3, 0, 10000, 0),
  ]);
  // TV9-artig, 20,00 EUR fehlen: A bar 100 -> 90, B bar 100 -> 90
  const short = closeEvening('s2', [p('a', 1, 10000, 0, 9000), p('b', 2, 10000, 0, 9000)]);
  // 5,00 EUR zu viel gezaehlt: A bar 50 -> 55, C Liste 50 -> 50
  const over = closeEvening('s3', [p('a', 1, 5000, 0, 5500), p('c', 2, 0, 5000, 5000)]);

  const PLAYERS = [
    { id: 'a', name: 'Ali' },
    { id: 'b', name: 'Bea' },
    { id: 'c', name: 'Cem' },
    { id: 'd', name: 'Dana' }, // nie dabei gewesen
  ];
  const CLOSED = [...clean.lines, ...short.lines, ...over.lines];

  it('rechnet die Abende so ab, wie es die Handrechnung sagt', () => {
    expect(clean.discrepancy).toBe(0);
    expect(short.discrepancy).toBe(-2000);
    expect(over.discrepancy).toBe(500);
  });

  it('summiert je Spieler genau die Ergebnisse seiner abgeschlossenen Abende', () => {
    const stats = aggregate(PLAYERS, CLOSED);
    const byId = new Map(stats.map((row) => [row.id, row]));

    // Handrechnung Ali: s1 +150,00 / s2 -10,00 / s3 +5,00 = +145,00
    expect(byId.get('a')?.netCents).toBe(14500);
    expect(byId.get('a')?.sessionsPlayed).toBe(3);
    expect(byId.get('a')?.totalBuyInCents).toBe(25000);
    expect(byId.get('a')?.totalStackCents).toBe(39500);
    // Bea: s1 -50,00 / s2 -10,00 = -60,00
    expect(byId.get('b')?.netCents).toBe(-6000);
    // Cem: s1 -100,00 / s3 0,00 = -100,00
    expect(byId.get('c')?.netCents).toBe(-10000);
    // Dana war nie dabei: alles 0, keine erfundene Bilanz
    expect(byId.get('d')).toMatchObject({
      sessionsPlayed: 0,
      totalBuyInCents: 0,
      totalStackCents: 0,
      netCents: 0,
    });
  });

  it('haelt Bilanz = Stack - Buy-in je Spieler ein', () => {
    for (const row of aggregate(PLAYERS, CLOSED)) {
      expect(row.netCents).toBe(row.totalStackCents - row.totalBuyInCents);
      expect(Number.isInteger(row.netCents)).toBe(true);
    }
  });

  it('Summe aller Bilanzen = Summe aller Differenzen', () => {
    const stats = aggregate(PLAYERS, CLOSED);
    const discrepancies = clean.discrepancy + short.discrepancy + over.discrepancy;
    expect(totalNetCents(stats)).toBe(discrepancies);
    expect(totalNetCents(stats)).toBe(-1500);
  });

  it('ist 0, wenn jeder Abend aufgeht', () => {
    const onlyClean = aggregate(PLAYERS, clean.lines);
    expect(clean.discrepancy).toBe(0);
    expect(totalNetCents(onlyClean)).toBe(0);
  });

  it('laesst offene Abende komplett draussen', () => {
    // dieselben Spieler, ein laufender Abend – er darf die Bilanz nicht bewegen
    const running = closeEvening('s4', [p('a', 1, 20000, 0, 20000), p('b', 2, 20000, 0, 20000)]);
    const withOpenIgnored = aggregate(PLAYERS, CLOSED);
    const wronglyIncluded = aggregate(PLAYERS, [...CLOSED, ...running.lines]);

    expect(totalNetCents(withOpenIgnored)).toBe(-1500);
    // Gegenprobe: wuerde die View offene Abende mitzaehlen, aendert sich
    // mindestens der Sessions-Zaehler.
    expect(wronglyIncluded.find((row) => row.id === 'a')?.sessionsPlayed).toBe(4);
    expect(withOpenIgnored.find((row) => row.id === 'a')?.sessionsPlayed).toBe(3);
  });

  it('bleibt auch bei einer Cent-Rundung (TV8-artig) ganzzahlig und konsistent', () => {
    // drei Spieler, ein Cent Rest im Bargeld
    const odd = closeEvening('s5', [
      p('a', 1, 3333, 0, 3334),
      p('b', 2, 3333, 0, 3333),
      p('c', 3, 3334, 0, 3333),
    ]);
    expect(odd.discrepancy).toBe(0);
    const stats = aggregate(PLAYERS, odd.lines);
    for (const row of stats) expect(Number.isInteger(row.netCents)).toBe(true);
    expect(totalNetCents(stats)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. getPlayerDetail gegen einen gefaelschten Supabase-Client
// ---------------------------------------------------------------------------

type DbResult = { data: unknown; error: unknown };

const createClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient }));

const { getPlayerDetail, listPlayerStats } = await import('@/lib/queries/players');

type Call = { table: string; filters: unknown[][] };

/** Minimaler Query-Builder: sammelt die Aufrufe und liefert je Tabelle ein Ergebnis. */
function fakeDb(results: Record<string, DbResult>) {
  const calls: Call[] = [];

  function from(table: string) {
    const call: Call = { table, filters: [] };
    calls.push(call);
    const result = results[table] ?? { data: [], error: null };

    const builder = {
      select: (...args: unknown[]) => {
        call.filters.push(['select', ...args]);
        return builder;
      },
      eq: (...args: unknown[]) => {
        call.filters.push(['eq', ...args]);
        return builder;
      },
      in: (...args: unknown[]) => {
        call.filters.push(['in', ...args]);
        return builder;
      },
      order: (...args: unknown[]) => {
        call.filters.push(['order', ...args]);
        return builder;
      },
      maybeSingle: () => Promise.resolve(result),
      then: (
        onFulfilled?: ((value: DbResult) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => Promise.resolve(result).then(onFulfilled, onRejected),
    };
    return builder;
  }

  createClient.mockResolvedValue({ from });
  return calls;
}

const STATS_ROW = {
  player_id: 'a',
  name: 'Ali',
  name_normalized: 'ali',
  sessions_played: 1,
  total_buy_in_cents: 10000,
  total_stack_cents: 15000,
  net_cents: 5000,
  last_played_on: '2026-09-01',
  open_sessions: 1,
};

afterEach(() => {
  createClient.mockReset();
});

describe('WP7 – getPlayerDetail', () => {
  it('stellt eine feste Anzahl Queries, unabhaengig von der Anzahl Abende (kein N+1)', async () => {
    const sessions = Array.from({ length: 12 }, (_, index) => ({
      id: `s${index}`,
      played_on: `2026-08-${String(index + 1).padStart(2, '0')}`,
      name: null,
      status: index % 2 === 0 ? 'closed' : 'open',
      created_at: `2026-08-${String(index + 1).padStart(2, '0')}T18:00:00Z`,
    }));
    const calls = fakeDb({
      player_stats: { data: STATS_ROW, error: null },
      session_players: { data: sessions.map((s) => ({ session_id: s.id })), error: null },
      sessions: { data: sessions, error: null },
      settlement_lines: {
        data: sessions
          .filter((s) => s.status === 'closed')
          .map((s) => ({
            session_id: s.id,
            cash_in_cents: 10000,
            credit_in_cents: 0,
            stack_cents: 12000,
            net_result_cents: 2000,
          })),
        error: null,
      },
      entries: { data: [], error: null },
    });

    const result = await getPlayerDetail('a');

    expect(result.ok).toBe(true);
    expect(calls.length).toBe(5);
    expect(calls.map((call) => call.table)).toEqual([
      'player_stats',
      'session_players',
      'sessions',
      'settlement_lines',
      'entries',
    ]);
    // sessions und entries werden gebuendelt geladen, nie je Abend einzeln
    expect(calls[2].filters.some(([kind]) => kind === 'in')).toBe(true);
    expect(calls[4].filters.some(([kind]) => kind === 'in')).toBe(true);
  });

  it('zeigt abgeschlossene Abende aus der eingefrorenen Zeile, nie neu gerechnet', async () => {
    fakeDb({
      player_stats: { data: STATS_ROW, error: null },
      session_players: { data: [{ session_id: 's1' }], error: null },
      sessions: {
        data: [
          {
            id: 's1',
            played_on: '2026-09-01',
            name: 'Freitag',
            status: 'closed',
            created_at: '2026-09-01T18:00:00Z',
          },
        ],
        error: null,
      },
      settlement_lines: {
        // absichtlich „falsche“ Zahlen: net passt nicht zu stack - buy-in.
        // Die Anzeige muss trotzdem exakt die gespeicherte Zeile zeigen.
        data: [
          {
            session_id: 's1',
            cash_in_cents: 10000,
            credit_in_cents: 0,
            stack_cents: 15000,
            net_result_cents: 4200,
          },
        ],
        error: null,
      },
      entries: { data: [], error: null },
    });

    const result = await getPlayerDetail('a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions[0]).toMatchObject({
      sessionId: 's1',
      cashInCents: 10000,
      creditInCents: 0,
      stackCents: 15000,
      netCents: 4200,
    });
  });

  it('leitet offene Abende aus entries ab und ignoriert payout', async () => {
    fakeDb({
      player_stats: { data: { ...STATS_ROW, sessions_played: 0, net_cents: 0 }, error: null },
      session_players: { data: [{ session_id: 's9' }], error: null },
      sessions: {
        data: [
          {
            id: 's9',
            played_on: '2026-09-09',
            name: null,
            status: 'open',
            created_at: '2026-09-09T18:00:00Z',
          },
        ],
        error: null,
      },
      settlement_lines: { data: [], error: null },
      entries: {
        data: [
          { session_id: 's9', type: 'buy_in', amount_cents: 10000, payment: 'cash' },
          { session_id: 's9', type: 'buy_in', amount_cents: 5000, payment: 'credit' },
          { session_id: 's9', type: 'payout', amount_cents: 3000, payment: 'cash' },
        ],
        error: null,
      },
    });

    const result = await getPlayerDetail('a');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions[0]).toMatchObject({
      status: 'open',
      cashInCents: 10000,
      creditInCents: 5000,
      stackCents: null,
      netCents: null, // ein laufender Abend hat kein Ergebnis
    });
  });

  it('meldet einen unbekannten Spieler als not_found und einen Fehler als error', async () => {
    fakeDb({ player_stats: { data: null, error: null } });
    const missing = await getPlayerDetail('nope');
    expect(missing).toEqual({ ok: false, reason: 'not_found' });

    createClient.mockReset();
    fakeDb({ player_stats: { data: null, error: { message: 'boom' } } });
    const broken = await getPlayerDetail('a');
    expect(broken).toEqual({ ok: false, reason: 'error' });
  });

  it('meldet einen Fehler in jeder Teil-Query, statt stillschweigend Abende zu verschlucken', async () => {
    const base = {
      player_stats: { data: STATS_ROW, error: null },
      session_players: { data: [{ session_id: 's1' }], error: null },
      sessions: {
        data: [
          {
            id: 's1',
            played_on: '2026-09-01',
            name: null,
            status: 'open',
            created_at: '2026-09-01T18:00:00Z',
          },
        ],
        error: null,
      },
      settlement_lines: { data: [], error: null },
      entries: { data: [], error: null },
    };

    for (const table of ['session_players', 'sessions', 'settlement_lines', 'entries']) {
      createClient.mockReset();
      fakeDb({ ...base, [table]: { data: null, error: { message: `${table} kaputt` } } });
      const result = await getPlayerDetail('a');
      expect(result, `${table} kaputt`).toEqual({ ok: false, reason: 'error' });
    }
  });

  it('sortiert die Abende neueste zuerst (in der Query, nicht im Client)', async () => {
    const calls = fakeDb({
      player_stats: { data: STATS_ROW, error: null },
      session_players: { data: [{ session_id: 's1' }], error: null },
      sessions: {
        data: [
          {
            id: 's1',
            played_on: '2026-09-01',
            name: null,
            status: 'open',
            created_at: '2026-09-01T18:00:00Z',
          },
        ],
        error: null,
      },
      settlement_lines: { data: [], error: null },
      entries: { data: [], error: null },
    });

    await getPlayerDetail('a');
    const orders = calls[2].filters.filter(([kind]) => kind === 'order');
    expect(orders[0]).toEqual(['order', 'played_on', { ascending: false }]);
  });

  it('braucht ohne Teilnahme nur zwei Queries', async () => {
    const calls = fakeDb({
      player_stats: { data: { ...STATS_ROW, sessions_played: 0 }, error: null },
      session_players: { data: [], error: null },
    });
    const result = await getPlayerDetail('a');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.sessions).toEqual([]);
    expect(calls.length).toBe(2);
  });
});

describe('WP7 – listPlayerStats', () => {
  it('liest die Uebersicht mit genau einer Query', async () => {
    const calls = fakeDb({
      player_stats: { data: [STATS_ROW], error: null },
    });
    const result = await listPlayerStats();
    expect(calls.length).toBe(1);
    expect(calls[0].table).toBe('player_stats');
    expect(result).toEqual({
      ok: true,
      data: [
        {
          id: 'a',
          name: 'Ali',
          sessionsPlayed: 1,
          totalBuyInCents: 10000,
          totalStackCents: 15000,
          netCents: 5000,
          lastPlayedOn: '2026-09-01',
          openSessions: 1,
        },
      ],
    });
  });

  it('meldet die fehlende View als Fehler, nicht als leere Liste', async () => {
    fakeDb({
      player_stats: { data: null, error: { message: 'relation "player_stats" does not exist' } },
    });
    expect(await listPlayerStats()).toEqual({ ok: false, reason: 'error' });
  });
});

// ---------------------------------------------------------------------------
// 4. Sortierung und Suche
// ---------------------------------------------------------------------------

const row = (name: string, sessions: number, buyIn: number, stack: number): SortablePlayer => ({
  name,
  sessionsPlayed: sessions,
  totalBuyInCents: buyIn,
  totalStackCents: stack,
  netCents: stack - buyIn,
});

describe('WP7 – Sortierung', () => {
  it('startet mit Bilanz absteigend', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'net', direction: 'desc' });
  });

  it('sortiert jede Spalte nach Handrechnung', () => {
    const rows = [
      row('Bea', 2, 20000, 5000), // -150,00
      row('Ali', 3, 30000, 45000), // +150,00
      row('Cem', 1, 5000, 5000), //     0,00
    ];
    const names = (sort: SortState) => sortPlayers(rows, sort).map((r) => r.name);

    expect(names({ key: 'net', direction: 'desc' })).toEqual(['Ali', 'Cem', 'Bea']);
    expect(names({ key: 'net', direction: 'asc' })).toEqual(['Bea', 'Cem', 'Ali']);
    expect(names({ key: 'sessions', direction: 'desc' })).toEqual(['Ali', 'Bea', 'Cem']);
    expect(names({ key: 'buyIn', direction: 'desc' })).toEqual(['Ali', 'Bea', 'Cem']);
    expect(names({ key: 'stack', direction: 'desc' })).toEqual(['Ali', 'Bea', 'Cem']);
    expect(names({ key: 'name', direction: 'asc' })).toEqual(['Ali', 'Bea', 'Cem']);
    expect(names({ key: 'name', direction: 'desc' })).toEqual(['Cem', 'Bea', 'Ali']);
  });

  it('bricht Gleichstand immer gleich auf (stabil ueber Renders)', () => {
    const rows = [row('Zoe', 1, 1000, 1000), row('Ali', 1, 1000, 1000), row('Mia', 1, 1000, 1000)];
    const once = sortPlayers(rows, DEFAULT_SORT).map((r) => r.name);
    const twice = sortPlayers([...rows].reverse(), DEFAULT_SORT).map((r) => r.name);
    expect(once).toEqual(['Ali', 'Mia', 'Zoe']);
    expect(twice).toEqual(once);
  });

  it('veraendert die Eingabe nicht', () => {
    const rows = [row('Bea', 1, 100, 0), row('Ali', 1, 0, 100)];
    const copy = structuredClone(rows);
    sortPlayers(rows, { key: 'net', direction: 'asc' });
    visiblePlayers(rows, 'a', DEFAULT_SORT);
    expect(rows).toEqual(copy);
  });

  it('ist fuer jede Spalte eine Permutation und deterministisch (Property)', () => {
    const arbRow = fc.record({
      name: fc.string({ minLength: 1, maxLength: 8 }),
      sessionsPlayed: fc.integer({ min: 0, max: 50 }),
      totalBuyInCents: fc.integer({ min: 0, max: 1_000_000 }),
      totalStackCents: fc.integer({ min: 0, max: 1_000_000 }),
      netCents: fc.integer({ min: -1_000_000, max: 1_000_000 }),
    });

    fc.assert(
      fc.property(
        fc.array(arbRow, { maxLength: 25 }),
        fc.constantFrom(...SORT_KEYS),
        fc.constantFrom<'asc' | 'desc'>('asc', 'desc'),
        (rows, key, direction) => {
          const sorted = sortPlayers(rows, { key, direction });
          expect(sorted.length).toBe(rows.length);
          const asJson = (list: readonly SortablePlayer[]) =>
            list.map((r) => JSON.stringify(r)).sort();
          expect(asJson(sorted)).toEqual(asJson(rows));
          expect(sortPlayers(rows, { key, direction })).toEqual(sorted);
          if (key !== 'name') {
            const values = sorted.map((r) =>
              key === 'sessions'
                ? r.sessionsPlayed
                : key === 'buyIn'
                  ? r.totalBuyInCents
                  : key === 'stack'
                    ? r.totalStackCents
                    : r.netCents,
            );
            for (let i = 1; i < values.length; i += 1) {
              if (direction === 'desc') expect(values[i - 1]).toBeGreaterThanOrEqual(values[i]);
              else expect(values[i - 1]).toBeLessThanOrEqual(values[i]);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('dreht die aktive Spalte und startet eine neue in ihrer natuerlichen Richtung', () => {
    expect(initialDirection('name')).toBe('asc');
    for (const key of SORT_KEYS.filter((k) => k !== 'name')) {
      expect(initialDirection(key)).toBe('desc');
    }
    const afterTapNet = nextSortState(DEFAULT_SORT, 'net');
    expect(afterTapNet).toEqual({ key: 'net', direction: 'asc' });
    expect(nextSortState(afterTapNet, 'net')).toEqual(DEFAULT_SORT);
    expect(nextSortState(DEFAULT_SORT, 'name')).toEqual({ key: 'name', direction: 'asc' });
  });
});

describe('WP7 – Suche', () => {
  const rows = [row('Müller', 1, 0, 0), row('  Ali ', 1, 0, 0), row('José', 1, 0, 0)];

  it('ignoriert Rand-Leerzeichen, Gross-/Kleinschreibung und Diakritika', () => {
    expect(normalizeName('  MÜLLER ')).toBe('muller');
    expect(filterPlayers(rows, ' mul ').map((r) => r.name)).toEqual(['Müller']);
    expect(filterPlayers(rows, 'ALI').map((r) => r.name)).toEqual(['  Ali ']);
    expect(filterPlayers(rows, 'jose').map((r) => r.name)).toEqual(['José']);
    expect(filterPlayers(rows, 'josé').map((r) => r.name)).toEqual(['José']);
  });

  it('gibt bei leerer Suche alles zurueck und findet Unsinn nicht', () => {
    expect(filterPlayers(rows, '').length).toBe(3);
    expect(filterPlayers(rows, '\t\n ').length).toBe(3);
    expect(filterPlayers(rows, 'xyz')).toEqual([]);
  });

  it('liefert immer eine Teilmenge und nie einen neuen Spieler (Property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ name: fc.string({ maxLength: 10 }) }), { maxLength: 20 }),
        fc.string({ maxLength: 6 }),
        (input, query) => {
          const filtered = filterPlayers(input, query);
          expect(filtered.length).toBeLessThanOrEqual(input.length);
          for (const item of filtered) expect(input).toContain(item);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// 5. Statische UI-Zusagen
// ---------------------------------------------------------------------------

const UI_FILES = [
  'src/app/(app)/players/page.tsx',
  'src/app/(app)/players/[id]/page.tsx',
  'src/components/players/PlayersManager.tsx',
  'src/components/players/NetAmount.tsx',
];

describe('WP7 – UI', () => {
  it('rechnet nirgends mit Float und formatiert Geld nur ueber money.ts', () => {
    for (const file of UI_FILES) {
      const text = read(file);
      expect(text, file).not.toMatch(/parseFloat|toFixed|\/\s*100\b|Number\(/);
      expect(text, file).not.toMatch(/\bany\b\s*[;,)>]/);
      if (/_cents|Cents/.test(text) && /formatCents|formatSignedCents/.test(text)) {
        expect(text, file).toMatch(/from '@\/lib\/money'/);
      }
    }
  });

  it('zeigt Zahlen rechtsbuendig mit tabellarischen Ziffern', () => {
    const overview = read('src/components/players/PlayersManager.tsx');
    const detail = read('src/app/(app)/players/[id]/page.tsx');
    expect(overview).toContain('tabular-nums');
    expect(overview).toContain('text-right');
    expect(detail).toContain('tabular-nums');
    expect(detail).toContain('text-right');
    expect(read('src/components/players/NetAmount.tsx')).toContain('tabular-nums');
  });

  it('haelt Such- und Sortierziele bei mindestens 44 px', () => {
    const overview = read('src/components/players/PlayersManager.tsx');
    // Suchfeld und jeder Spaltenkopf
    expect((overview.match(/min-h-\[44px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // Umbenennen-Knopf: w-11 = 44 px in voller Kartenhoehe
    expect(overview).toMatch(/w-11/);
  });

  it('unterscheidet „nichts da“ von „konnte nicht geladen werden“', () => {
    const page = read('src/app/(app)/players/page.tsx');
    expect(page).toMatch(/result\.ok\s*\?/);
    expect(page).toMatch(/konnten gerade nicht geladen werden/);

    const detail = read('src/app/(app)/players/[id]/page.tsx');
    expect(detail).toMatch(/not_found/);
    expect(detail).toMatch(/konnte gerade nicht geladen werden/);

    const start = read('src/app/(app)/page.tsx');
    expect(start).toMatch(/!result\.ok/);
  });

  it('haelt die Uebersicht als Client-Komponente von der Datenbank fern', () => {
    const overview = read('src/components/players/PlayersManager.tsx');
    expect(overview).toMatch(/^'use client'/);
    expect(overview).not.toMatch(/\.from\(|\.rpc\(/);
  });

  it('verlinkt von der Session auf die Spieler-Seite, ohne den Buy-in-Weg zu verlaengern', () => {
    const card = read('src/components/sessions/ParticipantCard.tsx');
    // interaktive Karte: Tap = onPrimary (Buy-in), kein Link darum herum
    expect(card).toMatch(/onClick=\{onPrimary\}/);
    const interactive = card.slice(card.indexOf('if (!interactive)'));
    expect(interactive).toMatch(/href=\{`\/players\/\$\{participant\.playerId\}`\}/);
    // der Link der interaktiven Karte sitzt im Aktions-Sheet
    expect(read('src/components/sessions/EntrySheets.tsx')).toMatch(
      /href=\{`\/players\/\$\{participant\.playerId\}`\}/,
    );
  });
});
