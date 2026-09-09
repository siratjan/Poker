import { describe, expect, it } from 'vitest';
import {
  berlinToday,
  formatBerlinDateTime,
  formatBerlinTime,
  formatPlayedOn,
  isValidCalendarDate,
  maxPlayedOn,
} from './time';

describe('berlinToday', () => {
  it('renders the Berlin calendar day as YYYY-MM-DD', () => {
    // 2026-06-01 00:30 UTC is 02:30 in Berlin (CEST) -> still the 1st
    expect(berlinToday(new Date('2026-06-01T00:30:00Z'))).toBe('2026-06-01');
  });

  it('rolls the day forward when Berlin is already past midnight', () => {
    // 2026-06-01 23:30 UTC is 2026-06-02 01:30 in Berlin (CEST)
    expect(berlinToday(new Date('2026-06-01T23:30:00Z'))).toBe('2026-06-02');
  });

  it('handles winter (CET, +1) as well', () => {
    // 2026-01-01 23:30 UTC is 2026-01-02 00:30 in Berlin (CET)
    expect(berlinToday(new Date('2026-01-01T23:30:00Z'))).toBe('2026-01-02');
  });
});

describe('maxPlayedOn', () => {
  it('is today + 1 day in Berlin', () => {
    expect(maxPlayedOn(new Date('2026-06-01T10:00:00Z'))).toBe('2026-06-02');
  });

  it('crosses month boundaries', () => {
    expect(maxPlayedOn(new Date('2026-01-31T10:00:00Z'))).toBe('2026-02-01');
  });

  it('crosses year boundaries', () => {
    expect(maxPlayedOn(new Date('2026-12-31T10:00:00Z'))).toBe('2027-01-01');
  });
});

describe('isValidCalendarDate', () => {
  it('accepts real dates', () => {
    expect(isValidCalendarDate('2026-09-11')).toBe(true);
    expect(isValidCalendarDate('2024-02-29')).toBe(true); // leap year
  });

  it('rejects malformed strings', () => {
    for (const value of ['', '2026-9-11', '11.09.2026', '2026/09/11', 'abc', '2026-09-11T00:00:00']) {
      expect(isValidCalendarDate(value)).toBe(false);
    }
  });

  it('rejects impossible dates', () => {
    for (const value of ['2026-13-01', '2026-00-01', '2026-02-30', '2026-04-31', '2025-02-29']) {
      expect(isValidCalendarDate(value)).toBe(false);
    }
  });
});

describe('formatPlayedOn', () => {
  it('renders the German long form with weekday', () => {
    expect(formatPlayedOn('2026-09-11')).toBe('Fr, 11.09.2026');
    expect(formatPlayedOn('2026-09-12')).toBe('Sa, 12.09.2026');
  });

  it('pads day and month to two digits', () => {
    expect(formatPlayedOn('2026-01-05')).toBe('Mo, 05.01.2026');
  });

  it('returns the input unchanged for an invalid date', () => {
    expect(formatPlayedOn('not-a-date')).toBe('not-a-date');
  });
});

describe('formatBerlinTime', () => {
  it('renders a UTC timestamp as Berlin time of day (summer, +2)', () => {
    expect(formatBerlinTime('2026-09-09T19:14:00.000Z')).toBe('21:14');
  });

  it('renders a winter timestamp with +1', () => {
    expect(formatBerlinTime('2026-01-15T19:14:00.000Z')).toBe('20:14');
  });

  it('returns the input unchanged for an unparsable value', () => {
    expect(formatBerlinTime('not-a-timestamp')).toBe('not-a-timestamp');
  });
});

describe('formatBerlinDateTime', () => {
  it('renders date and time in Berlin', () => {
    expect(formatBerlinDateTime('2026-09-09T22:30:00.000Z')).toBe('10.09.2026, 00:30');
  });

  it('returns the input unchanged for an unparsable value', () => {
    expect(formatBerlinDateTime('nope')).toBe('nope');
  });
});
