import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/getCurrentUser';
import type { Role } from '@/lib/auth/roles';
import { berlinToday } from '@/lib/time';

/**
 * Unit tests for the session server actions: role guards (editor / admin),
 * validation, and the trigger-error mapping this WP touches. Supabase and the
 * current user are mocked.
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

const { createSession, updateSessionMeta, deleteOpenSession } = await import('./sessions');

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

const SESSION_ID = '33333333-3333-4333-8333-333333333333';

afterEach(() => {
  getCurrentUser.mockReset();
  createClient.mockReset();
  revalidatePath.mockReset();
});

describe('createSession', () => {
  it('refuses a viewer with FORBIDDEN and never touches the database', async () => {
    getCurrentUser.mockResolvedValue(asUser('viewer'));

    const result = await createSession({ playedOn: berlinToday() });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects a far-future date before hitting the database', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));

    const result = await createSession({ playedOn: '2999-01-01' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('creates a session for an editor and revalidates the list', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb({ data: { id: SESSION_ID }, error: null });

    const result = await createSession({ playedOn: berlinToday(), name: 'Freitag' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(SESSION_ID);
    expect(revalidatePath).toHaveBeenCalledWith('/');
  });
});

describe('updateSessionMeta', () => {
  it('translates the SESSION_CLOSED trigger error to German', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb({ data: null, error: { code: 'P0001', message: 'SESSION_CLOSED' } });

    const result = await updateSessionMeta({ id: SESSION_ID, playedOn: berlinToday() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SESSION_CLOSED');
      expect(result.error.message).toContain('abgeschlossen');
    }
  });

  it('returns SESSION_NOT_FOUND when no row was updated', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb({ data: null, error: null });

    const result = await updateSessionMeta({ id: SESSION_ID, playedOn: berlinToday() });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_NOT_FOUND');
  });
});

describe('deleteOpenSession', () => {
  it('requires an admin (editor is refused)', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));

    const result = await deleteOpenSession(SESSION_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('reports CANNOT_DELETE_SESSION when the row was filtered out by RLS', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb({ data: [], error: null });

    const result = await deleteOpenSession(SESSION_ID);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CANNOT_DELETE_SESSION');
  });

  it('deletes an open session for an admin', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb({ data: [{ id: SESSION_ID }], error: null });

    const result = await deleteOpenSession(SESSION_ID);

    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/');
  });
});
