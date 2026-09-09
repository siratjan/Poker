import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/getCurrentUser';
import type { Role } from '@/lib/auth/roles';

/**
 * Unit tests for the admin server actions: `requireAdmin` in every one of them,
 * zod validation of the quick amounts and the whitelist, and the mapping of the
 * `LAST_ADMIN` trigger. Supabase and the current user are mocked.
 */

type DbResult = { data: unknown; error: unknown };

interface Builder extends PromiseLike<DbResult> {
  insert: (...args: unknown[]) => Builder;
  update: (...args: unknown[]) => Builder;
  upsert: (...args: unknown[]) => Builder;
  delete: (...args: unknown[]) => Builder;
  eq: (...args: unknown[]) => Builder;
  select: (...args: unknown[]) => Builder;
  maybeSingle: () => Promise<DbResult>;
}

/** Records what the action sent to the database, so the payload can be asserted. */
const calls: { table: string; op: string; payload: unknown }[] = [];

function builderFor(table: string, result: DbResult): Builder {
  const builder: Builder = {
    insert: (payload) => record(table, 'insert', payload, builder),
    update: (payload) => record(table, 'update', payload, builder),
    upsert: (payload) => record(table, 'upsert', payload, builder),
    delete: () => record(table, 'delete', null, builder),
    eq: () => builder,
    select: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

function record(table: string, op: string, payload: unknown, builder: Builder): Builder {
  calls.push({ table, op, payload });
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

const { removeWhitelist, setQuickAmounts, setUserRole, upsertWhitelist } = await import('./admin');

const USER_ID = '11111111-1111-4111-8111-111111111111';

function asUser(role: Role): CurrentUser {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    email: 'admin@example.test',
    displayName: 'Admin',
    avatarUrl: null,
    role,
  };
}

function setDb(result: DbResult) {
  createClient.mockResolvedValue({ from: (table: string) => builderFor(table, result) });
}

afterEach(() => {
  getCurrentUser.mockReset();
  createClient.mockReset();
  revalidatePath.mockReset();
  calls.length = 0;
});

describe('role guard', () => {
  it.each([
    ['setUserRole', () => setUserRole({ userId: USER_ID, role: 'editor' })],
    ['setQuickAmounts', () => setQuickAmounts({ cents: [5000] })],
    ['upsertWhitelist', () => upsertWhitelist({ email: 'a@b.de', role: 'editor' })],
    ['removeWhitelist', () => removeWhitelist({ email: 'a@b.de' })],
  ])('%s refuses an editor and never touches the database', async (_name, run) => {
    getCurrentUser.mockResolvedValue(asUser('editor'));

    const result = await run();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('refuses a visitor without a session', async () => {
    getCurrentUser.mockResolvedValue(null);

    const result = await setUserRole({ userId: USER_ID, role: 'admin' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('setUserRole', () => {
  it('writes only the role column', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb({ data: { id: USER_ID, role: 'editor' }, error: null });

    const result = await setUserRole({ userId: USER_ID, role: 'editor' });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ table: 'app_users', op: 'update', payload: { role: 'editor' } }]);
    expect(revalidatePath).toHaveBeenCalledWith('/admin');
  });

  it('rejects an unknown role before the database', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));

    const result = await setUserRole({ userId: USER_ID, role: 'superuser' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('turns the LAST_ADMIN trigger into a German sentence', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb({ data: null, error: { code: 'P0001', message: 'LAST_ADMIN' } });

    const result = await setUserRole({ userId: USER_ID, role: 'viewer' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LAST_ADMIN');
      expect(result.error.message).toContain('Der letzte Admin kann nicht degradiert werden');
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('reports a missing user instead of pretending success', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb({ data: null, error: null });

    const result = await setUserRole({ userId: USER_ID, role: 'viewer' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('USER_NOT_FOUND');
  });

  it('never leaks a raw Postgres message', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb({ data: null, error: { code: 'XX000', message: 'internal error at line 42' } });

    const result = await setUserRole({ userId: USER_ID, role: 'viewer' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNEXPECTED');
      expect(result.error.message).not.toContain('line 42');
    }
  });
});

describe('setQuickAmounts', () => {
  it('stores the amounts sorted', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb({ data: null, error: null });

    const result = await setQuickAmounts({ cents: [20000, 5000, 10000] });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.cents).toEqual([5000, 10000, 20000]);
    expect(calls).toEqual([
      {
        table: 'settings',
        op: 'upsert',
        payload: { key: 'quick_amounts_cents', value: [5000, 10000, 20000] },
      },
    ]);
  });

  it.each([
    ['empty', []],
    ['seven values', [1, 2, 3, 4, 5, 6, 7]],
    ['zero', [0, 5000]],
    ['negative', [-5000]],
    ['a float', [50.5]],
    ['duplicates', [5000, 5000]],
    ['above the typo guard', [1_000_001]],
  ])('rejects %s', async (_name, cents) => {
    getCurrentUser.mockResolvedValue(asUser('admin'));

    const result = await setQuickAmounts({ cents });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('accepts six values', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb({ data: null, error: null });

    const result = await setQuickAmounts({ cents: [100, 200, 300, 400, 500, 600] });

    expect(result.ok).toBe(true);
  });
});

describe('whitelist', () => {
  it('lower-cases and trims the address (0001 checks email = lower(email))', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb({ data: null, error: null });

    const result = await upsertWhitelist({ email: '  Ali@Example.DE ', role: 'admin' });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      { table: 'role_whitelist', op: 'upsert', payload: { email: 'ali@example.de', role: 'admin' } },
    ]);
  });

  it('rejects a malformed address', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));

    const result = await upsertWhitelist({ email: 'kein-mail', role: 'editor' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('removes an address', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb({ data: { email: 'ali@example.de' }, error: null });

    const result = await removeWhitelist({ email: 'ALI@example.de' });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ table: 'role_whitelist', op: 'delete', payload: null }]);
    expect(revalidatePath).toHaveBeenCalledWith('/admin');
  });

  it('reports an address that was not on the list', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb({ data: null, error: null });

    const result = await removeWhitelist({ email: 'ali@example.de' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WHITELIST_NOT_FOUND');
  });
});
