/**
 * Sorting and searching of the player overview (docs/ARBEITSPAKETE.md WP7,
 * step 2). Pure functions, so the behaviour the user taps on is covered by unit
 * tests instead of living inside a component.
 *
 * Money stays integer cents everywhere; nothing here divides.
 */

/** The sortable columns of the overview. */
export type PlayerSortKey = 'name' | 'sessions' | 'buyIn' | 'stack' | 'net';

export type SortDirection = 'asc' | 'desc';

export type SortState = {
  key: PlayerSortKey;
  direction: SortDirection;
};

/** Default of the overview: balance, best first (WP7, step 2). */
export const DEFAULT_SORT: SortState = { key: 'net', direction: 'desc' };

/** German column labels, in display order. */
export const SORT_LABELS: Record<PlayerSortKey, string> = {
  name: 'Name',
  sessions: 'Sessions',
  buyIn: 'Buy-ins',
  stack: 'Stacks',
  net: 'Bilanz',
};

export const SORT_KEYS: readonly PlayerSortKey[] = ['name', 'sessions', 'buyIn', 'stack', 'net'];

/**
 * Direction a column starts with when it is tapped the first time: names read
 * A→Z, numbers start with the biggest value, because that is what one looks for
 * („wer hat am meisten gewonnen“).
 */
export function initialDirection(key: PlayerSortKey): SortDirection {
  return key === 'name' ? 'asc' : 'desc';
}

/**
 * Tap on a column head: a new column switches to its natural direction, the
 * active column flips.
 */
export function nextSortState(current: SortState, key: PlayerSortKey): SortState {
  if (current.key !== key) return { key, direction: initialDirection(key) };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

/** The fields the list works on — anything carrying them can be sorted. */
export type SortablePlayer = {
  name: string;
  sessionsPlayed: number;
  totalBuyInCents: number;
  totalStackCents: number;
  netCents: number;
};

/**
 * Fold for the search field: lower case and without diacritics, so „Muller“
 * finds „Müller“ and „jose“ finds „José“.
 */
export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Substring search over the name. An empty (or whitespace-only) query returns
 * every row unchanged.
 */
export function filterPlayers<T extends { name: string }>(
  rows: readonly T[],
  query: string,
): T[] {
  const needle = normalizeName(query);
  if (needle === '') return [...rows];
  return rows.filter((row) => normalizeName(row.name).includes(needle));
}

function valueOf(row: SortablePlayer, key: PlayerSortKey): number {
  switch (key) {
    case 'sessions':
      return row.sessionsPlayed;
    case 'buyIn':
      return row.totalBuyInCents;
    case 'stack':
      return row.totalStackCents;
    case 'net':
      return row.netCents;
    case 'name':
      return 0;
  }
}

/** Name comparison as a German reader expects it („Ä“ next to „A“). */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'de', { sensitivity: 'base' });
}

/**
 * Sorts a copy of `rows`. Equal values always fall back to the name, so the
 * order is deterministic — two players with the same balance never swap places
 * between two renders.
 */
export function sortPlayers<T extends SortablePlayer>(rows: readonly T[], sort: SortState): T[] {
  const factor = sort.direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    if (sort.key === 'name') {
      const byName = compareNames(a.name, b.name);
      return byName === 0 ? 0 : byName * factor;
    }

    const diff = valueOf(a, sort.key) - valueOf(b, sort.key);
    if (diff !== 0) return diff * factor;
    return compareNames(a.name, b.name);
  });
}

/** Search and sort in one step — what the overview renders. */
export function visiblePlayers<T extends SortablePlayer>(
  rows: readonly T[],
  query: string,
  sort: SortState,
): T[] {
  return sortPlayers(filterPlayers(rows, query), sort);
}

/**
 * Sum of all balances.
 *
 * Invariant of docs/SETTLEMENT.md: per session `Σ netResult = Σ stack − Σ buyIn
 * = discrepancy`. Summed over every player and every closed session, the total
 * balance of the group is therefore exactly the sum of the discrepancies — 0
 * when every evening added up (`src/lib/players/stats.test.ts`).
 */
export function totalNetCents(rows: readonly { netCents: number }[]): number {
  return rows.reduce((sum, row) => sum + row.netCents, 0);
}
