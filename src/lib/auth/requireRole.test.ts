import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, actionResult } from '@/lib/actions/result';
import type { CurrentUser } from './getCurrentUser';
import type { Role } from './roles';

const getCurrentUser = vi.hoisted(() => vi.fn<() => Promise<CurrentUser | null>>());

vi.mock('./getCurrentUser', () => ({ getCurrentUser }));

const { requireAdmin, requireEditor, requireUser } = await import('./requireRole');

function user(role: Role): CurrentUser {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'ali@example.test',
    displayName: 'Ali',
    avatarUrl: null,
    role,
  };
}

afterEach(() => {
  getCurrentUser.mockReset();
});

describe('requireUser', () => {
  it('returns the logged-in user', async () => {
    getCurrentUser.mockResolvedValue(user('viewer'));
    await expect(requireUser()).resolves.toMatchObject({ role: 'viewer' });
  });

  it('throws UNAUTHENTICATED without a session', async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(requireUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('requireEditor', () => {
  it.each<Role>(['editor', 'admin'])('lets %s through', async (role) => {
    getCurrentUser.mockResolvedValue(user(role));
    await expect(requireEditor()).resolves.toMatchObject({ role });
  });

  it('rejects a viewer with FORBIDDEN', async () => {
    getCurrentUser.mockResolvedValue(user('viewer'));
    await expect(requireEditor()).rejects.toBeInstanceOf(AppError);
    await expect(requireEditor()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects an anonymous caller', async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(requireEditor()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('requireAdmin', () => {
  it('lets an admin through', async () => {
    getCurrentUser.mockResolvedValue(user('admin'));
    await expect(requireAdmin()).resolves.toMatchObject({ role: 'admin' });
  });

  it.each<Role>(['editor', 'viewer'])('rejects %s', async (role) => {
    getCurrentUser.mockResolvedValue(user(role));
    await expect(requireAdmin()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('with actionResult', () => {
  it('turns a rejection into a German { ok: false } instead of throwing', async () => {
    getCurrentUser.mockResolvedValue(user('viewer'));

    const result = await actionResult(async () => {
      await requireEditor();
      return 'never reached';
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FORBIDDEN');
      expect(result.error.message).toContain('Bearbeiter');
    }
  });
});
