/**
 * Public origin of the current request (docs/ARBEITSPAKETE.md WP10, Gaby WP2-F2).
 *
 * Behind Vercel the request that reaches the route handler carries an internal
 * host; `request.nextUrl.origin` would then be the wrong address and the login
 * would end on a URL the visitor never typed. The public address is in
 * `x-forwarded-host` / `x-forwarded-proto`, set by the proxy.
 *
 * Open-redirect safety:
 *   - only the *host* is taken from the header, never a path, query or scheme
 *     prefix; the header value is validated against a strict host pattern and
 *     everything else falls back to the request's own origin,
 *   - the scheme may only become `http` or `https`,
 *   - the header is only consulted where a proxy actually exists (production);
 *     locally an injected header is ignored.
 *
 * Pure function, unit tested in origin.test.ts.
 */

/** Minimal read-only view of `Headers`, so tests need no DOM types. */
export interface HeaderSource {
  get(name: string): string | null;
}

export interface PublicOriginOptions {
  /** False locally: without a proxy in front, the headers are not trustworthy. */
  trustForwardedHeaders: boolean;
}

/**
 * Hostname with optional port. No scheme, no userinfo, no path, no whitespace —
 * anything of that kind makes the value unusable and we keep the fallback.
 */
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i;

/** Proxies may append; the first entry is the address the visitor called. */
function firstEntry(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.split(',')[0].trim();
  return value.length === 0 ? null : value;
}

/** True when the value is a bare host (optionally with port) and short enough. */
export function isTrustworthyForwardedHost(value: string): boolean {
  if (value.length > 255) return false;
  return HOST_PATTERN.test(value);
}

/**
 * The origin (`https://host[:port]`) the visitor sees, or `fallbackOrigin`
 * when no usable forwarded header is present.
 */
export function publicOrigin(
  headers: HeaderSource,
  fallbackOrigin: string,
  options: PublicOriginOptions,
): string {
  if (!options.trustForwardedHeaders) return fallbackOrigin;

  const host = firstEntry(headers.get('x-forwarded-host'));
  if (host === null || !isTrustworthyForwardedHost(host)) return fallbackOrigin;

  const forwardedProto = firstEntry(headers.get('x-forwarded-proto'))?.toLowerCase() ?? null;
  const protocol = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : 'https';

  return `${protocol}://${host}`;
}
