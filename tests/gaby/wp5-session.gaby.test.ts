/**
 * WP5 — Session-Detail: Teilnehmer, Buy-ins, Cash-out, Auszahlung, Verlauf, Realtime (Gaby).
 *
 * Schärft die Zusagen des Pakets, die sonst nur im Fließtext der Übergabe stehen:
 *  1. `derive.ts` gegen Handrechnung (Summen, Kasse nach Payout, canClose,
 *     Stack 0, mehrere Payouts, Spieler ohne Buy-in, discrepancy).
 *  2. Live-Vorschau der Bar-Auszahlung gegen eine von Hand gerechnete
 *     Stufenverteilung (docs/SETTLEMENT.md, Stufe 1/2) und robust bei
 *     verletzten Vorbedingungen (kein Absturz im Sheet).
 *  3. Fehlercode-Mapping: JEDER Code aus 0002 hat eine deutsche Meldung, und
 *     eine rohe Postgres-Meldung erreicht die UI nie.
 *  4. Zod-Grenzen der Beträge (Integer > 0, Cash-out ≥ 0, Obergrenze 1.000.000).
 *  5. Rollenwächter: alle acht Actions rufen requireEditor vor Validierung und
 *     vor dem ersten DB-Zugriff.
 *  6. Realtime-Hook: ein Abo je Session-Id, Cleanup, genau ein Reconnect,
 *     10-s-Hinweis, kein Tabellenzugriff aus Client-Komponenten.
 *
 * Nicht abgedeckt (siehe Report „Nicht verifiziert“): echtes Realtime über zwei
 * Tabs, echte Trigger-Fehler gegen die Datenbank, Mobile-Viewport.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PostgrestError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  deriveParticipants,
  deriveSession,
  deriveTotals,
  previewCashEntitlement,
  previewParticipants,
  sortEntriesNewestFirst,
  type SessionEntry,
  type SessionParticipant,
} from '@/lib/session/derive';
import { DB_ERROR_MESSAGES, isDbErrorCode, translateDbError } from '@/lib/errors/de';
import {
  addBuyInSchema,
  addCashOutSchema,
  addPayoutSchema,
  MAX_AMOUNT_CENTS,
} from '@/lib/validation/entries';

const ROOT = join(__dirname, '..', '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const ALI = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CEM = '33333333-3333-4333-8333-333333333333';
const GHOST = '99999999-9999-4999-8999-999999999999';

function participant(playerId: string, name: string, position: number): SessionParticipant {
  return { playerId, name, position };
}

let entrySeq = 0;
function entry(
  playerId: string,
  type: SessionEntry['type'],
  amountCents: number,
  payment: SessionEntry['payment'] = null,
  createdAt = `2026-09-09T20:0${entrySeq % 10}:00.000Z`,
): SessionEntry {
  entrySeq += 1;
  return {
    id: `e${entrySeq}`,
    playerId,
    type,
    amountCents,
    payment,
    createdAt,
    createdByName: 'Sirat',
  };
}

// -----------------------------------------------------------------------------
// 1. derive.ts gegen Handrechnung
// -----------------------------------------------------------------------------

describe('deriveSession — Handrechnung eines laufenden Abends', () => {
  /**
   * Ali: 100,00 € bar + 50,00 € Liste, spielt noch.
   * Ben: 100,00 € bar, Stack 0.
   * Cem: 50,00 € Liste, Stack 80,00 €, zwei Auszahlungen 30,00 € + 20,00 €.
   *
   * Von Hand:
   *   totalCash    = 10000 + 10000            = 20000
   *   totalCredit  =  5000 +  5000            = 10000
   *   totalBuyIn   =                            30000
   *   totalStack   =     0 +  8000            =  8000
   *   totalPayout  =  3000 +  2000            =  5000
   *   cashBox      = 20000 − 5000             = 15000
   *   stackCount   = 2 von 3 → canClose false, openParticipants 1
   *   discrepancy  =  8000 − 30000            = −22000
   */
  const participants = [participant(ALI, 'Ali', 1), participant(BEN, 'Ben', 2), participant(CEM, 'Cem', 3)];
  const entries = [
    entry(ALI, 'buy_in', 10000, 'cash', '2026-09-09T20:01:00.000Z'),
    entry(ALI, 'buy_in', 5000, 'credit', '2026-09-09T20:02:00.000Z'),
    entry(BEN, 'buy_in', 10000, 'cash', '2026-09-09T20:03:00.000Z'),
    entry(BEN, 'cash_out', 0, null, '2026-09-09T21:00:00.000Z'),
    entry(CEM, 'buy_in', 5000, 'credit', '2026-09-09T20:04:00.000Z'),
    entry(CEM, 'cash_out', 8000, null, '2026-09-09T21:10:00.000Z'),
    entry(CEM, 'payout', 3000, null, '2026-09-09T21:11:00.000Z'),
    entry(CEM, 'payout', 2000, null, '2026-09-09T21:12:00.000Z'),
  ];

  const { participants: derived, totals } = deriveSession(participants, entries);

  it('rechnet je Spieler richtig', () => {
    expect(derived.map((row) => row.name)).toEqual(['Ali', 'Ben', 'Cem']);

    expect(derived[0]).toMatchObject({
      cashIn: 10000,
      creditIn: 5000,
      buyIn: 15000,
      stack: null,
      payout: 0,
      net: null,
      lastPayment: 'credit',
      hasEntries: true,
    });
    expect(derived[1]).toMatchObject({ cashIn: 10000, stack: 0, payout: 0, net: -10000 });
    // Zwei Auszahlungen werden addiert, nicht überschrieben.
    expect(derived[2]).toMatchObject({ creditIn: 5000, stack: 8000, payout: 5000, net: 3000 });
  });

  it('rechnet die Session-Summen richtig', () => {
    expect(totals).toEqual({
      totalBuyIn: 30000,
      totalCash: 20000,
      totalCredit: 10000,
      totalStack: 8000,
      totalPayout: 5000,
      cashBox: 15000,
      participantCount: 3,
      stackCount: 2,
      openParticipants: 1,
      canClose: false,
      discrepancy: -22000,
    });
  });
});

describe('deriveTotals — Grenzfälle', () => {
  it('canClose ist false ohne Teilnehmer (leere Session ist nicht abschließbar)', () => {
    expect(deriveTotals([]).canClose).toBe(false);
    expect(deriveTotals([]).discrepancy).toBe(0);
  });

  it('Spieler ohne Buy-in, aber mit Stack 0: canClose true, discrepancy 0', () => {
    const { participants, totals } = deriveSession(
      [participant(ALI, 'Ali', 1)],
      [entry(ALI, 'cash_out', 0, null, '2026-09-09T22:00:00.000Z')],
    );
    expect(participants[0]).toMatchObject({ buyIn: 0, stack: 0, net: 0, hasEntries: true });
    expect(totals.canClose).toBe(true);
    expect(totals.stackCount).toBe(1);
    expect(totals.discrepancy).toBe(0);
    expect(totals.cashBox).toBe(0);
  });

  it('Teilnehmer ganz ohne Eintrag blockiert canClose und bleibt entfernbar', () => {
    const { participants, totals } = deriveSession(
      [participant(ALI, 'Ali', 1), participant(BEN, 'Ben', 2)],
      [entry(ALI, 'cash_out', 0, null, '2026-09-09T22:05:00.000Z')],
    );
    expect(participants[1].hasEntries).toBe(false);
    expect(participants[1].stack).toBeNull();
    expect(totals.canClose).toBe(false);
    expect(totals.openParticipants).toBe(1);
  });

  it('Kasse sinkt exakt um die Summe der Auszahlungen (Integer-Cent)', () => {
    const { totals } = deriveSession(
      [participant(ALI, 'Ali', 1)],
      [
        entry(ALI, 'buy_in', 10033, 'cash', '2026-09-09T20:10:00.000Z'),
        entry(ALI, 'cash_out', 10033, null, '2026-09-09T20:20:00.000Z'),
        entry(ALI, 'payout', 3311, null, '2026-09-09T20:21:00.000Z'),
        entry(ALI, 'payout', 22, null, '2026-09-09T20:22:00.000Z'),
      ],
    );
    expect(totals.totalPayout).toBe(3333);
    expect(totals.cashBox).toBe(10033 - 3333);
    expect(Number.isInteger(totals.cashBox)).toBe(true);
    expect(totals.discrepancy).toBe(0);
  });

  it('Listen-Buy-in füllt die Kasse nicht', () => {
    const { totals } = deriveSession(
      [participant(ALI, 'Ali', 1)],
      [entry(ALI, 'buy_in', 5000, 'credit', '2026-09-09T20:30:00.000Z')],
    );
    expect(totals.cashBox).toBe(0);
    expect(totals.totalBuyIn).toBe(5000);
  });

  it('Einträge eines Nicht-Teilnehmers werden ignoriert, nicht summiert', () => {
    const { participants, totals } = deriveSession(
      [participant(ALI, 'Ali', 1)],
      [
        entry(ALI, 'buy_in', 5000, 'cash', '2026-09-09T20:40:00.000Z'),
        entry(GHOST, 'buy_in', 999999, 'cash', '2026-09-09T20:41:00.000Z'),
      ],
    );
    expect(participants).toHaveLength(1);
    expect(totals.totalBuyIn).toBe(5000);
  });

  it('sortiert die Karten nach position, egal wie die Eingabe kommt', () => {
    const derived = deriveParticipants(
      [participant(CEM, 'Cem', 3), participant(ALI, 'Ali', 1), participant(BEN, 'Ben', 2)],
      [],
    );
    expect(derived.map((row) => row.name)).toEqual(['Ali', 'Ben', 'Cem']);
  });

  it('lastPayment ist die Zahlungsart des zeitlich letzten Buy-ins, nicht der Eingabereihenfolge', () => {
    const derived = deriveParticipants(
      [participant(ALI, 'Ali', 1)],
      [
        entry(ALI, 'buy_in', 5000, 'credit', '2026-09-09T22:00:00.000Z'),
        entry(ALI, 'buy_in', 5000, 'cash', '2026-09-09T21:00:00.000Z'),
      ],
    );
    expect(derived[0].lastPayment).toBe('credit');
  });
});

describe('sortEntriesNewestFirst', () => {
  it('sortiert neueste zuerst und bricht Gleichstand stabil über die id', () => {
    const a = { ...entry(ALI, 'buy_in', 100, 'cash', '2026-09-09T20:00:00.000Z'), id: 'a' };
    const b = { ...entry(ALI, 'buy_in', 100, 'cash', '2026-09-09T20:00:00.000Z'), id: 'b' };
    const c = { ...entry(ALI, 'buy_in', 100, 'cash', '2026-09-09T21:00:00.000Z'), id: 'c' };

    expect(sortEntriesNewestFirst([a, b, c]).map((row) => row.id)).toEqual(['c', 'b', 'a']);
    expect(sortEntriesNewestFirst([b, c, a]).map((row) => row.id)).toEqual(['c', 'b', 'a']);
  });

  it('lässt die Eingabe unverändert (keine Mutation der Server-Daten)', () => {
    const input = [
      entry(ALI, 'buy_in', 100, 'cash', '2026-09-09T20:00:00.000Z'),
      entry(ALI, 'buy_in', 100, 'cash', '2026-09-09T21:00:00.000Z'),
    ];
    const ids = input.map((row) => row.id);
    sortEntriesNewestFirst(input);
    expect(input.map((row) => row.id)).toEqual(ids);
  });
});

// -----------------------------------------------------------------------------
// 2. Live-Vorschau der Bar-Auszahlung (docs/SETTLEMENT.md, Stufen 1–3)
// -----------------------------------------------------------------------------

describe('previewCashEntitlement — Handrechnung nach Bar-zuerst-Regel', () => {
  /**
   * Ali: 100,00 € bar, Stack 120,00 €. Ben: 100,00 € bar, Stack 80,00 €.
   * box = 20000.
   * Stufe 1: want1 = min(cashIn, stack) − payout → Ali 10000, Ben 8000; Σ 18000 ≤ box
   *          → beide voll, box = 2000.
   * Stufe 2: want2 = claim − tier1 → Ali 2000, Ben 0; Σ 2000 ≤ box → Ali 2000, box = 0.
   * cashFromBox: Ali 12000, Ben 8000.
   */
  const participants = deriveParticipants(
    [participant(ALI, 'Ali', 1), participant(BEN, 'Ben', 2)],
    [
      entry(ALI, 'buy_in', 10000, 'cash', '2026-09-09T20:00:00.000Z'),
      entry(BEN, 'buy_in', 10000, 'cash', '2026-09-09T20:01:00.000Z'),
      entry(ALI, 'cash_out', 12000, null, '2026-09-09T23:00:00.000Z'),
      entry(BEN, 'cash_out', 8000, null, '2026-09-09T23:01:00.000Z'),
    ],
  );

  it('gibt exakt den handgerechneten Betrag und ist nicht vorläufig', () => {
    expect(previewCashEntitlement(participants, ALI)).toEqual({
      cashFromBoxCents: 12000,
      provisional: false,
    });
    expect(previewCashEntitlement(participants, BEN)).toEqual({
      cashFromBoxCents: 8000,
      provisional: false,
    });
  });

  it('markiert die Vorschau als vorläufig, solange jemand ohne Stack am Tisch sitzt', () => {
    const withOpenPlayer = deriveParticipants(
      [participant(ALI, 'Ali', 1), participant(BEN, 'Ben', 2), participant(CEM, 'Cem', 3)],
      [
        entry(ALI, 'buy_in', 10000, 'cash', '2026-09-09T20:00:00.000Z'),
        entry(BEN, 'buy_in', 10000, 'cash', '2026-09-09T20:01:00.000Z'),
        entry(CEM, 'buy_in', 10000, 'cash', '2026-09-09T20:02:00.000Z'),
        entry(ALI, 'cash_out', 12000, null, '2026-09-09T23:00:00.000Z'),
        entry(BEN, 'cash_out', 8000, null, '2026-09-09T23:01:00.000Z'),
      ],
    );
    // Cem wird mit seinem Buy-in (10000) angenommen → box 30000, Stufe 1: 10000/8000/10000
    // (Σ 28000 ≤ box), Rest 2000 geht in Stufe 2 an Ali (einziger offener Anspruch).
    expect(previewCashEntitlement(withOpenPlayer, ALI)).toEqual({
      cashFromBoxCents: 12000,
      provisional: true,
    });
  });

  it('nimmt für einen noch spielenden Spieler nie weniger als seine schon erhaltene Bar-Auszahlung an', () => {
    const rows = deriveParticipants(
      [participant(ALI, 'Ali', 1)],
      [
        entry(ALI, 'buy_in', 1000, 'cash', '2026-09-09T20:00:00.000Z'),
        entry(ALI, 'payout', 5000, null, '2026-09-09T20:05:00.000Z'),
      ],
    );
    expect(previewParticipants(rows)[0]).toMatchObject({ stack: 5000, payout: 5000 });
  });

  it('liefert null statt eines Absturzes, wenn die Vorbedingungen verletzt sind', () => {
    // Auszahlung ohne Bargeld in der Kasse (nur Listen-Buy-in) → computeSettlement wirft.
    const broken = deriveParticipants(
      [participant(ALI, 'Ali', 1)],
      [
        entry(ALI, 'buy_in', 5000, 'credit', '2026-09-09T20:00:00.000Z'),
        entry(ALI, 'cash_out', 6000, null, '2026-09-09T23:00:00.000Z'),
        entry(ALI, 'payout', 5000, null, '2026-09-09T23:01:00.000Z'),
      ],
    );
    expect(previewCashEntitlement(broken, ALI)).toBeNull();
  });

  it('liefert null für einen Spieler, der kein Teilnehmer ist', () => {
    expect(previewCashEntitlement(participants, GHOST)).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// 3. Fehlercode-Mapping (unabhängiger Scan der Migration)
// -----------------------------------------------------------------------------

function codesRaisedIn0002(): string[] {
  const sql = read('supabase/migrations/0002_functions_triggers.sql');
  return [...new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]))].sort();
}

function pgError(fields: Partial<PostgrestError>): PostgrestError {
  return {
    name: 'PostgrestError',
    message: '',
    details: '',
    hint: '',
    code: 'P0001',
    ...fields,
  } as PostgrestError;
}

describe('Fehlercode-Mapping ist vollständig und deutsch', () => {
  it('jeder Code aus 0002 hat eine Übersetzung', () => {
    const missing = codesRaisedIn0002().filter((code) => !isDbErrorCode(code));
    expect(missing).toEqual([]);
    expect(codesRaisedIn0002().length).toBeGreaterThanOrEqual(20);
  });

  it('übersetzt jeden Code in einen Satz ohne den Code selbst', () => {
    for (const code of codesRaisedIn0002()) {
      const translated = translateDbError(pgError({ message: code }));
      expect(translated, code).not.toBeNull();
      expect(translated?.message, code).not.toContain(code);
      expect(translated?.message, code).not.toMatch(/[a-z]_[a-z]/); // kein SQL-Bezeichner
    }
  });

  it('lässt keine rohe Postgres-Meldung durch (unbekannt → null → generisch)', () => {
    const raw = pgError({
      code: '22P02',
      message: 'invalid input syntax for type uuid: "abc"',
      details: 'Failing row contains (…)',
    });
    expect(translateDbError(raw)).toBeNull();

    const rlsDenied = pgError({ code: '42501', message: 'permission denied for table entries' });
    expect(translateDbError(rlsDenied)?.message).toBe(DB_ERROR_MESSAGES.FORBIDDEN);
  });

  it('erkennt den Code auch, wenn PostgREST ihn einbettet', () => {
    const wrapped = pgError({ message: 'ERROR: SESSION_CLOSED (SQLSTATE P0001)' });
    expect(translateDbError(wrapped)?.code).toBe('SESSION_CLOSED');
  });

  it('die drei Trigger-Codes des Kassen-Schutzes sind übersetzt', () => {
    for (const code of ['PAYOUT_EXCEEDS_CASHBOX', 'PAYOUT_EXCEEDS_STACK', 'STACK_BELOW_PAYOUT'] as const) {
      expect(DB_ERROR_MESSAGES[code].length).toBeGreaterThan(10);
    }
  });
});

// -----------------------------------------------------------------------------
// 4. Zod-Grenzen der Beträge
// -----------------------------------------------------------------------------

const base = { sessionId: CEM, playerId: ALI };

describe('Betrags-Schemata', () => {
  it('Buy-in: Integer-Cent > 0, höchstens 1.000.000', () => {
    expect(addBuyInSchema.safeParse({ ...base, amountCents: 1, payment: 'cash' }).success).toBe(true);
    expect(
      addBuyInSchema.safeParse({ ...base, amountCents: MAX_AMOUNT_CENTS, payment: 'cash' }).success,
    ).toBe(true);
    expect(
      addBuyInSchema.safeParse({ ...base, amountCents: MAX_AMOUNT_CENTS + 1, payment: 'cash' })
        .success,
    ).toBe(false);
    for (const bad of [0, -1, 10.5, Number.NaN, Number.POSITIVE_INFINITY, '100']) {
      expect(addBuyInSchema.safeParse({ ...base, amountCents: bad, payment: 'cash' }).success).toBe(
        false,
      );
    }
    expect(MAX_AMOUNT_CENTS).toBe(1_000_000);
  });

  it('Buy-in verlangt „cash“ oder „credit“', () => {
    expect(addBuyInSchema.safeParse({ ...base, amountCents: 100, payment: 'karte' }).success).toBe(
      false,
    );
    expect(addBuyInSchema.safeParse({ ...base, amountCents: 100 }).success).toBe(false);
  });

  it('Cash-out erlaubt 0, aber nichts Negatives', () => {
    expect(addCashOutSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(true);
    expect(addCashOutSchema.safeParse({ ...base, amountCents: -1 }).success).toBe(false);
    expect(addCashOutSchema.safeParse({ ...base, amountCents: 0.5 }).success).toBe(false);
  });

  it('Auszahlung: > 0 und gedeckelt', () => {
    expect(addPayoutSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
    expect(addPayoutSchema.safeParse({ ...base, amountCents: MAX_AMOUNT_CENTS + 1 }).success).toBe(
      false,
    );
  });

  it('jede Ablehnung nennt einen deutschen Grund', () => {
    const tooLarge = addBuyInSchema.safeParse({
      ...base,
      amountCents: MAX_AMOUNT_CENTS + 1,
      payment: 'cash',
    });
    expect(tooLarge.success).toBe(false);
    if (!tooLarge.success) {
      const message = tooLarge.error.issues[0].message;
      expect(message).toMatch(/zu groß/);
      expect(message).toContain('10.000,00');
    }

    const badId = addBuyInSchema.safeParse({ ...base, sessionId: 'abc', amountCents: 100, payment: 'cash' });
    expect(badId.success).toBe(false);
    if (!badId.success) expect(badId.error.issues[0].message).toBe('Ungültige Session.');
  });
});

// -----------------------------------------------------------------------------
// 5. Rollenwächter in allen acht Actions
// -----------------------------------------------------------------------------

const ENTRY_ACTIONS = [
  'addParticipant',
  'addParticipantByNewPlayer',
  'removeParticipant',
  'addBuyIn',
  'addCashOut',
  'updateCashOut',
  'addPayout',
  'deleteEntry',
] as const;

describe('src/actions/entries.ts — requireEditor vor jedem DB-Zugriff', () => {
  const source = read('src/actions/entries.ts');

  it('exportiert genau die acht Actions des Plans', () => {
    const exported = [...source.matchAll(/export async function (\w+)/g)].map((m) => m[1]).sort();
    expect(exported).toEqual([...ENTRY_ACTIONS].sort());
  });

  for (const action of ENTRY_ACTIONS) {
    it(`${action}: requireEditor steht vor parseInput und vor createClient`, () => {
      const start = source.indexOf(`export async function ${action}(`);
      expect(start, action).toBeGreaterThan(-1);
      const nextExport = source.indexOf('export async function ', start + 10);
      const body = source.slice(start, nextExport === -1 ? undefined : nextExport);

      const guard = body.indexOf('await requireEditor()');
      expect(guard, action).toBeGreaterThan(-1);

      const parse = body.indexOf('parseInput(');
      if (parse > -1) expect(guard, action).toBeLessThan(parse);

      const client = body.indexOf('createClient(');
      if (client > -1) expect(guard, action).toBeLessThan(client);
    });
  }

  it('die Helfer mit DB-Zugriff sind nicht exportiert (kein Weg um den Wächter herum)', () => {
    for (const helper of ['insertEntry', 'insertParticipant']) {
      expect(source).toContain(`async function ${helper}(`);
      expect(source).not.toContain(`export async function ${helper}(`);
    }
  });

  it('ist eine Server-Datei', () => {
    expect(source.trimStart().startsWith("'use server'")).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 6. Realtime-Hook und Client-Komponenten
// -----------------------------------------------------------------------------

describe('useSessionRealtime', () => {
  const source = read('src/components/sessions/useSessionRealtime.ts');

  it('abonniert genau einmal je Session-Id (Effekt hängt nur an sessionId)', () => {
    expect(source).toContain('}, [sessionId]);');
    expect((source.match(/supabase\.channel\(/g) ?? []).length).toBe(1);
  });

  it('entfernt den Kanal im Cleanup', () => {
    const cleanup = source.slice(source.lastIndexOf('return () => {'));
    expect(cleanup).toContain('removeChannel(channel)');
    expect(cleanup).toContain('cancelled = true');
  });

  it('versucht genau einen Reconnect', () => {
    expect(source).toContain('let retried = false');
    expect((source.match(/retried = true/g) ?? []).length).toBe(1);
  });

  it('zeigt den Hinweis nach 10 Sekunden', () => {
    expect(source).toMatch(/DISCONNECT_HINT_MS\s*=\s*10_000/);
    expect(source).toContain("setStatus('disconnected')");
  });

  it('greift nur lesend über channel() zu, nie auf eine Tabelle', () => {
    expect(source).not.toMatch(/\.from\(|\.rpc\(/);
  });
});

describe('Client-Komponenten schreiben nie direkt in die Datenbank', () => {
  const clientFiles = [
    'src/components/sessions/SessionDetailClient.tsx',
    'src/components/sessions/EntrySheets.tsx',
    'src/components/sessions/ParticipantCard.tsx',
    'src/components/sessions/HistoryList.tsx',
    'src/components/sessions/AmountField.tsx',
    'src/components/sessions/useSessionRealtime.ts',
  ];

  for (const file of clientFiles) {
    it(`${file}: kein .from(/.rpc(`, () => {
      const source = read(file);
      expect(source.trimStart().startsWith("'use client'")).toBe(true);
      expect(source).not.toMatch(/\.from\(|\.rpc\(/);
    });
  }

  it('die Detailseite sperrt Aktionen für Viewer und für abgeschlossene Sessions', () => {
    const source = read('src/components/sessions/SessionDetailClient.tsx');
    expect(source).toContain("const isOpen = session.status === 'open'");
    expect(source).toContain('const mayAct = canEdit && isOpen');
    // Jeder Aktionsweg hängt an mayAct: Karten, „Teilnehmer hinzufügen“, Verlauf-Löschen.
    expect(source).toContain('interactive={mayAct}');
    expect(source).toContain('canEdit={mayAct}');
    expect(source).toMatch(/mayAct \? \(\s*<Button/);
  });
});
