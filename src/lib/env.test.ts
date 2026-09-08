import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from './env';

const VALID = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://vcyqzqgybjggoreffwjc.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
};

describe('parseEnv', () => {
  it('accepts a complete environment', () => {
    expect(parseEnv(VALID)).toEqual(VALID);
  });

  it('ignores unrelated variables', () => {
    expect(parseEnv({ ...VALID, SOMETHING_ELSE: 'x' })).toEqual(VALID);
  });

  it('rejects a missing url', () => {
    expect(() => parseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: undefined })).toThrow(EnvError);
  });

  it('rejects a missing key', () => {
    expect(() =>
      parseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }),
    ).toThrow(EnvError);
  });

  it('rejects an empty key', () => {
    expect(() => parseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '   ' })).toThrow(
      EnvError,
    );
  });

  it('rejects a url that is not a url', () => {
    expect(() => parseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: 'vcyq.supabase.co' })).toThrow(
      EnvError,
    );
  });

  it('names every broken variable in one German message', () => {
    let message = '';
    try {
      parseEnv({});
    } catch (error) {
      message = (error as EnvError).message;
    }
    expect(message).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(message).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(message).toContain('fehlt oder ist leer');
    expect(message).toContain('.env.local');
  });

  it('says what is wrong when a value is present but invalid', () => {
    let message = '';
    try {
      parseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: 'nope' });
    } catch (error) {
      message = (error as EnvError).message;
    }
    expect(message).toContain('vollständige URL');
    expect(message).not.toContain('fehlt oder ist leer');
  });

  it('carries a stable error code', () => {
    try {
      parseEnv({});
      expect.unreachable('parseEnv should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as EnvError).code).toBe('ENV_INVALID');
    }
  });

  it('trims the key', () => {
    expect(
      parseEnv({ ...VALID, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '  sb_publishable_abc123  ' })
        .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    ).toBe('sb_publishable_abc123');
  });
});
