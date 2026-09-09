import type { MetadataRoute } from 'next';

/**
 * Web app manifest (docs/ARBEITSPAKETE.md WP9, step 1). Next serves this route
 * as `/manifest.webmanifest`; that path and `/icons/*` are public
 * (`src/lib/auth/paths.ts`) and excluded from the proxy matcher
 * (`src/proxy.ts`), so the installability check reaches them without a session.
 *
 * `start_url: '/'` is deliberate and works with the login redirect: an
 * unauthenticated start lands on `/login` (the proxy sends `/` there without a
 * `next`, `loginPathFor('/') === '/login'`), and after Google returns, the
 * callback puts the user back on `/`. So the installed app opens on the session
 * list when the session is still valid and on the login screen otherwise —
 * never on a dead-end URL.
 *
 * No `serviceWorker` and no offline cache on purpose (SPEC: amounts must never
 * be stale). Installability does not require one.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Poker-Kasse',
    short_name: 'Poker-Kasse',
    description: 'Pokerabende dokumentieren: Buy-ins, Stacks, Kasse und Schulden.',
    lang: 'de',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    id: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: '#047857',
    background_color: '#ffffff',
    categories: ['finance', 'utilities'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
