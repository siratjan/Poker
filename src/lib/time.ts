/**
 * Date helpers around the `played_on` column of a session.
 *
 * The database stores `played_on` as a calendar date (`date`), the UI works in
 * `Europe/Berlin` (docs/ARBEITSPAKETE.md, project-wide conventions). Both are
 * kept as `YYYY-MM-DD` strings here: a plain calendar date has no time zone of
 * its own, so turning it into a `Date` and back is where off-by-one bugs live.
 * These functions never do that round trip.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today in Europe/Berlin as `YYYY-MM-DD`. */
export function berlinToday(now: Date = new Date()): string {
  // en-CA renders as YYYY-MM-DD; the time zone does the Berlin shift.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Latest date a session may be played on: today + 1 day in Berlin
 * (docs/ARBEITSPAKETE.md WP4 Testauftrag: „max. heute + 1 Tag“). A night that
 * runs past midnight is still allowed to be dated „tomorrow“.
 */
export function maxPlayedOn(now: Date = new Date()): string {
  return addDays(berlinToday(now), 1);
}

/** `true` if `value` is a real calendar date `YYYY-MM-DD` (rejects `2026-13-40`). */
export function isValidCalendarDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // reject the impossible days of short months (30 Feb, 31 Apr, ...)
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/**
 * German long form for the session list: `2026-09-11` -> `"Fr, 11.09.2026"`.
 * Interpreted as a calendar date in UTC so the weekday never drifts by a zone.
 */
export function formatPlayedOn(value: string): string {
  if (!isValidCalendarDate(value)) return value;
  const [y, m, d] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const weekday = new Intl.DateTimeFormat('de-DE', {
    weekday: 'short',
    timeZone: 'UTC',
  })
    .format(utc)
    .replace(/\.$/, '');
  const date = new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
  return `${weekday}, ${date}`;
}

/** Adds `days` to a `YYYY-MM-DD` string, returning `YYYY-MM-DD`. */
function addDays(value: string, days: number): string {
  const [y, m, d] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}
