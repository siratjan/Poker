import { NextResponse, type NextRequest } from 'next/server';
import { HOME_PATH, LOGIN_PATH, isPublicPath, loginPathFor, safeNextPath } from '@/lib/auth/paths';
import { EnvError } from '@/lib/env';
import { updateSession, withAuthCookies, type SessionUpdate } from '@/lib/supabase/middleware';

/**
 * Next 16 replaced the `middleware` file convention with `proxy`; the exported
 * function must be named `proxy` (WP0 handoff, open question 1). Signature and
 * `config.matcher` are unchanged.
 *
 * Three jobs:
 *   1. refresh the Supabase session on every request (WP0)
 *   2. no session and a protected path -> /login?next=<path>
 *      session and /login                -> /
 *   3. broken configuration            -> /login?error=config, so the visitor
 *      reads a sentence instead of a 500 page
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  let session: SessionUpdate;
  try {
    session = await updateSession(request);
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(`[proxy] ${error.message}`);
      if (pathname === LOGIN_PATH) return NextResponse.next();
      return NextResponse.redirect(new URL(`${LOGIN_PATH}?error=config`, request.url));
    }
    throw error;
  }

  const { response, user } = session;

  if (user === null) {
    if (isPublicPath(pathname)) return response;
    const target = new URL(loginPathFor(pathname, search), request.url);
    return withAuthCookies(NextResponse.redirect(target), response);
  }

  if (pathname === LOGIN_PATH) {
    // `next` is attacker-controllable, so it goes through the same guard as
    // everywhere else: only root-relative in-app paths survive.
    const next = safeNextPath(request.nextUrl.searchParams.get('next'), HOME_PATH);
    return withAuthCookies(NextResponse.redirect(new URL(next, request.url)), response);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * All request paths except Next.js internals, the PWA files and static
     * image files. Everything that reaches the proxy needs a session, unless
     * src/lib/auth/paths.ts says it is public.
     *
     * `_next/` as a whole rather than `_next/static|_next/image` (Gaby WP2-F1,
     * fixed in WP9): every other `_next` endpoint — the dev HMR channel above
     * all — used to run through the proxy and be redirected to /login.
     *
     * `manifest.webmanifest` and `icons/` have to stay out as well, otherwise
     * the installability check of an anonymous browser sees a redirect instead
     * of the manifest and the app is not offered for installation (WP9, step 1).
     */
    '/((?!_next/|favicon.ico|manifest.webmanifest|robots.txt|sitemap.xml|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
