/**
 * WP8 — Admin-Bereich und Audit-Log-Ansicht (Gaby).
 *
 * Was hier festgezurrt wird:
 *  1. `describe.ts`: jede Tabelle × Aktion des Audit-Triggers (0002) liefert einen
 *     deutschen Satz; unbekannte Tabellen/Aktionen einen generischen; kaputte
 *     Payloads (Floats, falsche Typen, Arrays, null) stürzen nie ab.
 *  2. Geld im Log kommt ausschließlich über `formatCents` — nie ein roher Cent-Wert,
 *     nie ein Float.
 *  3. Gelöschte Zeilen werden aus `old_data` beschrieben (WP8 DoD).
 *  4. Keyset-Pagination: nachgebaute Seitenfolge über einen Datensatz mit vielen
 *     identischen `at`-Werten **über die Seitengrenze hinweg** — keine Zeile doppelt,
 *     keine übersprungen, auch wenn zwischen zwei Seiten neue Zeilen dazukommen.
 *  5. Filter aus der URL: alles, was kein UUID / keine auditierte Tabelle ist, wird
 *     verworfen (kein offener Wert Richtung PostgREST).
 *  6. Zod-Grenzen der Admin-Actions (Schnellbeträge 1–6, > 0, eindeutig, sortiert;
 *     E-Mail lower/trim).
 *  7. Statisch: `requireAdmin` in allen vier Admin-Actions **vor** jedem DB-Zugriff,
 *     `requireUser` in `loadAuditPage`, Admin-Seite prüft die Rolle vor der
 *     Datenabfrage, kein Supabase-Zugriff aus Client-Komponenten,
 *     `getCurrentUser` per `React.cache` (Rolle wirkt je Request frisch),
 *     `AUDITED_TABLES` deckt sich mit den Triggern in 0002.
 *
 * Nicht abgedeckt (siehe Report „Nicht verifiziert“): echter Browser, echte DB.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { auditCursorFilter, isAfterCursor, type AuditCursor } from '@/lib/audit/cursor';
import {
  AUDITED_TABLES,
  auditActionLabel,
  auditTableLabel,
  describeAuditEntry,
  type AuditEntry,
  type AuditNames,
} from '@/lib/audit/describe';
import {
  auditFiltersToQuery,
  hasAuditFilters,
  parseAuditFilters,
  sessionLogHref,
} from '@/lib/audit/filters';
import type { Json } from '@/lib/database.types';
import {
  removeWhitelistSchema,
  setQuickAmountsSchema,
  setUserRoleSchema,
  upsertWhitelistSchema,
} from '@/lib/validation/admin';
import { auditPageSchema } from '@/lib/validation/audit';

const ROOT = join(__dirname, '..', '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const SESSION = '11111111-1111-4111-8111-111111111111';
const PLAYER = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

const NAMES: AuditNames = {
  players: { [PLAYER]: 'Ali' },
  sessions: { [SESSION]: 'Sa, 12.09.2026' },
};

function entry(overrides: Partial<AuditEntry> & Pick<AuditEntry, 'tableName' | 'action'>): AuditEntry {
  return {
    id: 1,
    at: '2026-09-12T19:14:00.000Z',
    userId: USER,
    userEmail: 'sirat@example.com',
    userName: 'Sirat',
    rowId: 'row-1',
    oldData: null,
    newData: null,
    sessionId: SESSION,
    ...overrides,
  };
}

const say = (overrides: Partial<AuditEntry> & Pick<AuditEntry, 'tableName' | 'action'>): string =>
  describeAuditEntry(entry(overrides), NAMES);

// ---------------------------------------------------------------------------
// 1. Tabelle × Aktion
// ---------------------------------------------------------------------------

/** Ein realistischer Datensatz je auditierter Tabelle (Spalten wie in 0001). */
const ROWS: Readonly<Record<string, Json>> = {
  sessions: {
    id: SESSION,
    played_on: '2026-09-12',
    name: 'Freitagsrunde',
    status: 'open',
    discrepancy_cents: 0,
  },
  session_players: { session_id: SESSION, player_id: PLAYER, position: 1 },
  entries: {
    id: 'entry-1',
    session_id: SESSION,
    player_id: PLAYER,
    type: 'buy_in',
    amount_cents: 10000,
    payment: 'cash',
  },
  players: { id: PLAYER, name: 'Ali' },
  app_users: { id: USER, email: 'ali@example.com', role: 'viewer' },
  settings: { key: 'quick_amounts_cents', value: [5000, 10000, 20000] },
  settlements: { session_id: SESSION, discrepancy_cents: 0 },
};

const ACTIONS = ['INSERT', 'UPDATE', 'DELETE'] as const;

/** Ein Satz ist brauchbar: deutsch, ohne Programmierer-Reste, ohne rohe Ids. */
function isUsableSentence(sentence: string): boolean {
  return (
    sentence.startsWith('hat ') &&
    sentence.length > 10 &&
    !/undefined|NaN|\[object|null/.test(sentence)
  );
}

describe('describe.ts – jede Tabelle × Aktion liefert einen deutschen Satz', () => {
  for (const table of AUDITED_TABLES) {
    for (const action of ACTIONS) {
      it(`${table} × ${action}`, () => {
        const row = ROWS[table];
        const sentence = say({
          tableName: table,
          action,
          oldData: action === 'INSERT' ? null : row,
          newData: action === 'DELETE' ? null : row,
        });
        expect(isUsableSentence(sentence)).toBe(true);
        // Keine rohen UUIDs auf dem Schirm.
        expect(sentence).not.toContain(PLAYER);
        expect(sentence).not.toContain(USER);
      });
    }
  }

  it('deckt genau die Tabellen ab, auf denen 0002 einen Audit-Trigger legt', () => {
    const sql = read('supabase/migrations/0002_functions_triggers.sql');
    const triggered = new Set<string>();
    const pattern = /after insert or update or delete on public\.(\w+)\s*\n\s*for each row execute function public\.audit_row_change/g;
    for (const match of sql.matchAll(pattern)) triggered.add(match[1]);

    expect([...triggered].sort()).toEqual([...AUDITED_TABLES].sort());
  });

  it('unbekannte Tabelle und unbekannte Aktion → generischer Text statt Absturz', () => {
    expect(say({ tableName: 'role_whitelist', action: 'INSERT' })).toBe(
      'hat einen Eintrag in „role_whitelist“ angelegt',
    );
    expect(say({ tableName: 'settlement_lines', action: 'TRUNCATE' })).toBe(
      'hat einen Eintrag in „settlement_lines“ verändert',
    );
    expect(say({ tableName: 'entries', action: 'TRUNCATE', newData: ROWS.entries })).toBe(
      'hat einen Eintrag in „Einträge“ verändert',
    );
    expect(auditActionLabel('TRUNCATE')).toBe('TRUNCATE');
    expect(auditTableLabel('role_whitelist')).toBe('role_whitelist');
  });

  it('exakte Sätze für die Fälle, die im Plan stehen', () => {
    expect(say({ tableName: 'entries', action: 'INSERT', newData: ROWS.entries })).toBe(
      'hat Buy-in 100,00 € bar für Ali eingetragen',
    );
    expect(say({ tableName: 'entries', action: 'DELETE', oldData: ROWS.entries })).toBe(
      'hat Buy-in 100,00 € bar für Ali gelöscht',
    );
    expect(
      say({
        tableName: 'sessions',
        action: 'UPDATE',
        oldData: { ...(ROWS.sessions as object), status: 'open' } as Json,
        newData: { ...(ROWS.sessions as object), status: 'closed' } as Json,
      }),
    ).toBe('hat die Session vom Sa, 12.09.2026 abgeschlossen');
    expect(
      say({
        tableName: 'app_users',
        action: 'UPDATE',
        oldData: { id: USER, email: 'ali@example.com', role: 'viewer' },
        newData: { id: USER, email: 'ali@example.com', role: 'editor' },
      }),
    ).toBe('hat die Rolle von ali@example.com von Betrachter auf Bearbeiter gesetzt');
  });
});

// ---------------------------------------------------------------------------
// 2. Geld
// ---------------------------------------------------------------------------

describe('describe.ts – Geld nur über formatCents', () => {
  it('Cent-Beträge erscheinen formatiert, nie als roher Integer', () => {
    const sentence = say({
      tableName: 'entries',
      action: 'INSERT',
      newData: { ...(ROWS.entries as object), amount_cents: 123450 } as Json,
    });
    expect(sentence).toContain('1.234,50 €');
    expect(sentence).not.toContain('123450');
  });

  it('ein Float in amount_cents wird weggelassen statt falsch gerundet', () => {
    const sentence = say({
      tableName: 'entries',
      action: 'INSERT',
      newData: { ...(ROWS.entries as object), amount_cents: 100.5 } as Json,
    });
    expect(sentence).toBe('hat Buy-in bar für Ali eingetragen');
    expect(sentence).not.toContain('100,5');
    expect(sentence).not.toContain('1,01 €');
  });

  it('Schnellbeträge werden als Liste formatierter Beträge beschrieben, Floats generisch', () => {
    expect(
      say({
        tableName: 'settings',
        action: 'UPDATE',
        newData: { key: 'quick_amounts_cents', value: [5000, 10000, 20000] },
      }),
    ).toBe('hat die Schnellbeträge auf 50,00 € / 100,00 € / 200,00 € gesetzt');

    expect(
      say({
        tableName: 'settings',
        action: 'UPDATE',
        newData: { key: 'quick_amounts_cents', value: [50.5, '100'] },
      }),
    ).toBe('hat die Schnellbeträge geändert');
  });

  it('Differenz beim Abschluss mit Vorzeichen', () => {
    const sentence = say({
      tableName: 'sessions',
      action: 'UPDATE',
      oldData: { ...(ROWS.sessions as object), status: 'open' } as Json,
      newData: { ...(ROWS.sessions as object), status: 'closed', discrepancy_cents: -2000 } as Json,
    });
    expect(sentence).toBe('hat die Session vom Sa, 12.09.2026 abgeschlossen (Differenz -20,00 €)');
  });
});

// ---------------------------------------------------------------------------
// 3. Gelöschte Zeilen zeigen die alten Werte
// ---------------------------------------------------------------------------

describe('describe.ts – gelöschte Zeilen', () => {
  it('DELETE beschreibt aus old_data (new_data ist null)', () => {
    expect(
      say({
        tableName: 'players',
        action: 'DELETE',
        oldData: { id: PLAYER, name: 'Ali' },
      }),
    ).toBe('hat den Spieler „Ali“ gelöscht');

    expect(
      say({
        tableName: 'session_players',
        action: 'DELETE',
        oldData: { session_id: SESSION, player_id: PLAYER },
      }),
    ).toBe('hat Ali aus der Session entfernt');

    expect(
      say({
        tableName: 'entries',
        action: 'DELETE',
        oldData: { ...(ROWS.entries as object), type: 'cash_out', amount_cents: 25000, payment: null } as Json,
      }),
    ).toBe('hat Stack 250,00 € für Ali gelöscht');
  });

  it('ohne aufgelösten Namen steht „Unbekannt“, nie eine UUID', () => {
    const sentence = describeAuditEntry(
      entry({ tableName: 'session_players', action: 'DELETE', oldData: { player_id: PLAYER } }),
      { players: {}, sessions: {} },
    );
    expect(sentence).toBe('hat Unbekannt aus der Session entfernt');
  });
});

// ---------------------------------------------------------------------------
// 4. Robustheit: kaputtes JSON darf das Log nie killen
// ---------------------------------------------------------------------------

describe('describe.ts – stürzt nie ab', () => {
  it('null, Arrays, Strings, Zahlen als Payload', () => {
    const payloads: (Json | null)[] = [
      null,
      [],
      [1, 2, 3],
      'kaputt',
      42,
      true,
      { amount_cents: 'viel', type: 99, payment: [], player_id: 7 } as unknown as Json,
      { value: 'keine Liste' },
    ];

    for (const table of [...AUDITED_TABLES, 'role_whitelist', '']) {
      for (const action of [...ACTIONS, 'TRUNCATE', '']) {
        for (const payload of payloads) {
          const sentence = describeAuditEntry(
            entry({ tableName: table, action, oldData: payload, newData: payload }),
            NAMES,
          );
          expect(typeof sentence).toBe('string');
          expect(sentence.length).toBeGreaterThan(0);
          expect(sentence).not.toMatch(/undefined|NaN|\[object/);
        }
      }
    }
  });

  it('beliebiges JSON (fast-check) erzeugt immer einen Satz', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...AUDITED_TABLES, 'unbekannt'),
        fc.constantFrom(...ACTIONS, 'MERGE'),
        fc.jsonValue(),
        fc.jsonValue(),
        (table, action, oldData, newData) => {
          const sentence = describeAuditEntry(
            entry({
              tableName: table,
              action,
              oldData: oldData as Json,
              newData: newData as Json,
            }),
            NAMES,
          );
          return (
            typeof sentence === 'string' &&
            sentence.startsWith('hat ') &&
            !/undefined|NaN|\[object/.test(sentence)
          );
        },
      ),
      { numRuns: 500 },
    );
  });

  it('auch ohne sessionId und ohne Namen bleibt der Satz lesbar', () => {
    expect(
      describeAuditEntry(entry({ tableName: 'settlements', action: 'INSERT', sessionId: null }), {
        players: {},
        sessions: {},
      }),
    ).toBe('hat die Abrechnung gespeichert');
  });
});

// ---------------------------------------------------------------------------
// 5. Keyset-Pagination
// ---------------------------------------------------------------------------

type Row = { id: number; at: string };

/** Nachbau von `getAuditPage`: Sortierung `at desc, id desc`, Limit N+1, Keyset-Cursor. */
function page(rows: Row[], cursor: AuditCursor | null, size: number): { rows: Row[]; next: AuditCursor | null } {
  const sorted = [...rows].sort((a, b) => (a.at === b.at ? b.id - a.id : a.at < b.at ? 1 : -1));
  const after = cursor === null ? sorted : sorted.filter((row) => isAfterCursor(cursor, row));
  const slice = after.slice(0, size + 1);
  const hasMore = slice.length > size;
  const shown = hasMore ? slice.slice(0, size) : slice;
  const last = shown.at(-1);
  return { rows: shown, next: hasMore && last !== undefined ? { at: last.at, id: last.id } : null };
}

describe('Keyset-Pagination des Logs', () => {
  /**
   * Fixture mit gleichen Zeitstempeln quer über jede Seitengrenze:
   * 12 Zeilen, aber nur 3 verschiedene `at`-Werte (wie eine Transaktion, die
   * mehrere Zeilen in derselben Mikrosekunde schreibt).
   */
  const rows: Row[] = [
    { id: 1, at: '2026-09-12T18:00:00.000000+00:00' },
    { id: 2, at: '2026-09-12T18:00:00.000000+00:00' },
    { id: 3, at: '2026-09-12T18:00:00.000000+00:00' },
    { id: 4, at: '2026-09-12T18:00:00.000000+00:00' },
    { id: 5, at: '2026-09-12T19:00:00.000000+00:00' },
    { id: 6, at: '2026-09-12T19:00:00.000000+00:00' },
    { id: 7, at: '2026-09-12T19:00:00.000000+00:00' },
    { id: 8, at: '2026-09-12T19:00:00.000000+00:00' },
    { id: 9, at: '2026-09-12T20:00:00.000000+00:00' },
    { id: 10, at: '2026-09-12T20:00:00.000000+00:00' },
    { id: 11, at: '2026-09-12T20:00:00.000000+00:00' },
    { id: 12, at: '2026-09-12T20:00:00.000000+00:00' },
  ];

  it('blättert bei identischen Zeitstempeln vollständig und ohne Doppel', () => {
    for (const size of [1, 2, 3, 5, 12]) {
      const seen: number[] = [];
      let cursor: AuditCursor | null = null;
      let guard = 0;

      do {
        const result: { rows: Row[]; next: AuditCursor | null } = page(rows, cursor, size);
        seen.push(...result.rows.map((row) => row.id));
        cursor = result.next;
        guard += 1;
      } while (cursor !== null && guard < 50);

      // Neueste zuerst, bei gleichem `at` die größere id zuerst.
      expect(seen).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
      expect(new Set(seen).size).toBe(rows.length);
    }
  });

  it('eine neue Zeile zwischen zwei Seiten verschiebt nichts (kein Offset)', () => {
    const first = page(rows, null, 4); // ids 12, 11, 10, 9
    expect(first.rows.map((row) => row.id)).toEqual([12, 11, 10, 9]);

    const withNewer = [...rows, { id: 13, at: '2026-09-12T21:00:00.000000+00:00' }];
    const second = page(withNewer, first.next, 4);

    // Ohne Keyset wäre Zeile 8 hier übersprungen worden.
    expect(second.rows.map((row) => row.id)).toEqual([8, 7, 6, 5]);
  });

  it('der Cursor-Filter ist „älter, oder gleich alt mit kleinerer id“', () => {
    expect(auditCursorFilter({ at: '2026-09-12T19:00:00+00:00', id: 42 })).toBe(
      'at.lt.2026-09-12T19:00:00+00:00,and(at.eq.2026-09-12T19:00:00+00:00,id.lt.42)',
    );
    expect(isAfterCursor({ at: 'b', id: 5 }, { at: 'b', id: 5 })).toBe(false);
    expect(isAfterCursor({ at: 'b', id: 5 }, { at: 'b', id: 6 })).toBe(false);
    expect(isAfterCursor({ at: 'b', id: 5 }, { at: 'b', id: 4 })).toBe(true);
    expect(isAfterCursor({ at: 'b', id: 5 }, { at: 'a', id: 9 })).toBe(true);
    expect(isAfterCursor({ at: 'b', id: 5 }, { at: 'c', id: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Filter aus der URL
// ---------------------------------------------------------------------------

describe('Filter aus der URL', () => {
  it('nimmt nur UUIDs und auditierte Tabellen an', () => {
    expect(parseAuditFilters({ session: SESSION, user: USER, table: 'entries' })).toEqual({
      sessionId: SESSION,
      userId: USER,
      tableName: 'entries',
    });
  });

  it('verwirft alles, was nach Einschleusen aussieht', () => {
    const attacks = [
      "1' or '1'='1",
      'id.gte.0',
      '*',
      `${SESSION},id.gte.0`,
      'entries)or(true',
      'audit_log',
      'role_whitelist',
      'settlement_lines',
      '../admin',
      '%00',
    ];

    for (const value of attacks) {
      const filters = parseAuditFilters({ session: value, user: value, table: value });
      expect(filters).toEqual({ sessionId: null, userId: null, tableName: null });
      expect(hasAuditFilters(filters)).toBe(false);
      expect(auditFiltersToQuery(filters)).toBe('');
    }
  });

  it('mehrfach gesetzte Parameter: der erste zählt, Großschreibung wird normalisiert', () => {
    const filters = parseAuditFilters({ session: [SESSION.toUpperCase(), 'egal'], table: ['entries'] });
    expect(filters.sessionId).toBe(SESSION);
    expect(filters.tableName).toBe('entries');
  });

  it('„Log dieser Session“ verlinkt vorgefiltert', () => {
    expect(sessionLogHref(SESSION)).toBe(`/log?session=${SESSION}`);
    expect(parseAuditFilters({ session: SESSION }).sessionId).toBe(SESSION);
  });

  it('die Server Action nimmt nur dieselben Filter an', () => {
    expect(
      auditPageSchema.safeParse({
        filters: { sessionId: 'kein-uuid', userId: null, tableName: null },
        cursor: null,
      }).success,
    ).toBe(false);

    expect(
      auditPageSchema.safeParse({
        filters: { sessionId: null, userId: null, tableName: 'role_whitelist' },
        cursor: null,
      }).success,
    ).toBe(false);

    expect(
      auditPageSchema.safeParse({
        filters: { sessionId: SESSION, userId: USER, tableName: 'entries' },
        cursor: { at: '2026-09-12T19:00:00+00:00', id: 42 },
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Zod-Grenzen der Admin-Actions
// ---------------------------------------------------------------------------

describe('Schnellbeträge', () => {
  const parse = (cents: unknown) => setQuickAmountsSchema.safeParse({ cents });

  it('speichert sortiert', () => {
    const result = parse([20000, 5000, 10000]);
    expect(result.success && result.data.cents).toEqual([5000, 10000, 20000]);
  });

  it('1 bis 6 Werte', () => {
    expect(parse([5000]).success).toBe(true);
    expect(parse([1, 2, 3, 4, 5, 6]).success).toBe(true);
    expect(parse([]).success).toBe(false);
    expect(parse([1, 2, 3, 4, 5, 6, 7]).success).toBe(false);
  });

  it('nur positive Integer-Cent, keine Dubletten, keine Floats', () => {
    expect(parse([0]).success).toBe(false);
    expect(parse([-100]).success).toBe(false);
    expect(parse([100.5]).success).toBe(false);
    expect(parse([5000, 5000]).success).toBe(false);
    expect(parse(['5000']).success).toBe(false);
    expect(parse([Number.NaN]).success).toBe(false);
    expect(parse([Number.MAX_SAFE_INTEGER]).success).toBe(false);
  });
});

describe('Whitelist und Rolle', () => {
  it('normalisiert E-Mail-Adressen (lower/trim)', () => {
    const result = upsertWhitelistSchema.safeParse({ email: '  Ali@Example.COM ', role: 'editor' });
    expect(result.success && result.data.email).toBe('ali@example.com');

    const removal = removeWhitelistSchema.safeParse({ email: ' ALI@EXAMPLE.COM' });
    expect(removal.success && removal.data.email).toBe('ali@example.com');
  });

  it('weist Unsinn ab', () => {
    expect(upsertWhitelistSchema.safeParse({ email: 'kein-mail', role: 'editor' }).success).toBe(false);
    expect(upsertWhitelistSchema.safeParse({ email: 'a@b.de', role: 'owner' }).success).toBe(false);
    expect(setUserRoleSchema.safeParse({ userId: 'abc', role: 'admin' }).success).toBe(false);
    expect(setUserRoleSchema.safeParse({ userId: USER, role: 'admin' }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Statische Zusagen
// ---------------------------------------------------------------------------

describe('Rollenwächter und Serverseitigkeit', () => {
  const adminSource = read('src/actions/admin.ts');

  for (const action of ['setUserRole', 'setQuickAmounts', 'upsertWhitelist', 'removeWhitelist']) {
    it(`${action} ruft requireAdmin vor dem ersten DB-Zugriff`, () => {
      const start = adminSource.indexOf(`export async function ${action}`);
      expect(start).toBeGreaterThan(-1);
      const body = adminSource.slice(start, adminSource.indexOf('\n}', start));

      const guard = body.indexOf('requireAdmin()');
      const client = body.indexOf('createClient(');
      const table = body.indexOf('.from(');

      expect(guard).toBeGreaterThan(-1);
      expect(client).toBeGreaterThan(guard);
      expect(table).toBeGreaterThan(guard);
      // Validierung erst nach dem Wächter, damit ein Nicht-Admin nichts über
      // Fehlermeldungen erfährt.
      expect(body.indexOf('parseInput(')).toBeGreaterThan(guard);
    });
  }

  it('loadAuditPage ist nur für eingeloggte Nutzer', () => {
    const source = read('src/actions/audit.ts');
    expect(source).toContain('requireUser()');
    expect(source.indexOf('requireUser()')).toBeLessThan(source.indexOf('getAuditPage('));
    // Lesen, nicht schreiben.
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });

  it('die Admin-Seite prüft die Rolle vor jeder Datenabfrage', () => {
    const source = read('src/app/(app)/admin/page.tsx');
    const check = source.indexOf('isAdmin(user.role)');
    const query = source.indexOf('getAdminData(');
    expect(check).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(check);
    expect(source).toContain('Kein Zugriff');
    expect(source).toContain('redirect(loginPathFor(');
  });

  it('kein Supabase-Zugriff aus Client-Komponenten des Pakets', () => {
    for (const file of [
      'src/components/audit/AuditLogList.tsx',
      'src/components/admin/UserRoleList.tsx',
      'src/components/admin/WhitelistManager.tsx',
      'src/components/admin/QuickAmountsEditor.tsx',
    ]) {
      const source = read(file);
      expect(source).toContain("'use client'");
      expect(source).not.toContain('.from(');
      expect(source).not.toContain('@/lib/supabase');
    }
  });

  it('getCurrentUser ist pro Request gecacht (Rolle wirkt sofort, kein Modul-Cache)', () => {
    const source = read('src/lib/auth/getCurrentUser.ts');
    expect(source).toContain("import { cache } from 'react'");
    expect(source).toMatch(/export const getCurrentUser = cache\(/);
    // Kein prozessweiter Cache, der eine Rollenänderung überdauern würde.
    expect(source).not.toMatch(/unstable_cache|revalidate\s*[:=]|new Map\(/);
  });

  it('die Log-Abfragen laufen serverseitig über den Server-Client', () => {
    const source = read('src/lib/queries/auditLog.ts');
    expect(source).toContain("from '@/lib/supabase/server'");
    expect(source).toMatch(/\.order\('at', \{ ascending: false \}\)/);
    expect(source).toMatch(/\.order\('id', \{ ascending: false \}\)/);
    expect(source).not.toContain('.range(');
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  });
});
