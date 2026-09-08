import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { publicEnv } from '@/lib/env';

export type SessionUpdate = {
  /** Response carrying the rotated auth cookies. Must be returned or copied. */
  response: NextResponse;
  /** The verified user, or `null` when nobody is logged in. */
  user: User | null;
};

/**
 * Refreshes the Supabase auth session on every matched request and writes the
 * rotated cookies back onto the response.
 *
 * The redirect decision itself lives in `src/proxy.ts`; this helper only
 * reports who is logged in. Keeping the two apart makes the path rules
 * (`src/lib/auth/paths.ts`) unit-testable.
 */
export async function updateSession(request: NextRequest): Promise<SessionUpdate> {
  let supabaseResponse = NextResponse.next({ request });
  const env = publicEnv();

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not remove: this call refreshes the session token and verifies it
  // against the auth server (cookies alone are not trusted).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response: supabaseResponse, user };
}

/**
 * Moves the auth cookies of `from` onto a redirect response, so a redirect
 * never drops a freshly rotated session.
 */
export function withAuthCookies(target: NextResponse, from: NextResponse): NextResponse {
  for (const cookie of from.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}
