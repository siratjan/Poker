import { NextResponse, type NextRequest } from 'next/server';
import { HOME_PATH, LOGIN_PATH, safeNextPath } from '@/lib/auth/paths';
import { loginErrorCodeFor, type LoginErrorCode } from '@/lib/auth/loginErrors';
import { createClient } from '@/lib/supabase/server';

/**
 * OAuth callback: Google sends the visitor back here with a `code`, which is
 * exchanged for a session cookie. Afterwards the visitor goes to `next`
 * (root-relative paths only — see safeNextPath) or to the start page.
 *
 * Every failure ends on /login with a code that the login page turns into a
 * German sentence; no raw provider message is ever shown.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get('next'), HOME_PATH);

  // The provider itself reported a problem (user cancelled, provider off).
  const providerError = searchParams.get('error') ?? searchParams.get('error_code');
  if (providerError !== null) {
    return NextResponse.redirect(
      loginUrl(origin, loginErrorCodeFor({
        code: providerError,
        message: searchParams.get('error_description') ?? '',
      }), next),
    );
  }

  const code = searchParams.get('code');
  if (code === null) {
    return NextResponse.redirect(loginUrl(origin, 'missing_code', next));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error !== null) {
    console.error('[auth] exchangeCodeForSession:', error.message);
    return NextResponse.redirect(loginUrl(origin, 'exchange_failed', next));
  }

  return NextResponse.redirect(new URL(next, origin));
}

function loginUrl(origin: string, error: LoginErrorCode, next: string): URL {
  const url = new URL(LOGIN_PATH, origin);
  url.searchParams.set('error', error);
  if (next !== HOME_PATH) url.searchParams.set('next', next);
  return url;
}
