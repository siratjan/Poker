import { describe, expect, it } from 'vitest';
import { createPlayerSchema, renamePlayerSchema } from './player';

const UUID = '22222222-2222-4222-8222-222222222222';

describe('createPlayerSchema', () => {
  it('trims the name', () => {
    expect(createPlayerSchema.parse({ name: '  Ali  ' }).name).toBe('Ali');
  });

  it('rejects an empty or whitespace-only name', () => {
    for (const name of ['', '   ']) {
      expect(createPlayerSchema.safeParse({ name }).success).toBe(false);
    }
  });

  it('accepts up to 40 characters and rejects 41 (matches the DB check)', () => {
    expect(createPlayerSchema.safeParse({ name: 'x'.repeat(40) }).success).toBe(true);
    expect(createPlayerSchema.safeParse({ name: 'x'.repeat(41) }).success).toBe(false);
  });
});

describe('renamePlayerSchema', () => {
  it('requires a valid uuid id and a valid name', () => {
    expect(renamePlayerSchema.safeParse({ id: 'nope', name: 'Ali' }).success).toBe(false);
    expect(renamePlayerSchema.safeParse({ id: UUID, name: '' }).success).toBe(false);
    expect(renamePlayerSchema.safeParse({ id: UUID, name: 'Ali' }).success).toBe(true);
  });
});
