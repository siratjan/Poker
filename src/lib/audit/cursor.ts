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
 * An ISO timestamp with an offset, as Postgres serialises `timestamptz`:
 * `2026-09-12T18:00:00+00:00`, with optional fractional seconds and `Z`,
 * `+HHMM` or `+HH:MM` as the offset (an hour-only offset is neither emitted by
 * Postgres nor accepted by `Date.parse`, so it is rejected as well).
 *
 * `at` goes verbatim into the PostgREST `or(…)` expression below, so nothing
 * unchecked may reach it: a value like `2026-01-01,id.gte.0` would smuggle an
 * extra condition into that expression (Gaby WP8-F2). `auditPageSchema`
 * (src/lib/validation/audit.ts) rejects everything this pattern does not match.
 */
const AUDIT_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/;

/** `true` if `value` is an ISO timestamp safe to put into the cursor filter. */
export function isAuditCursorTimestamp(value: string): boolean {
  return AUDIT_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * PostgREST `or=(…)` filter for „strictly after this cursor“: an older
 * timestamp, or the same timestamp with a smaller id.
 *
 * Both parts are validated before they get here: `at` by
 * `isAuditCursorTimestamp`, `id` as a non-negative integer.
 */
export function auditCursorFilter(cursor: AuditCursor): string {
  return `at.lt.${cursor.at},and(at.eq.${cursor.at},id.lt.${cursor.id})`;
}

/** `true` if `row` comes after `cursor` in the order `at desc, id desc`. */
export function isAfterCursor(cursor: AuditCursor, row: { at: string; id: number }): boolean {
  if (row.at < cursor.at) return true;
  return row.at === cursor.at && row.id < cursor.id;
}
