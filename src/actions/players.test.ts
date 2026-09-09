import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/getCurrentUser';
import type { Role } from '@/lib/auth/roles';

/**
 * Unit tests for the player server actions: role guard in every action,
 * zod validation, and the 23505 -> PLAYER_EXISTS mapping. Supabase and the
 * current user are mocked, so no database is required.
 */

type DbResult = { data: unknown; error: unknown };

interface Builder extends PromiseLike<DbResult> {
  insert: (...args: unknown[]) => Builder;
  update: (...args: unknown[]) => Builder;
  delete: (...args: unknown[]) => Builder;
  eq: (...args: unknown[]) => Builder;
  select: (...args: unknown[]) => Builder;
  order: (...args: unknown[]) => Builder;
  single: () => Promise<DbResult>;
  maybeSingle: () => Promise<DbResult>;
}

function builderFor(result: DbResult): Builder {
  const builder: Builder = {
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    eq: () => builder,
    select: () => builder,
    order: () => builder,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

const getCurrentUser = vi.hoisted(() => vi.fn<() => Promise<CurrentUser | null>>());
vi.mock('@/lib/auth/getCurrentUser', () => ({ getCurrentUser }));

const createClient = vi.hoisted(() =>
  vi.fn<() => Promise<{ from: (table: string) => Builder }>>(),
);
vi.mock('@/lib/supabase/server', () => ({ createClient }));

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

const { createPlayer, renamePlayer } = await import('./players');

function asUser(role: Role): CurrentUser {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    email: 'test@example.test',
    displayName: 'Test',
    avatarUrl: null,
    role,
  };
}

function setDb(result: DbResult) {
  createClient.mockResolvedValue({ from: () => builderFor(result) });
}

const PLAYER_ID = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  getCurrentUser.mockReset();
  createClient.mockReset();
  revalidatePath.mockReset();
});

describe('createPlayer', () => {
  it('refuses a viewer with FORBIDDEN and never touches the database', async () => {
    getCurrentUser.mockResolvedValue(asUser('viewer'));

    const result = await createPlayer({ name: 'Ali' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects an empty name before hitting the database', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));

    const result = await createPlayer({ name: '   ' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('creates a player for an editor and revalidates', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb({ data: { id: PLAYER_ID }, error: null });

    const result = await createPlayer({ name: '  Ali  ' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(PLAYER_ID);
    expect(revalidatePath).toHaveBeenCalledWith('/players');
  });

  it('maps a unique violation to PLAYER_EXISTS', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb({ data: null, error: { code: '23505', message: 'duplicate key value' } });

    const result = await createPlayer({ name: 'Ali' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PLAYER_EXISTS');
      expect(result.error.message).toBe('Diesen Spieler gibt es schon.');
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reports an unknown database error generically, not raw', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb({ data: null, error: { code: '42501', message: 'permission denied for table players' } });

    const result = await createPlayer({ name: 'Ali' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNEXPECTED');
      expect(result.error.message).not.toContain('permission denied');
    }
  });
});

describe('renamePlayer', () => {
  it('refuses a viewer with FORBIDDEN', async () => {
    getCurrentUser.mockResolvedValue(asUser('viewer'));

    const result = await renamePlayer({ id: PLAYER_ID, name: 'Ali' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('renames for an editor', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb({ data: { id: PLAYER_ID }, error: null });

    const result = await renamePlayer({ id: PLAYER_ID, name: 'Ali 2' });

    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/players');
  });

  it('returns PLAYER_NOT_FOUND when no row was updated', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb({ data: null, error: null });

    const result = await renamePlayer({ id: PLAYER_ID, name: 'Ali' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PLAYER_NOT_FOUND');
  });

  it('maps a unique violation to PLAYER_EXISTS', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb({ data: null, error: { code: '23505', message: 'duplicate key' } });

    const result = await renamePlayer({ id: PLAYER_ID, name: 'Ali' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PLAYER_EXISTS');
  });
});
