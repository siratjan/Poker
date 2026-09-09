/**
 * The proxy matcher decides which requests are checked for a session at all.
 * It has to stay a string literal inside src/proxy.ts (Next.js reads it
 * statically at build time), so this test reads the file and exercises the
 * pattern instead of importing it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const proxySource = readFileSync(fileURLToPath(new URL('./proxy.ts', import.meta.url)), 'utf8');

function matcherPattern(): string {
  const match = proxySource.match(/matcher:\s*\[\s*(?:\/\*[\s\S]*?\*\/\s*)?'([^']+)'/);
  if (match === null) throw new Error('no matcher literal found in src/proxy.ts');
  return match[1].replace(/\\\\/g, '\\');
}

const matcher = new RegExp(`^${matcherPattern()}$`);

describe('src/proxy.ts', () => {
  it('uses the Next 16 file convention: proxy, not middleware', () => {
    expect(proxySource).toMatch(/export async function proxy\(/);
    expect(proxySource).not.toMatch(/export async function middleware\(/);
    expect(existsSync(fileURLToPath(new URL('./middleware.ts', import.meta.url)))).toBe(false);
  });

  it.each([
    '/',
    '/players',
    '/log',
    '/admin',
    '/sessions/6f1b2d3c-0000-4000-8000-000000000000',
    '/login',
    '/auth/callback',
  ])('checks %s', (path) => {
    expect(matcher.test(path)).toBe(true);
  });

  it.each([
    '/_next/static/chunks/main.js',
    '/_next/image?url=%2Ficon.png',
    // WP9: `_next/` as a whole, not only `static` and `image` (Gaby WP2-F1).
    '/_next/webpack-hmr',
    '/_next/turbopack-hmr',
    '/favicon.ico',
    '/manifest.webmanifest',
    // The PWA icons: an anonymous installability check has to reach them.
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
    '/icons/apple-touch-icon.png',
    '/robots.txt',
    '/sitemap.xml',
    '/icons/icon-192.png',
    '/logo.svg',
    '/photo.jpg',
    '/photo.jpeg',
    '/animation.gif',
    '/picture.webp',
    '/some/deep/asset.png',
  ])('skips %s', (path) => {
    expect(matcher.test(path)).toBe(false);
  });
});
