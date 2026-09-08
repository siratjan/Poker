import { describe, expect, it } from 'vitest';
import { HOME_PATH, LOGIN_PATH, isPublicPath, loginPathFor, safeNextPath } from './paths';

describe('isPublicPath', () => {
  it('lets the login page and the OAuth callback through', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/auth')).toBe(true);
    expect(isPublicPath('/auth/callback')).toBe(true);
    expect(isPublicPath('/auth/anything/deeper')).toBe(true);
  });

  it('lets the public files through', () => {
    expect(isPublicPath('/favicon.ico')).toBe(true);
    expect(isPublicPath('/manifest.webmanifest')).toBe(true);
    expect(isPublicPath('/robots.txt')).toBe(true);
    expect(isPublicPath('/icons/icon-192.png')).toBe(true);
  });

  it('protects everything else', () => {
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/sessions/abc')).toBe(false);
    expect(isPublicPath('/players')).toBe(false);
    expect(isPublicPath('/admin')).toBe(false);
    expect(isPublicPath('/log')).toBe(false);
    // no prefix matching on /login: /loginx is a normal, protected route
    expect(isPublicPath('/loginx')).toBe(false);
    expect(isPublicPath('/authors')).toBe(false);
  });
});

describe('safeNextPath', () => {
  it('keeps root-relative paths including query and hash', () => {
    expect(safeNextPath('/sessions/123')).toBe('/sessions/123');
    expect(safeNextPath('/players?sort=name')).toBe('/players?sort=name');
    expect(safeNextPath('/log#bottom')).toBe('/log#bottom');
  });

  it('trims surrounding whitespace', () => {
    expect(safeNextPath('  /players  ')).toBe('/players');
  });

  it.each([
    ['https://evil.example/steal', 'absolute http url'],
    ['http://evil.example', 'absolute http url'],
    ['//evil.example/steal', 'protocol-relative'],
    ['   //evil.example', 'protocol-relative after trim'],
    ['/\\evil.example', 'backslash smuggling'],
    ['/sessions\\..\\evil', 'backslash inside the path'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['data:text/html,<script>', 'data scheme'],
    ['sessions/123', 'relative without leading slash'],
    ['', 'empty'],
    ['   ', 'whitespace only'],
  ])('rejects %s (%s)', (input) => {
    expect(safeNextPath(input)).toBe(HOME_PATH);
  });

  it('rejects control characters', () => {
    expect(safeNextPath('/sessions\n/evil')).toBe(HOME_PATH);
    expect(safeNextPath('/sessions\r\nSet-Cookie: x=1')).toBe(HOME_PATH);
    expect(safeNextPath('/sess\tions')).toBe(HOME_PATH);
    expect(safeNextPath('/sessions\u0000')).toBe(HOME_PATH);
  });

  it('rejects absurdly long values', () => {
    expect(safeNextPath(`/${'a'.repeat(600)}`)).toBe(HOME_PATH);
  });

  it('rejects null, undefined and non-strings', () => {
    expect(safeNextPath(null)).toBe(HOME_PATH);
    expect(safeNextPath(undefined)).toBe(HOME_PATH);
  });

  it('never points back at the login flow (that would loop)', () => {
    expect(safeNextPath('/login')).toBe(HOME_PATH);
    expect(safeNextPath('/login?next=/players')).toBe(HOME_PATH);
    expect(safeNextPath('/auth/callback?code=abc')).toBe(HOME_PATH);
  });

  it('honours an explicit fallback', () => {
    expect(safeNextPath('https://evil.example', '/players')).toBe('/players');
  });

  it('leaves percent-encoding alone (it stays a relative path)', () => {
    expect(safeNextPath('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example');
  });
});

describe('loginPathFor', () => {
  it('appends the encoded target', () => {
    expect(loginPathFor('/sessions/123')).toBe('/login?next=%2Fsessions%2F123');
    expect(loginPathFor('/players', '?sort=name')).toBe('/login?next=%2Fplayers%3Fsort%3Dname');
  });

  it('leaves next off when the target is the default', () => {
    expect(loginPathFor('/')).toBe(LOGIN_PATH);
    expect(loginPathFor('/login')).toBe(LOGIN_PATH);
  });
});
