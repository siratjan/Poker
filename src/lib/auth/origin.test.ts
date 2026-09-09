import { describe, expect, it } from 'vitest';
import { isTrustworthyForwardedHost, publicOrigin, type HeaderSource } from './origin';

const FALLBACK = 'http://internal.local:3000';

function headers(values: Record<string, string>): HeaderSource {
  return {
    get(name: string): string | null {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

const trusted = { trustForwardedHeaders: true } as const;

describe('publicOrigin', () => {
  it('falls back to the request origin without forwarded headers', () => {
    expect(publicOrigin(headers({}), FALLBACK, trusted)).toBe(FALLBACK);
  });

  it('uses the forwarded host and defaults to https', () => {
    expect(publicOrigin(headers({ 'x-forwarded-host': 'poker.vercel.app' }), FALLBACK, trusted)).toBe(
      'https://poker.vercel.app',
    );
  });

  it('honours a forwarded http scheme', () => {
    const source = headers({ 'x-forwarded-host': 'poker.test:8080', 'x-forwarded-proto': 'http' });
    expect(publicOrigin(source, FALLBACK, trusted)).toBe('http://poker.test:8080');
  });

  it('takes the first entry of a comma separated chain', () => {
    const source = headers({
      'x-forwarded-host': 'poker.vercel.app, internal.local',
      'x-forwarded-proto': 'https, http',
    });
    expect(publicOrigin(source, FALLBACK, trusted)).toBe('https://poker.vercel.app');
  });

  it('ignores an unknown scheme and keeps https', () => {
    const source = headers({ 'x-forwarded-host': 'poker.vercel.app', 'x-forwarded-proto': 'javascript' });
    expect(publicOrigin(source, FALLBACK, trusted)).toBe('https://poker.vercel.app');
  });

  it('ignores the headers when they are not trustworthy (local dev)', () => {
    const source = headers({ 'x-forwarded-host': 'evil.example' });
    expect(publicOrigin(source, FALLBACK, { trustForwardedHeaders: false })).toBe(FALLBACK);
  });

  it.each([
    ['empty', ''],
    ['only whitespace', '   '],
    ['with a path', 'evil.example/attack'],
    ['with a scheme', 'https://evil.example'],
    ['protocol relative', '//evil.example'],
    ['with userinfo', 'user@evil.example'],
    ['with a backslash', 'evil.example\\attack'],
    ['with a query', 'evil.example?x=1'],
    ['with a fragment', 'evil.example#x'],
    ['with a space', 'evil example'],
    ['with a newline', 'poker.app\nSet-Cookie: x=1'],
    ['too long', `${'a'.repeat(260)}.example`],
  ])('falls back for a forwarded host %s', (_label, value) => {
    expect(publicOrigin(headers({ 'x-forwarded-host': value }), FALLBACK, trusted)).toBe(FALLBACK);
  });

  it('never lets a header inject a path into the origin', () => {
    const source = headers({ 'x-forwarded-host': 'poker.vercel.app/../evil.example' });
    expect(publicOrigin(source, FALLBACK, trusted)).toBe(FALLBACK);
  });
});

describe('isTrustworthyForwardedHost', () => {
  it('accepts plain hosts and ports', () => {
    expect(isTrustworthyForwardedHost('poker-kasse.vercel.app')).toBe(true);
    expect(isTrustworthyForwardedHost('localhost:3000')).toBe(true);
  });

  it('rejects anything that is not a bare host', () => {
    expect(isTrustworthyForwardedHost('-poker.app')).toBe(false);
    expect(isTrustworthyForwardedHost('poker.app:')).toBe(false);
    expect(isTrustworthyForwardedHost('poker.app:999999')).toBe(false);
  });
});
