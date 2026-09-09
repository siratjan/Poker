/**
 * Keyset paging of the audit log (docs/ARBEITSPAKETE.md WP8, step 3).
 *
 * The list is ordered `at desc, id desc`. An offset would be wrong here: rows
 * written in one transaction share `at` to the microsecond, and a row inserted
 * between two page loads shifts every offset by one, so entries would be
 * skipped or shown twice (WP8 Testauftrag). The cursor is therefore the
 * position of the last row, and the next page is everything strictly after it.
 */

export type AuditCursor = {
  /** `at` of the last row of the previous page, ISO timestamp. */
  at: string;
  id: number;
};

/**
 * PostgREST `or=(…)` filter for „strictly after this cursor“: an older
 * timestamp, or the same timestamp with a smaller id.
 */
export function auditCursorFilter(cursor: AuditCursor): string {
  return `at.lt.${cursor.at},and(at.eq.${cursor.at},id.lt.${cursor.id})`;
}

/** `true` if `row` comes after `cursor` in the order `at desc, id desc`. */
export function isAfterCursor(cursor: AuditCursor, row: { at: string; id: number }): boolean {
  if (row.at < cursor.at) return true;
  return row.at === cursor.at && row.id < cursor.id;
}
