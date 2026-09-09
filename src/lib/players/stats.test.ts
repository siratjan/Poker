import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT,
  filterPlayers,
  initialDirection,
  nextSortState,
  normalizeName,
  sortPlayers,
  totalNetCents,
  visiblePlayers,
  type SortablePlayer,
} from '@/lib/players/stats';

/** Short helper: a row of the overview with the fields the sorting looks at. */
function player(
  name: string,
  sessionsPlayed: number,
  totalBuyInCents: number,
  totalStackCents: number,
): SortablePlayer {
  return {
    name,
    sessionsPlayed,
    totalBuyInCents,
    totalStackCents,
    netCents: totalStackCents - totalBuyInCents,
  };
}

const ALI = player('Ali', 3, 30000, 45000); //  +150,00 €
const BEA = player('Bea', 2, 20000, 5000); //  -150,00 €
const CEM = player('Cem', 5, 50000, 50000); //     0,00 €
const DANA = player('dana', 0, 0, 0); //           0,00 €

const ROWS = [CEM, ALI, DANA, BEA];

const names = (rows: readonly SortablePlayer[]): string[] => rows.map((row) => row.name);

describe('normalizeName', () => {
  it('folds case, diacritics and surrounding space', () => {
    expect(normalizeName('  Müller ')).toBe('muller');
    expect(normalizeName('José')).toBe('jose');
    expect(normalizeName('ALI')).toBe('ali');
  });
});

describe('filterPlayers', () => {
  it('returns every row for an empty query', () => {
    expect(names(filterPlayers(ROWS, ''))).toEqual(names(ROWS));
    expect(names(filterPlayers(ROWS, '   '))).toEqual(names(ROWS));
  });

  it('matches a substring, case-insensitively', () => {
    expect(names(filterPlayers(ROWS, 'a'))).toEqual(['Ali', 'dana', 'Bea']);
    expect(names(filterPlayers(ROWS, 'BE'))).toEqual(['Bea']);
  });

  it('finds a name with umlauts when typed without', () => {
    const rows = [player('Müller', 1, 100, 100), player('Meier', 1, 100, 100)];
    expect(names(filterPlayers(rows, 'muller'))).toEqual(['Müller']);
  });

  it('returns nothing for a query nobody matches', () => {
    expect(filterPlayers(ROWS, 'zzz')).toEqual([]);
  });

  it('does not modify the input array', () => {
    const input = [...ROWS];
    filterPlayers(input, 'a');
    expect(input).toEqual(ROWS);
  });
});

describe('sortPlayers', () => {
  it('sorts by balance descending by default', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'net', direction: 'desc' });
    expect(names(sortPlayers(ROWS, DEFAULT_SORT))).toEqual(['Ali', 'Cem', 'dana', 'Bea']);
  });

  it('sorts by balance ascending', () => {
    expect(names(sortPlayers(ROWS, { key: 'net', direction: 'asc' }))).toEqual([
      'Bea',
      'Cem',
      'dana',
      'Ali',
    ]);
  });

  it('breaks ties by name, so the order never jumps between renders', () => {
    // Cem and dana are both at 0 — the name decides, in both directions.
    expect(names(sortPlayers(ROWS, { key: 'net', direction: 'desc' }))).toEqual([
      'Ali',
      'Cem',
      'dana',
      'Bea',
    ]);
    expect(names(sortPlayers([...ROWS].reverse(), { key: 'net', direction: 'desc' }))).toEqual([
      'Ali',
      'Cem',
      'dana',
      'Bea',
    ]);
  });

  it('sorts by name case-insensitively', () => {
    expect(names(sortPlayers(ROWS, { key: 'name', direction: 'asc' }))).toEqual([
      'Ali',
      'Bea',
      'Cem',
      'dana',
    ]);
    expect(names(sortPlayers(ROWS, { key: 'name', direction: 'desc' }))).toEqual([
      'dana',
      'Cem',
      'Bea',
      'Ali',
    ]);
  });

  it('sorts by sessions, buy-ins and stacks', () => {
    expect(names(sortPlayers(ROWS, { key: 'sessions', direction: 'desc' }))).toEqual([
      'Cem',
      'Ali',
      'Bea',
      'dana',
    ]);
    expect(names(sortPlayers(ROWS, { key: 'buyIn', direction: 'desc' }))).toEqual([
      'Cem',
      'Ali',
      'Bea',
      'dana',
    ]);
    expect(names(sortPlayers(ROWS, { key: 'stack', direction: 'desc' }))).toEqual([
      'Cem',
      'Ali',
      'Bea',
      'dana',
    ]);
  });

  it('does not modify the input array', () => {
    const input = [...ROWS];
    sortPlayers(input, { key: 'name', direction: 'asc' });
    expect(input).toEqual(ROWS);
  });
});

describe('nextSortState', () => {
  it('starts a new column in its natural direction', () => {
    expect(initialDirection('name')).toBe('asc');
    expect(initialDirection('net')).toBe('desc');
    expect(nextSortState(DEFAULT_SORT, 'name')).toEqual({ key: 'name', direction: 'asc' });
    expect(nextSortState({ key: 'name', direction: 'asc' }, 'buyIn')).toEqual({
      key: 'buyIn',
      direction: 'desc',
    });
  });

  it('flips the active column', () => {
    const once = nextSortState(DEFAULT_SORT, 'net');
    expect(once).toEqual({ key: 'net', direction: 'asc' });
    expect(nextSortState(once, 'net')).toEqual({ key: 'net', direction: 'desc' });
  });
});

describe('visiblePlayers', () => {
  it('searches first, then sorts', () => {
    expect(names(visiblePlayers(ROWS, 'a', DEFAULT_SORT))).toEqual(['Ali', 'dana', 'Bea']);
  });
});

// -----------------------------------------------------------------------------
// Consistency (WP7, Testauftrag): Σ net_cents over all players
//                                = Σ discrepancy_cents over all closed sessions
// -----------------------------------------------------------------------------

/**
 * Fixture in the shape the view aggregates: one settlement line per player and
 * closed session, `net = stack − cashIn − creditIn` (docs/SETTLEMENT.md §
 * „netResult“). `player_stats.net_cents` is the sum of these per player.
 */
type LineFixture = {
  sessionId: string;
  playerId: string;
  cashIn: number;
  creditIn: number;
  stack: number;
};

const line = (
  sessionId: string,
  playerId: string,
  cashIn: number,
  creditIn: number,
  stack: number,
): LineFixture => ({ sessionId, playerId, cashIn, creditIn, stack });

const net = (row: LineFixture): number => row.stack - row.cashIn - row.creditIn;

/** What `player_stats` produces out of the lines: one balance per player. */
function statsFrom(lines: readonly LineFixture[]): { name: string; netCents: number }[] {
  const perPlayer = new Map<string, number>();
  for (const row of lines) {
    perPlayer.set(row.playerId, (perPlayer.get(row.playerId) ?? 0) + net(row));
  }
  return [...perPlayer].map(([name, netCents]) => ({ name, netCents }));
}

/** `discrepancy = Σ stack − Σ buy-in` of one session (SETTLEMENT.md). */
function discrepancyOf(lines: readonly LineFixture[], sessionId: string): number {
  return lines
    .filter((row) => row.sessionId === sessionId)
    .reduce((sum, row) => sum + net(row), 0);
}

describe('total balance vs. session discrepancies', () => {
  it('is 0 when every evening added up', () => {
    // S1: Ali +150, Bea −100, Cem −50. S2: Ali −80, Bea +80.
    const lines = [
      line('s1', 'Ali', 10000, 0, 25000),
      line('s1', 'Bea', 5000, 5000, 0),
      line('s1', 'Cem', 0, 10000, 5000),
      line('s2', 'Ali', 10000, 0, 2000),
      line('s2', 'Bea', 0, 5000, 13000),
    ];

    expect(discrepancyOf(lines, 's1')).toBe(0);
    expect(discrepancyOf(lines, 's2')).toBe(0);
    expect(totalNetCents(statsFrom(lines))).toBe(0);
  });

  it('equals the sum of the discrepancies when a session did not add up', () => {
    // S1 is clean, S2 is 20,00 € short (chips missing), S3 has 5,00 € too many.
    const lines = [
      line('s1', 'Ali', 10000, 0, 15000),
      line('s1', 'Bea', 10000, 0, 5000),
      line('s2', 'Ali', 10000, 0, 12000),
      line('s2', 'Bea', 10000, 0, 6000),
      line('s3', 'Ali', 5000, 0, 5500),
      line('s3', 'Cem', 5000, 0, 5000),
    ];

    expect(discrepancyOf(lines, 's1')).toBe(0);
    expect(discrepancyOf(lines, 's2')).toBe(-2000);
    expect(discrepancyOf(lines, 's3')).toBe(500);

    const stats = statsFrom(lines);
    expect(totalNetCents(stats)).toBe(-1500);
    expect(totalNetCents(stats)).toBe(
      discrepancyOf(lines, 's1') + discrepancyOf(lines, 's2') + discrepancyOf(lines, 's3'),
    );
  });

  it('is 0 for a group without any closed session', () => {
    expect(totalNetCents([])).toBe(0);
    expect(totalNetCents([{ netCents: 0 }, { netCents: 0 }])).toBe(0);
  });
});
