/**
 * WP2 — Open-Redirect-Schutz und Proxy-Matcher (Gaby).
 *
 * Der `next`-Parameter ist vollständig angreiferkontrolliert: er steht in der URL
 * von `/login`, wird von dort in `redirectTo` für Google übernommen und kommt im
 * OAuth-Callback zurück. Ein Angreifer, der daraus eine fremde Herkunft macht,
 * bekommt einen Redirect von der eigenen Domain geschenkt (Phishing).
 *
 * Diese Datei prüft nicht den Wortlaut der Hilfsfunktion, sondern die
 * *Sicherheitseigenschaft*, auf die es ankommt: was am Ende in `new URL(next, base)`
 * landet — genau die Auflösung, die `src/proxy.ts`, `src/app/auth/callback/route.ts`
 * und `src/app/login/page.tsx` durchführen — bleibt auf der eigenen Herkunft.
 *
 * Zusätzlich wird der Weg über die echte Query-Dekodierung gegangen
 * (`URLSearchParams`), weil `%2F%2F` erst dort wieder zu `//` wird.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HOME_PATH, LOGIN_PATH, isPublicPath, loginPathFor, safeNextPath } from '@/lib/auth/paths';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'http://localhost:3000';
const BASE = `${ORIGIN}/login`;

/** Wie der Produktivcode: dekodierter Query-Wert → Guard → Auflösung gegen die eigene Herkunft. */
function resolveNext(rawQueryValue: string): URL {
  const decoded = new URL(`${BASE}?next=${rawQueryValue}`).searchParams.get('next');
  return new URL(safeNextPath(decoded), BASE);
}

describe('safeNextPath — Herkunft kann nicht verlassen werden', () => {
  it.each([
    ['https://evil.example/steal', 'absolute URL'],
    ['http://evil.example', 'absolute URL ohne Pfad'],
    ['HTTPS://evil.example', 'Schema in Großbuchstaben'],
    ['//evil.example', 'protokoll-relativ'],
    ['%2F%2Fevil.example', 'protokoll-relativ, prozentkodiert'],
    ['%2f%2fevil.example', 'protokoll-relativ, kleingeschrieben kodiert'],
    ['%2F%5Cevil.example', 'Slash + Backslash kodiert'],
    ['/%09//evil.example', 'Tabulator kodiert — URL() würde ihn entfernen'],
    ['/%0A//evil.example', 'Zeilenumbruch kodiert'],
    ['/%0D%0A//evil.example', 'CRLF kodiert (Header-Splitting)'],
    ['/%00//evil.example', 'Nullbyte kodiert'],
    ['%5C%5Cevil.example', 'zwei Backslashes kodiert'],
    ['/%5Cevil.example', 'Backslash kodiert'],
    ['////evil.example', 'vier Slashes'],
    ['/%09/%09//evil.example', 'mehrere Steuerzeichen'],
    ['%20//evil.example', 'führendes Leerzeichen vor protokoll-relativ'],
    ['javascript:alert(1)', 'javascript-Schema'],
    ['data:text/html,%3Cscript%3E', 'data-Schema'],
    ['%09javascript:alert(1)', 'javascript-Schema mit Steuerzeichen davor'],
    ['//evil.example/%2e%2e', 'protokoll-relativ mit Punkten'],
  ])('weist %s ab (%s)', (payload) => {
    const url = resolveNext(payload);
    expect(url.origin).toBe(ORIGIN);
    expect(url.host).toBe('localhost:3000');
    expect(url.href).toBe(`${ORIGIN}${HOME_PATH}`);
  });

  it.each([
    '/..//evil.example',
    '/%2e%2e//evil.example',
    '/x/../..//evil.example',
    '/./..//evil.example',
  ])('bleibt bei Pfad-Normalisierung (%s) auf der eigenen Herkunft', (payload) => {
    // Diese überleben den Guard (sie sind echte, `/`-relative Pfade), aber die
    // URL-Auflösung darf sie niemals zu einer fremden Herkunft machen.
    const url = resolveNext(payload);
    expect(url.origin).toBe(ORIGIN);
  });

  it('lässt echte In-App-Ziele unverändert durch', () => {
    expect(safeNextPath('/sessions/8f2c1e4a-0000-4000-8000-000000000000')).toBe(
      '/sessions/8f2c1e4a-0000-4000-8000-000000000000',
    );
    expect(safeNextPath('/players?sort=name&dir=asc')).toBe('/players?sort=name&dir=asc');
    expect(resolveNext('%2Fplayers').href).toBe(`${ORIGIN}/players`);
  });

  it('schickt nie zurück in den Login-Fluss (Schleifenschutz)', () => {
    for (const loop of ['/login', '/login?next=%2Fplayers', '/auth/callback?code=x', '/auth']) {
      expect(safeNextPath(loop)).toBe(HOME_PATH);
    }
  });

  it('Eigenschaft: kein einziger String verlässt die Herkunft', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (raw) => {
        const next = safeNextPath(raw);
        expect(next.startsWith('/')).toBe(true);
        expect(next.startsWith('//')).toBe(false);
        expect(next.startsWith('/\\')).toBe(false);
        expect(new URL(next, BASE).origin).toBe(ORIGIN);
      }),
      { numRuns: 2000 },
    );
  });

  it('Eigenschaft: auch mit Host-Bausteinen davor bleibt es lokal', () => {
    const prefix = fc.constantFrom(
      '//',
      '/\\',
      '\\\\',
      'https://',
      'http://',
      '\t//',
      '\n//',
      ' //',
      '/%2F%2F',
      '////',
    );
    fc.assert(
      fc.property(prefix, fc.webSegment(), (p, host) => {
        const next = safeNextPath(`${p}${host}.example/x`);
        expect(new URL(next, BASE).origin).toBe(ORIGIN);
      }),
      { numRuns: 500 },
    );
  });

  it('Eigenschaft: der Weg Proxy → /login?next=… → Auflösung bleibt lokal', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (raw) => {
        const path = raw.startsWith('/') ? raw : `/${raw}`;
        const loginUrl = new URL(loginPathFor(path), BASE);
        expect(loginUrl.origin).toBe(ORIGIN);
        expect(loginUrl.pathname).toBe(LOGIN_PATH);
        // Was die Login-Seite daraus wieder herausliest, muss ebenfalls lokal sein.
        const back = safeNextPath(loginUrl.searchParams.get('next'));
        expect(new URL(back, BASE).origin).toBe(ORIGIN);
      }),
      { numRuns: 1000 },
    );
  });

  it('begrenzt die Länge, damit kein Header gesprengt wird', () => {
    expect(safeNextPath(`/${'a'.repeat(512)}`)).toBe(HOME_PATH);
    expect(safeNextPath(`/${'a'.repeat(400)}`)).toBe(`/${'a'.repeat(400)}`);
  });
});

describe('isPublicPath — Sperre gilt für alles außer der Login-Insel', () => {
  it.each(['/login', '/auth', '/auth/callback', '/favicon.ico', '/manifest.webmanifest', '/icons/a.png'])(
    '%s ist öffentlich',
    (path) => {
      expect(isPublicPath(path)).toBe(true);
    },
  );

  it.each([
    '/',
    '/players',
    '/log',
    '/admin',
    '/sessions/1',
    '/loginx',
    '/login/extra',
    '/authors',
    '/Login',
    '/ICONS/a.png',
    '/icons',
  ])('%s ist geschützt', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

/**
 * Der Matcher entscheidet, welche Anfragen überhaupt auf eine Session geprüft
 * werden. Er muss statisch in src/proxy.ts stehen (Next liest ihn beim Build),
 * deshalb wird die Datei gelesen statt importiert.
 */
describe('Proxy-Matcher (WP2 Testauftrag)', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/proxy.ts', import.meta.url)),
    'utf8',
  );
  const literal = source.match(/matcher:\s*\[\s*(?:\/\*[\s\S]*?\*\/\s*)?'([^']+)'/);
  if (literal === null) throw new Error('kein matcher-Literal in src/proxy.ts gefunden');
  const matcher = new RegExp(`^${literal[1].replace(/\\\\/g, '\\')}$`);

  it.each([
    '/_next/static/chunks/main-abc.js',
    '/_next/static/media/font.woff2',
    '/_next/image?url=%2Ficon.png&w=64&q=75',
    '/favicon.ico',
    '/manifest.webmanifest',
    '/robots.txt',
    '/sitemap.xml',
    '/icons/icon-192.png',
    '/icons/nested/icon.svg',
  ])('nimmt %s aus', (path) => {
    expect(matcher.test(path)).toBe(false);
  });

  // Hinweis Gaby (Bericht WP2, F2): `/_next/*` ist nur für `static` und `image`
  // ausgenommen. Weitere `_next`-Endpunkte (z. B. der Dev-HMR-Kanal) laufen durch
  // den Proxy. Das ist bewusst nicht als Erwartung festgeschrieben, damit eine
  // Erweiterung des Matchers auf `_next/` diesen Test nicht rot macht.

  it.each(['/', '/players', '/log', '/admin', '/sessions/abc', '/login', '/auth/callback'])(
    'prüft %s',
    (path) => {
      expect(matcher.test(path)).toBe(true);
    },
  );

  it('hält den Next-16-Namen ein (proxy, nicht middleware)', () => {
    expect(source).toMatch(/export async function proxy\(/);
    expect(source).not.toMatch(/export (async )?function middleware\(/);
  });

  it('leitet ohne Session auf /login mit gemerktem Ziel', () => {
    expect(loginPathFor('/players')).toBe('/login?next=%2Fplayers');
    expect(loginPathFor('/sessions/abc', '?tab=buyins')).toBe(
      '/login?next=%2Fsessions%2Fabc%3Ftab%3Dbuyins',
    );
    expect(loginPathFor('/')).toBe(LOGIN_PATH);
  });
});
