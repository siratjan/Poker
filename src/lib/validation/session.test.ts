import { describe, expect, it } from 'vitest';
import { berlinToday, maxPlayedOn } from '@/lib/time';
import { createSessionSchema, sessionIdSchema, updateSessionMetaSchema } from './session';

const UUID = '11111111-1111-4111-8111-111111111111';

describe('createSessionSchema', () => {
  it("accepts today's date and no name", () => {
    const parsed = createSessionSchema.parse({ playedOn: berlinToday() });
    expect(parsed.playedOn).toBe(berlinToday());
    expect(parsed.name).toBeNull();
  });

  it('accepts today + 1 day (the allowed maximum)', () => {
    const result = createSessionSchema.safeParse({ playedOn: maxPlayedOn() });
    expect(result.success).toBe(true);
  });

  it('accepts a past date (no lower bound)', () => {
    const result = createSessionSchema.safeParse({ playedOn: '2000-01-01' });
    expect(result.success).toBe(true);
  });

  it('rejects a date more than one day in the future', () => {
    const result = createSessionSchema.safeParse({ playedOn: '2999-01-01' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('Zukunft');
    }
  });

  it('rejects a malformed or impossible date', () => {
    for (const playedOn of ['', '2026-13-40', '11.09.2026', '2026-2-9']) {
      expect(createSessionSchema.safeParse({ playedOn }).success).toBe(false);
    }
  });

  it('trims the name and collapses empty to null', () => {
    expect(createSessionSchema.parse({ playedOn: berlinToday(), name: '  Freitag  ' }).name).toBe(
      'Freitag',
    );
    expect(createSessionSchema.parse({ playedOn: berlinToday(), name: '   ' }).name).toBeNull();
    expect(createSessionSchema.parse({ playedOn: berlinToday(), name: '' }).name).toBeNull();
  });

  it('rejects a name longer than 60 characters', () => {
    const result = createSessionSchema.safeParse({
      playedOn: berlinToday(),
      name: 'x'.repeat(61),
    });
    expect(result.success).toBe(false);
  });
});

describe('updateSessionMetaSchema', () => {
  it('requires a valid uuid id', () => {
    expect(
      updateSessionMetaSchema.safeParse({ id: 'nope', playedOn: berlinToday() }).success,
    ).toBe(false);
    expect(
      updateSessionMetaSchema.safeParse({ id: UUID, playedOn: berlinToday() }).success,
    ).toBe(true);
  });
});

describe('sessionIdSchema', () => {
  it('accepts a uuid, rejects other strings', () => {
    expect(sessionIdSchema.safeParse(UUID).success).toBe(true);
    expect(sessionIdSchema.safeParse('123').success).toBe(false);
  });
});
