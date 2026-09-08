/**
 * WP1 Runde 2 — die neuen Prüfungen in `close_session` (F1 + F2).
 *
 * Die Datenbank ist weiterhin nicht eingespielt, es gibt weder psql noch Docker.
 * Diese Datei bildet deshalb den Annahme-Test von `close_session`
 * (`supabase/migrations/0002_functions_triggers.sql`, Abschnitt „per player“ und
 * „invariants of docs/SETTLEMENT.md“) Zeile für Zeile in TypeScript nach und
 * beantwortet damit die zwei Fragen, die ohne Server sonst offen bleiben:
 *
 *   1. Weist die RPC eine **gültige** Abrechnung fälschlich ab? Das wäre der
 *      teure Fehler: der Tisch könnte nicht abrechnen. Geprüft gegen alle
 *      Pflicht-Testfälle aus docs/SETTLEMENT.md und gegen zufällige Sessions.
 *   2. Fangen die neuen Prüfungen die Angriffe aus Gabys Finding F2 wirklich?
 *
 * Was hier steht, ist eine *Nachbildung*: sie beweist die Logik, nicht die
 * SQL-Syntax. Der erste echte Lauf im SQL-Editor bleibt der eigentliche Test
 * (siehe „Nicht verifiziert“ in qa/reports/WP1-gaby.md).
 *
 * Zusätzlich friert der letzte Abschnitt die Nacharbeit aus Runde 2 im SQL ein
 * (Spalte, Trigger, Policy, Revokes) — die Zählwerte in
 * tests/gaby/wp1-schema.gaby.test.ts sind nach F3/F4 gestiegen, hier steht
 * dafür namentlich, *was* dazugekommen sein muss.
 *
 * Diese Tests gehören Gaby: nie löschen oder abschwächen (CLAUDE.md).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeSettlement } from '@/lib/settlement';
import type {
  SettlementParticipant,
  SettlementResult,
  SettlementLine,
} from '@/lib/settlement/types';

const functionsSql = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/0002_functions_triggers.sql', import.meta.url)),
  'utf8',
);
const schemaSql = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/0001_schema.sql', import.meta.url)),
  'utf8',
);
const rlsSql = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/0003_rls.sql', import.meta.url)),
  'utf8',
);

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

type Row = {
  playerId: string;
  cashIn?: number;
  creditIn?: number;
  stack?: number;
  payout?: number;
};

function participants(rows: readonly Row[]): SettlementParticipant[] {
  return rows.map((row, index) => ({
    playerId: row.playerId,
    name: row.playerId,
    position: index,
    cashIn: row.cashIn ?? 0,
    creditIn: row.creditIn ?? 0,
    stack: row.stack ?? 0,
    payout: row.payout ?? 0,
  }));
}

function clone(result: SettlementResult): SettlementResult {
  return {
    ...result,
    lines: result.lines.map((line) => ({ ...line })),
    transfers: result.transfers.map((transfer) => ({ ...transfer })),
  };
}

// ---------------------------------------------------------------------------
// Nachbildung der Annahmebedingung von close_session
// ---------------------------------------------------------------------------

/**
 * Liefert die Fehler, die `close_session` für dieses Paar aus Session-Daten und
 * Client-Abrechnung werfen würde. Leeres Array = die RPC nimmt sie an.
 *
 * Die Aggregation `agg` entspricht der serverseitigen Summierung über `entries`
 * (`0002`, „per player: recompute and compare“) — der Server glaubt dem Client
 * keine einzige Zahl, deshalb wird sie hier aus der Eingabe gerechnet.
 */
function closeSessionVerdict(
  input: readonly SettlementParticipant[],
  payload: SettlementResult,
): string[] {
  const problems: string[] = [];
  const agg = new Map(input.map((row) => [row.playerId, row]));

  const cash = sum(input.map((row) => row.cashIn));
  const credit = sum(input.map((row) => row.creditIn));
  const stack = sum(input.map((row) => row.stack));
  const payout = sum(input.map((row) => row.payout));
  const buyIn = cash + credit;
  const discrepancy = stack - buyIn;

  // ---- Kopfzahlen: serverseitig gerechnet, gegen den Client verglichen -----
  if (
    payload.totalBuyIn !== buyIn ||
    payload.totalStack !== stack ||
    payload.discrepancy !== discrepancy ||
    payload.cashBoxStart !== cash ||
    payload.cashBoxAfterPayouts !== cash - payout ||
    !Number.isInteger(payload.unallocatedCash) ||
    payload.unallocatedCash < 0 ||
    !Number.isInteger(payload.uncoveredClaims) ||
    payload.uncoveredClaims < 0 ||
    !Number.isInteger(payload.uncoveredDebts) ||
    payload.uncoveredDebts < 0
  ) {
    problems.push('SETTLEMENT_MISMATCH:header');
  }

  // ---- genau eine Zeile je Teilnehmer, keine Duplikate --------------------
  const distinct = new Set(payload.lines.map((line) => line.playerId));
  if (distinct.size !== input.length || distinct.size !== payload.lines.length) {
    problems.push('SETTLEMENT_MISMATCH:lines');
  }

  // ---- jede Zeile gegen die Aggregation ------------------------------------
  for (const line of payload.lines) {
    const row = agg.get(line.playerId);
    if (row === undefined) {
      problems.push('SETTLEMENT_MISMATCH:unknown-player');
      continue;
    }
    const claim = row.stack - row.payout;
    if (
      line.cashIn !== row.cashIn ||
      line.creditIn !== row.creditIn ||
      line.stack !== row.stack ||
      line.payout !== row.payout ||
      line.isCashPlayer !== row.cashIn > 0 ||
      line.claim !== claim ||
      line.netResult !== row.stack - row.cashIn - row.creditIn ||
      line.cashTier1 < 0 ||
      line.cashTier2 < 0 ||
      line.cashTier3 < 0 ||
      line.cashFromBox !== line.cashTier1 + line.cashTier2 + line.cashTier3 ||
      line.cashFromBox > claim ||
      line.residual !== claim - line.cashFromBox - row.creditIn
    ) {
      problems.push(`SETTLEMENT_MISMATCH:line ${line.playerId}`);
    }
  }

  // ---- Invarianten aus docs/SETTLEMENT.md ---------------------------------
  const fromBox = sum(payload.lines.map((line) => line.cashFromBox));
  const posResidual = sum(payload.lines.map((line) => Math.max(line.residual, 0)));
  const negResidual = sum(payload.lines.map((line) => Math.max(-line.residual, 0)));
  const tier3 = sum(payload.lines.map((line) => line.cashTier3));
  const transfers = sum(payload.transfers.map((transfer) => transfer.amount));

  // Invariante 2 – die Kasse geht auf
  if (fromBox + payload.unallocatedCash !== cash - payout) {
    problems.push('SETTLEMENT_INVARIANT:cashbox');
  }
  // Schritt 5 – was der Greedy nicht verteilen konnte, wird gemeldet
  if (transfers + payload.uncoveredClaims !== posResidual) {
    problems.push('SETTLEMENT_INVARIANT:claims');
  }
  if (transfers + payload.uncoveredDebts !== negResidual) {
    problems.push('SETTLEMENT_INVARIANT:debts');
  }
  if (transfers !== Math.min(posResidual, negResidual)) {
    problems.push('SETTLEMENT_INVARIANT:transfer-total');
  }
  // Schritt 5 – Richtung: Schuldner → Gläubiger, beide Zeilen dieser Abrechnung
  const byId = new Map(payload.lines.map((line) => [line.playerId, line]));
  for (const transfer of payload.transfers) {
    const from = byId.get(transfer.fromPlayerId);
    const to = byId.get(transfer.toPlayerId);
    if (
      !Number.isInteger(transfer.amount) ||
      transfer.amount <= 0 ||
      from === undefined ||
      to === undefined ||
      from.residual >= 0 ||
      to.residual <= 0
    ) {
      problems.push('SETTLEMENT_INVARIANT:transfer-direction');
    }
  }
  // Invariante 6 – „Bargeld zuerst an Bar-Zahler“
  if (
    tier3 > 0 &&
    payload.lines.some((line) => line.isCashPlayer && line.cashFromBox !== line.claim)
  ) {
    problems.push('SETTLEMENT_INVARIANT:cash-first');
  }
  // Schritt 5 – die drei Gleichungen je nach Vorzeichen der Differenz
  if (discrepancy === 0) {
    if (
      payload.unallocatedCash !== 0 ||
      payload.uncoveredClaims !== 0 ||
      payload.uncoveredDebts !== 0
    ) {
      problems.push('SETTLEMENT_INVARIANT:zero-discrepancy');
    }
  } else if (discrepancy < 0) {
    if (
      payload.uncoveredClaims !== 0 ||
      payload.unallocatedCash + payload.uncoveredDebts !== -discrepancy
    ) {
      problems.push('SETTLEMENT_INVARIANT:negative-discrepancy');
    }
  } else {
    if (
      payload.unallocatedCash !== 0 ||
      payload.uncoveredDebts !== 0 ||
      payload.uncoveredClaims !== discrepancy
    ) {
      problems.push('SETTLEMENT_INVARIANT:positive-discrepancy');
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// 1. Kein Fehlalarm: jede gültige Abrechnung geht durch
// ---------------------------------------------------------------------------

/** Die Pflicht-Testfälle aus docs/SETTLEMENT.md, deckt alle drei Vorzeichen ab. */
const MANDATORY_CASES: readonly (readonly [string, Row[]])[] = [
  [
    'TV1',
    [
      { playerId: 'A', cashIn: 10000, stack: 25000 },
      { playerId: 'B', cashIn: 10000, stack: 15000 },
      { playerId: 'C', cashIn: 10000, stack: 10000 },
      { playerId: 'D', cashIn: 10000 },
      { playerId: 'E', cashIn: 10000 },
    ],
  ],
  [
    'TV2',
    [
      { playerId: 'Ali', cashIn: 10000, stack: 20000 },
      { playerId: 'Ben', cashIn: 10000, stack: 4000 },
      { playerId: 'Can', creditIn: 10000, stack: 6000 },
    ],
  ],
  [
    'TV3',
    [
      { playerId: 'Ali', cashIn: 10000, stack: 25000 },
      { playerId: 'Ben', cashIn: 10000, stack: 5000 },
      { playerId: 'Can', creditIn: 10000 },
      { playerId: 'Dai', creditIn: 20000, stack: 20000 },
    ],
  ],
  [
    'TV4',
    [
      { playerId: 'A', cashIn: 10000, stack: 30000 },
      { playerId: 'B', cashIn: 10000 },
      { playerId: 'C', creditIn: 10000, stack: 5000 },
      { playerId: 'D', creditIn: 10000, stack: 5000 },
    ],
  ],
  [
    'TV5',
    [
      { playerId: 'A', cashIn: 10000, stack: 15000, payout: 15000 },
      { playerId: 'B', cashIn: 10000, stack: 5000 },
      { playerId: 'C', creditIn: 10000, stack: 10000 },
    ],
  ],
  [
    'TV6',
    [
      { playerId: 'A', cashIn: 10000, stack: 10000 },
      { playerId: 'B', creditIn: 10000, stack: 10000, payout: 10000 },
    ],
  ],
  [
    'TV7',
    [
      { playerId: 'A', cashIn: 10000, creditIn: 10000, stack: 40000 },
      { playerId: 'B', cashIn: 10000 },
      { playerId: 'C', creditIn: 10000 },
    ],
  ],
  [
    'TV8',
    [
      { playerId: 'A', cashIn: 10000, stack: 20000 },
      { playerId: 'B', cashIn: 10000, stack: 20000 },
      { playerId: 'C', cashIn: 10000, stack: 20000 },
      { playerId: 'D', cashIn: 10000 },
      { playerId: 'E', cashIn: 10000 },
      { playerId: 'F', creditIn: 10000 },
    ],
  ],
  [
    'TV9 (discrepancy < 0)',
    [
      { playerId: 'A', cashIn: 10000, stack: 9000 },
      { playerId: 'B', cashIn: 10000, stack: 10000 },
    ],
  ],
  [
    'TV9b (discrepancy < 0, nur Liste)',
    [
      { playerId: 'A', creditIn: 10000 },
      { playerId: 'B', creditIn: 10000, stack: 10000 },
    ],
  ],
  [
    'TV10 (discrepancy > 0)',
    [
      { playerId: 'A', cashIn: 10000, stack: 12000 },
      { playerId: 'B', creditIn: 10000, stack: 9000 },
    ],
  ],
  ['TV11 – ein Spieler', [{ playerId: 'A', cashIn: 10000, stack: 10000 }]],
  ['TV11 – alles null', [{ playerId: 'A' }, { playerId: 'B' }]],
];

describe('close_session nimmt jede gültige Abrechnung an (kein Fehlalarm)', () => {
  for (const [label, rows] of MANDATORY_CASES) {
    it(`${label}`, () => {
      const input = participants(rows);
      const result = computeSettlement(input);
      expect(closeSessionVerdict(input, result)).toEqual([]);
    });
  }

  /**
   * Zufällige Sessions unter den Vorbedingungen aus docs/SETTLEMENT.md
   * („Eingabe“): `payout <= stack` und `Σ payout <= Σ cashIn`. Stacks sind frei,
   * es entstehen also alle drei Vorzeichen der Differenz.
   */
  const sessionArbitrary = fc
    .integer({ min: 1, max: 9 })
    .chain((size) =>
      fc.record({
        cash: fc.array(fc.integer({ min: 0, max: 30000 }), { minLength: size, maxLength: size }),
        credit: fc.array(fc.integer({ min: 0, max: 30000 }), { minLength: size, maxLength: size }),
        stack: fc.array(fc.integer({ min: 0, max: 60000 }), { minLength: size, maxLength: size }),
        payoutSeed: fc.array(fc.integer({ min: 0, max: 4_000_000 }), {
          minLength: size,
          maxLength: size,
        }),
        payoutOrder: fc.array(fc.integer({ min: 0, max: 1_000_000 }), {
          minLength: size,
          maxLength: size,
        }),
      }),
    )
    .map(({ cash, credit, stack, payoutSeed, payoutOrder }) => {
      let boxLeft = sum(cash);
      const payout = new Array<number>(cash.length).fill(0);
      const order = cash.map((_, index) => index).sort((a, b) => payoutOrder[a] - payoutOrder[b]);
      for (const index of order) {
        const wanted = stack[index] === 0 ? 0 : payoutSeed[index] % (stack[index] + 1);
        const granted = Math.min(wanted, boxLeft);
        payout[index] = granted;
        boxLeft -= granted;
      }
      return participants(
        cash.map((cashIn, index) => ({
          playerId: `p${index}`,
          cashIn,
          creditIn: credit[index],
          stack: stack[index],
          payout: payout[index],
        })),
      );
    });

  it('nimmt jede zufällig erzeugte gültige Abrechnung an', () => {
    fc.assert(
      fc.property(sessionArbitrary, (input) => {
        const result = computeSettlement(input);
        expect(closeSessionVerdict(input, result)).toEqual([]);
      }),
      { numRuns: 3000 },
    );
  });

  it('deckt mit den Pflichtfällen alle drei Vorzeichen der Differenz ab', () => {
    // Zufällige Stacks treffen die exakte Null praktisch nie; die drei
    // Vorzeichen kommen deshalb aus den Pflichtfällen (TV1 = 0, TV9/TV9b < 0,
    // TV10 > 0), und die Zufallsläufe decken zusätzlich beide Randseiten ab.
    const signs = new Set(
      MANDATORY_CASES.map(([, rows]) => Math.sign(computeSettlement(participants(rows)).discrepancy)),
    );
    expect([...signs].sort()).toEqual([-1, 0, 1]);

    const random = new Set<number>();
    fc.assert(
      fc.property(sessionArbitrary, (input) => {
        random.add(Math.sign(computeSettlement(input).discrepancy));
      }),
      { numRuns: 500 },
    );
    expect(random.has(-1) && random.has(1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Die Angriffe aus Finding F2 / F1 werden abgewiesen
// ---------------------------------------------------------------------------

describe('close_session weist manipulierte Abrechnungen ab (F1, F2)', () => {
  const tv2 = participants([
    { playerId: 'Ali', cashIn: 10000, stack: 20000 },
    { playerId: 'Ben', cashIn: 10000, stack: 4000 },
    { playerId: 'Can', creditIn: 10000, stack: 6000 },
  ]);

  function line(result: SettlementResult, playerId: string): SettlementLine {
    const found = result.lines.find((entry) => entry.playerId === playerId);
    if (found === undefined) throw new Error(`Zeile ${playerId} fehlt`);
    return found;
  }

  it('Kernregel: Bargeld an den Listen-Spieler, während ein Bar-Zahler offen ist', () => {
    // Gabys Reproduktion aus F1/F2: Ali 100, Ben 40, Can 60 statt Ali 160.
    const payload = clone(computeSettlement(tv2));
    const ali = line(payload, 'Ali');
    const can = line(payload, 'Can');
    ali.cashTier2 -= 6000;
    ali.cashFromBox -= 6000;
    ali.residual += 6000;
    can.cashTier3 += 6000;
    can.cashFromBox += 6000;
    can.residual -= 6000;
    payload.transfers = [{ fromPlayerId: 'Can', toPlayerId: 'Ali', amount: 10000 }];

    // Summen und Kasseninvariante stimmen weiterhin – nur die Kernregel nicht.
    expect(closeSessionVerdict(tv2, payload)).toEqual(['SETTLEMENT_INVARIANT:cash-first']);
  });

  it('Richtung: Gläubiger überweist an Schuldner', () => {
    const payload = clone(computeSettlement(tv2));
    payload.transfers = payload.transfers.map((transfer) => ({
      fromPlayerId: transfer.toPlayerId,
      toPlayerId: transfer.fromPlayerId,
      amount: transfer.amount,
    }));
    expect(closeSessionVerdict(tv2, payload)).toContain('SETTLEMENT_INVARIANT:transfer-direction');
  });

  it('Empfänger ist gar kein Spieler dieser Abrechnung (left join darf nicht durchlassen)', () => {
    const payload = clone(computeSettlement(tv2));
    payload.transfers = [
      { fromPlayerId: 'Can', toPlayerId: 'Fremder', amount: payload.transfers[0].amount },
    ];
    expect(closeSessionVerdict(tv2, payload)).toContain('SETTLEMENT_INVARIANT:transfer-direction');
  });

  it('Überweisung mit Betrag 0 oder negativ', () => {
    for (const amount of [0, -100]) {
      const payload = clone(computeSettlement(tv2));
      payload.transfers = [{ fromPlayerId: 'Can', toPlayerId: 'Ali', amount }];
      expect(closeSessionVerdict(tv2, payload).length).toBeGreaterThan(0);
    }
  });

  it('Überweisungen unterschlagen, obwohl beide Seiten offen sind', () => {
    const payload = clone(computeSettlement(tv2));
    payload.transfers = [];
    payload.uncoveredClaims = 4000;
    payload.uncoveredDebts = 4000;
    // Σ transfers muss min(Σ pos, Σ neg) sein – 0 ist es hier nicht.
    expect(closeSessionVerdict(tv2, payload)).toContain('SETTLEMENT_INVARIANT:transfer-total');
  });

  it('uncoveredDebts wird bei fehlenden Chips verschwiegen (TV9b)', () => {
    const tv9b = participants([
      { playerId: 'A', creditIn: 10000 },
      { playerId: 'B', creditIn: 10000, stack: 10000 },
    ]);
    const honest = computeSettlement(tv9b);
    expect(honest.discrepancy).toBe(-10000);
    expect(honest.uncoveredDebts).toBe(10000);
    expect(closeSessionVerdict(tv9b, honest)).toEqual([]);

    const payload = clone(honest);
    payload.uncoveredDebts = 0;
    expect(closeSessionVerdict(tv9b, payload)).toEqual([
      'SETTLEMENT_INVARIANT:debts',
      'SETTLEMENT_INVARIANT:negative-discrepancy',
    ]);
  });

  it('uncoveredClaims wird als unallocatedCash getarnt (TV10)', () => {
    const tv10 = participants([
      { playerId: 'A', cashIn: 10000, stack: 12000 },
      { playerId: 'B', creditIn: 10000, stack: 9000 },
    ]);
    const payload = clone(computeSettlement(tv10));
    payload.uncoveredClaims = 0;
    payload.unallocatedCash = 1000;
    expect(closeSessionVerdict(tv10, payload).length).toBeGreaterThan(0);
  });

  it('bei sauberer Differenz 0 darf kein Rest gemeldet werden', () => {
    const payload = clone(computeSettlement(tv2));
    payload.uncoveredDebts = 500;
    expect(closeSessionVerdict(tv2, payload).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Was auch nach Runde 2 noch durchgeht — bewusst offen (Bericht F2)
// ---------------------------------------------------------------------------

describe('bekannte Restlücken von close_session (dokumentiert, nicht behoben)', () => {
  it('ein Schuldner darf mehr überweisen, als er schuldet, solange die Summen stimmen', () => {
    // A und B schulden je 100, C und D haben je 100 gut. Der Greedy paart
    // A→C und B→D. Diese Abrechnung lässt A allein für beide zahlen.
    const input = participants([
      { playerId: 'A', creditIn: 20000, stack: 10000 },
      { playerId: 'B', creditIn: 20000, stack: 10000 },
      { playerId: 'C', creditIn: 10000, stack: 20000 },
      { playerId: 'D', creditIn: 10000, stack: 20000 },
    ]);
    const honest = computeSettlement(input);
    expect(honest.discrepancy).toBe(0);
    expect(closeSessionVerdict(input, honest)).toEqual([]);

    const payload = clone(honest);
    payload.transfers = [
      { fromPlayerId: 'A', toPlayerId: 'C', amount: 10000 },
      { fromPlayerId: 'A', toPlayerId: 'D', amount: 10000 },
    ];
    // Richtung, Summe und min() stimmen – die Deckung je Spieler prüft niemand.
    expect(closeSessionVerdict(input, payload)).toEqual([]);
  });

  it('Stufe 1 darf einseitig statt anteilig bedient werden (Invariante 5)', () => {
    // Die Kasse reicht nicht für beide Bar-Zahler: B hat mehr entnommen, als er
    // selbst bar eingezahlt hat. Richtig wäre die anteilige Kürzung (je 50);
    // diese Abrechnung gibt A alles und schickt B mit einem Schuldschein nach
    // Hause. Das ist die einzige der offenen Lücken, die echtes Risiko
    // verschiebt — sie ist nur mit einem manipulierten Client erreichbar.
    const input = participants([
      { playerId: 'A', cashIn: 10000, stack: 10000 },
      { playerId: 'B', cashIn: 10000, stack: 10000 },
      { playerId: 'C', creditIn: 10000, stack: 10000, payout: 10000 },
    ]);
    const honest = computeSettlement(input);
    expect(honest.lines.map((entry) => entry.cashFromBox)).toEqual([5000, 5000, 0]);
    expect(closeSessionVerdict(input, honest)).toEqual([]);

    const payload = clone(honest);
    const [a, b] = payload.lines;
    a.cashTier1 = 10000;
    a.cashFromBox = 10000;
    a.residual = 0;
    b.cashTier1 = 0;
    b.cashFromBox = 0;
    b.residual = 10000;
    payload.transfers = [{ fromPlayerId: 'C', toPlayerId: 'B', amount: 10000 }];
    expect(closeSessionVerdict(input, payload)).toEqual([]);
  });

  it('ein Bar-Zahler darf seinen Anspruch aus Stufe 3 statt Stufe 1/2 bekommen', () => {
    const input = participants([
      { playerId: 'A', cashIn: 10000, stack: 10000 },
      { playerId: 'B', creditIn: 10000, stack: 10000 },
    ]);
    const payload = clone(computeSettlement(input));
    const a = payload.lines.find((entry) => entry.playerId === 'A');
    if (a === undefined) throw new Error('Zeile A fehlt');
    a.cashTier3 = a.cashTier1 + a.cashTier2;
    a.cashTier1 = 0;
    a.cashTier2 = 0;
    // cashFromBox bleibt gleich, also fließt kein anderes Geld – reine
    // Falschbeschriftung der Stufe, die WP6 anzeigen würde.
    expect(closeSessionVerdict(input, payload)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Die Nacharbeit aus Runde 2 im SQL einfrieren
// ---------------------------------------------------------------------------

describe('Runde 2 im SQL eingefroren', () => {
  it('F1: settlements speichert uncovered_debts_cents als integer not null', () => {
    expect(schemaSql).toMatch(/uncovered_debts_cents\s+integer not null/);
  });

  it('F1: close_session liest, prüft und speichert uncoveredDebts', () => {
    expect(functionsSql).toContain("(p_settlement ->> 'uncoveredDebts')::integer");
    expect(functionsSql).toContain('uncovered_debts_cents');
    expect(functionsSql).toContain('v_unallocated + v_uncov_debts <> -v_discrepancy');
    expect(functionsSql).toContain('v_uncov_claims <> v_discrepancy');
  });

  it('F2: Richtung, Summe und „Bar zuerst“ werden geprüft', () => {
    expect(functionsSql).toContain('lf."residual" >= 0 or lt."residual" <= 0');
    expect(functionsSql).toContain('lf."playerId" is null or lt."playerId" is null');
    expect(functionsSql).toContain('v_transfers <> least(v_pos_residual, v_neg_residual)');
    expect(functionsSql).toContain('l."isCashPlayer" and l."cashFromBox" is distinct from l."claim"');
  });

  it('F3: validate_entry sperrt session_id, player_id und type gegen UPDATE', () => {
    expect(functionsSql).toMatch(
      /\(new\.session_id, new\.player_id, new\.type\)\s*\n?\s*is distinct from \(old\.session_id, old\.player_id, old\.type\)/,
    );
    expect(functionsSql).toContain("raise exception 'ENTRY_IMMUTABLE_KEYS'");
  });

  it('F4: sechs Spalten mit default auth.uid() und fünf stamp_*-Trigger', () => {
    const defaults = schemaSql.match(/uuid default auth\.uid\(\) references public\.app_users/g);
    expect(defaults?.length).toBe(6);
    for (const trigger of [
      'stamp_players',
      'stamp_sessions',
      'stamp_session_players',
      'stamp_entries',
      'stamp_settings',
    ]) {
      expect(functionsSql).toContain(`create trigger ${trigger}`);
      expect(functionsSql).toContain(`drop trigger if exists ${trigger} on public.`);
    }
    // Der Client-Wert wird überschrieben, nicht nur ergänzt (coalesce wäre zu
    // schwach: dann bliebe ein mitgeschickter fremder Nutzer stehen).
    const body = /create or replace function public\.stamp_actor\(\)([\s\S]*?)\$\$;/.exec(
      functionsSql,
    )?.[1];
    expect(body).toContain('new.created_by := auth.uid();');
    expect(body).toContain('new.added_by := auth.uid();');
    expect(body).toContain('new.updated_by := auth.uid();');
    expect(body).not.toMatch(/coalesce\(new\.(created_by|added_by|updated_by)/);
    // SQL-Editor-/Seed-Pfad: ohne Login bleibt die Zeile schreibbar.
    expect(body).toContain('if auth.uid() is null then');
    // Keine der gestempelten Spalten ist "not null" – sonst bräche genau
    // dieser Pfad.
    expect(schemaSql).not.toMatch(/(created_by|added_by|updated_by|computed_by)\s+uuid[^,\n]*not null/);
  });

  it('F5: reopen_session setzt closed_at, closed_by und discrepancy_cents zurück', () => {
    const body = /create function public\.reopen_session\(([\s\S]*?)\n\$\$;/.exec(
      functionsSql,
    )?.[1];
    expect(body).toContain('closed_at         = null');
    expect(body).toContain('closed_by         = null');
    expect(body).toContain('discrepancy_cents = null');
  });

  it('F6: sessions_insert verbietet Abschlussdaten in einer neuen Session', () => {
    const start = rlsSql.indexOf('create policy sessions_insert on public.sessions');
    expect(start).toBeGreaterThan(-1);
    const policy = rlsSql.slice(start, rlsSql.indexOf('drop policy', start));
    for (const column of [
      'closed_at',
      'closed_by',
      'discrepancy_cents',
      'close_note',
      'reopened_at',
      'reopened_by',
    ]) {
      expect(policy).toContain(`${column} is null`);
    }
  });

  it('F9: alle neun Trigger-Funktionen verlieren das Default-execute', () => {
    for (const fn of [
      'handle_new_auth_user',
      'protect_last_admin',
      'protect_app_user_columns',
      'stamp_actor',
      'touch_updated_at',
      'audit_row_change',
      'validate_entry',
      'validate_session_update',
      'validate_session_player_delete',
    ]) {
      expect(functionsSql).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\(\\)\\s+from public, anon, authenticated;`),
      );
    }
  });
});
