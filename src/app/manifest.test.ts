import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '@/app/manifest';
import { isPublicPath } from '@/lib/auth/paths';

/**
 * WP9 step 1 / Testauftrag Gaby: the manifest has to be valid, its icons have
 * to exist in the right sizes, and `start_url` has to survive the login
 * redirect. All three are checked here rather than in a browser, so a wrong
 * path or a deleted icon fails the build instead of the installation.
 */

const manifestValue = manifest();

/** Chrome's installability criteria that a manifest alone can satisfy. */
describe('web app manifest', () => {
  it('carries the fields an installable manifest needs', () => {
    expect(manifestValue.name).toBe('Poker-Kasse');
    expect(manifestValue.short_name).toBe('Poker-Kasse');
    expect(manifestValue.start_url).toBe('/');
    expect(manifestValue.scope).toBe('/');
    expect(manifestValue.display).toBe('standalone');
    expect(manifestValue.lang).toBe('de');
  });

  it('names a theme and a background colour as six-digit hex', () => {
    expect(manifestValue.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(manifestValue.background_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('offers 192 and 512 px icons plus a maskable one', () => {
    const icons = manifestValue.icons ?? [];
    const sizes = icons.map((icon) => icon.sizes);

    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of icons) expect(icon.type).toBe('image/png');
  });

  it('points at icon files that really exist and are not empty', () => {
    for (const icon of manifestValue.icons ?? []) {
      const path = fileURLToPath(new URL(`../../public${icon.src}`, import.meta.url));
      expect(existsSync(path), `${icon.src} fehlt in public/`).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(0);
    }
  });

  it('keeps every icon path public, so an anonymous install check reaches it', () => {
    // Both locks have to agree: `isPublicPath` (used by the proxy) and the
    // matcher literal (checked in src/proxy.matcher.test.ts).
    for (const icon of manifestValue.icons ?? []) {
      expect(isPublicPath(icon.src)).toBe(true);
    }
  });

  it('uses a start_url that the login redirect can handle', () => {
    // `/` is not public: an anonymous start is redirected to /login and, after
    // Google, lands back on `/`. What matters is that it is an in-app path and
    // not the login page itself, which would strand an installed app there.
    expect(manifestValue.start_url).toBe('/');
    expect(isPublicPath(manifestValue.start_url ?? '')).toBe(false);
  });
});
