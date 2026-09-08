/**
 * German texts for everything that can go wrong around the Google login.
 *
 * The login page never shows a raw Supabase message: the browser button and the
 * OAuth callback both reduce the failure to one of these codes, and the page
 * renders the matching sentence. Pure functions, unit tested.
 */

export const LOGIN_ERROR_CODES = [
  'provider_disabled',
  'access_denied',
  'missing_code',
  'exchange_failed',
  'config',
  'unknown',
] as const;

export type LoginErrorCode = (typeof LOGIN_ERROR_CODES)[number];

const MESSAGES: Record<LoginErrorCode, string> = {
  provider_disabled:
    'Der Google-Login ist in diesem Supabase-Projekt noch nicht aktiviert. ' +
    'Ein Admin muss ihn unter Authentication → Providers → Google einschalten.',
  access_denied: 'Die Anmeldung wurde abgebrochen.',
  missing_code: 'Google hat keinen Anmeldecode geschickt. Bitte noch einmal versuchen.',
  exchange_failed:
    'Die Anmeldung konnte nicht abgeschlossen werden. Bitte noch einmal versuchen.',
  config:
    'Die App ist nicht vollständig konfiguriert (Supabase-Zugangsdaten fehlen). ' +
    'Bitte beim Admin melden.',
  unknown: 'Die Anmeldung hat nicht geklappt. Bitte noch einmal versuchen.',
};

export function isLoginErrorCode(value: unknown): value is LoginErrorCode {
  return typeof value === 'string' && (LOGIN_ERROR_CODES as readonly string[]).includes(value);
}

/** German message for a code; unknown input yields the generic sentence. */
export function loginErrorMessage(code: unknown): string {
  return MESSAGES[isLoginErrorCode(code) ? code : 'unknown'];
}

/**
 * Boils a Supabase auth error down to one of our codes.
 *
 * The interesting case is a project where the Google provider is not enabled
 * yet: Supabase answers with `Unsupported provider: provider is not enabled`
 * (HTTP 400, `error_code: validation_failed`). That must read as a
 * configuration hint, not as "wrong password".
 */
export function loginErrorCodeFor(error: unknown): LoginErrorCode {
  const message = extract(error, 'message').toLowerCase();
  const code = extract(error, 'code').toLowerCase();
  const combined = `${code} ${message}`;

  if (
    combined.includes('unsupported provider') ||
    combined.includes('provider is not enabled') ||
    combined.includes('provider_disabled') ||
    combined.includes('validation_failed')
  ) {
    return 'provider_disabled';
  }
  if (combined.includes('access_denied') || combined.includes('user denied')) {
    return 'access_denied';
  }
  if (combined.includes('env_invalid') || combined.includes('konfiguration ist unvollständig')) {
    return 'config';
  }
  return 'unknown';
}

function extract(error: unknown, key: 'message' | 'code'): string {
  if (typeof error === 'string') return key === 'message' ? error : '';
  if (typeof error !== 'object' || error === null) return '';
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}
