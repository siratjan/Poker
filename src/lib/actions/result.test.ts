import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, UNEXPECTED_ERROR, actionResult, fail, isNextControlFlowError, ok } from './result';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ok / fail', () => {
  it('wraps data', () => {
    expect(ok({ id: 'x' })).toEqual({ ok: true, data: { id: 'x' } });
  });

  it('wraps an error with code and German message', () => {
    expect(fail('FORBIDDEN', 'Keine Berechtigung.')).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Keine Berechtigung.' },
    });
  });
});

describe('actionResult', () => {
  it('returns the value of a successful action', async () => {
    await expect(actionResult(async () => 42)).resolves.toEqual({ ok: true, data: 42 });
  });

  it('translates an AppError into a readable result', async () => {
    const result = await actionResult(async () => {
      throw new AppError('FORBIDDEN', 'Dafür fehlt dir die Berechtigung.');
    });
    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Dafür fehlt dir die Berechtigung.' },
    });
  });

  it('hides unexpected errors behind a generic German message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await actionResult(async () => {
      throw new Error('duplicate key value violates unique constraint "players_name_key"');
    });
    expect(result).toEqual({ ok: false, error: UNEXPECTED_ERROR });
    if (!result.ok) {
      expect(result.error.message).not.toContain('constraint');
    }
    expect(spy).toHaveBeenCalledOnce();
  });

  it('never leaks a thrown non-error value', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await actionResult(async () => {
      throw 'raw string';
    });
    expect(result).toEqual({ ok: false, error: UNEXPECTED_ERROR });
  });

  it('lets redirect() and notFound() bubble up', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), {
      digest: 'NEXT_REDIRECT;replace;/login;307;',
    });
    await expect(
      actionResult(async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);

    const notFound = Object.assign(new Error('NEXT_NOT_FOUND'), { digest: 'NEXT_NOT_FOUND' });
    await expect(
      actionResult(async () => {
        throw notFound;
      }),
    ).rejects.toBe(notFound);
  });
});

describe('isNextControlFlowError', () => {
  it('recognises the two Next.js signals', () => {
    expect(isNextControlFlowError({ digest: 'NEXT_REDIRECT;push;/;307;' })).toBe(true);
    expect(isNextControlFlowError({ digest: 'NEXT_NOT_FOUND' })).toBe(true);
  });

  it('is not fooled by anything else', () => {
    expect(isNextControlFlowError(null)).toBe(false);
    expect(isNextControlFlowError(undefined)).toBe(false);
    expect(isNextControlFlowError('NEXT_REDIRECT')).toBe(false);
    expect(isNextControlFlowError(new Error('NEXT_REDIRECT'))).toBe(false);
    expect(isNextControlFlowError({ digest: 42 })).toBe(false);
    expect(isNextControlFlowError({ digest: 'SOMETHING_ELSE' })).toBe(false);
  });
});
