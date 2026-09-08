import { describe, expect, it } from 'vitest';
import {
  LOGIN_ERROR_CODES,
  isLoginErrorCode,
  loginErrorCodeFor,
  loginErrorMessage,
} from './loginErrors';

describe('loginErrorMessage', () => {
  it('has a German sentence for every code', () => {
    for (const code of LOGIN_ERROR_CODES) {
      const message = loginErrorMessage(code);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/error|failed/i);
    }
  });

  it('explains the missing Google provider so an admin knows what to do', () => {
    expect(loginErrorMessage('provider_disabled')).toContain('Google');
    expect(loginErrorMessage('provider_disabled')).toContain('Providers');
  });

  it('falls back to the generic sentence', () => {
    expect(loginErrorMessage('etwas-anderes')).toBe(loginErrorMessage('unknown'));
    expect(loginErrorMessage(null)).toBe(loginErrorMessage('unknown'));
    expect(loginErrorMessage(undefined)).toBe(loginErrorMessage('unknown'));
    expect(loginErrorMessage(42)).toBe(loginErrorMessage('unknown'));
  });
});

describe('isLoginErrorCode', () => {
  it('accepts only known codes', () => {
    expect(isLoginErrorCode('provider_disabled')).toBe(true);
    expect(isLoginErrorCode('unknown')).toBe(true);
    expect(isLoginErrorCode('provider')).toBe(false);
    expect(isLoginErrorCode(null)).toBe(false);
  });
});

describe('loginErrorCodeFor', () => {
  it('recognises a Supabase project without the Google provider', () => {
    expect(
      loginErrorCodeFor({
        message: 'Unsupported provider: provider is not enabled',
        code: 'validation_failed',
        status: 400,
      }),
    ).toBe('provider_disabled');
    expect(loginErrorCodeFor({ message: 'Unsupported provider' })).toBe('provider_disabled');
    expect(loginErrorCodeFor('provider is not enabled')).toBe('provider_disabled');
  });

  it('recognises a cancelled login', () => {
    expect(loginErrorCodeFor({ code: 'access_denied' })).toBe('access_denied');
    expect(loginErrorCodeFor({ message: 'The user denied the request' })).toBe('access_denied');
  });

  it('recognises a broken configuration', () => {
    expect(loginErrorCodeFor({ code: 'ENV_INVALID', message: 'x' })).toBe('config');
    expect(loginErrorCodeFor(new Error('Die Konfiguration ist unvollständig: …'))).toBe('config');
  });

  it('falls back to unknown', () => {
    expect(loginErrorCodeFor(null)).toBe('unknown');
    expect(loginErrorCodeFor(undefined)).toBe('unknown');
    expect(loginErrorCodeFor({})).toBe('unknown');
    expect(loginErrorCodeFor({ message: 'network request failed' })).toBe('unknown');
  });
});
