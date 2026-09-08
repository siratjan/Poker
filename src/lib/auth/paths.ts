/**
 * Path helpers for the proxy (src/proxy.ts) and the login page.
 * Pure functions, unit tested — they are the open-redirect guard.
 */

/** Where an unauthenticated visitor is sent. */
export const LOGIN_PATH = '/login';

/** Where a logged-in visitor lands when no target is known. */
export const HOME_PATH = '/';

/**
 * Paths reachable without a session: the login page itself, the OAuth
 * callback and the few public files. Everything else needs a session.
 */
const PUBLIC_FILES = new Set([
  '/favicon.ico',
  '/manifest.webmanifest',
  '/robots.txt',
  '/sitemap.xml',
]);

export function isPublicPath(pathname: string): boolean {
  if (pathname === LOGIN_PATH) return true;
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return true;
  if (PUBLIC_FILES.has(pathname)) return true;
  if (pathname.startsWith('/icons/')) return true;
  return false;
}

/** Control characters must never appear in a path we produce or accept. */
function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Sanitises the `next` parameter of `/login?next=…` and of the OAuth callback.
 *
 * Only same-origin, root-relative paths survive; everything that could leave
 * the app (`https://evil.example`, `//evil.example`, `/\evil.example`,
 * backslash or control-character smuggling) falls back to {@link HOME_PATH}.
 * A `next` that points at the login flow itself would loop, so it is dropped
 * as well.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = HOME_PATH): string {
  if (typeof raw !== 'string') return fallback;

  const value = raw.trim();
  if (value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith('/')) return fallback;
  // "//host" and "/\host" are protocol-relative URLs, not local paths.
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Backslashes and control characters are never part of a path we produce.
  if (value.includes('\\')) return fallback;
  if (hasControlCharacters(value)) return fallback;

  const pathname = value.split('?')[0].split('#')[0];
  if (isPublicPath(pathname)) return fallback;

  return value;
}

/** Builds `/login?next=…`, leaving off `next` when it would be the default. */
export function loginPathFor(pathname: string, search: string = ''): string {
  const target = safeNextPath(`${pathname}${search}`);
  if (target === HOME_PATH) return LOGIN_PATH;
  return `${LOGIN_PATH}?next=${encodeURIComponent(target)}`;
}
