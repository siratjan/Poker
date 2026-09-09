/**
 * WP6 — Abschluss, Wieder-Öffnen, Abrechnungs-Anzeige (Gabys Prüfung).
 *
 * Vier Fragen, die für echtes Geld entscheidend sind:
 *
 *   1. Zeigt die abgeschlossene Session wirklich die **gespeicherten** Zahlen,
 *      auch wenn diese von einer Neuberechnung abweichen? (manipuliertes Fixture)
 *   2. Stimmt der Share-Text Zeichen für Zeichen mit der Handrechnung aus
 *      docs/SETTLEMENT.md (TV2, TV4)?
 *   3. Zeigt `SettlementView` die Differenz-Hinweise aus TV8/TV9/TV9b/TV10 —
 *      bei TV9b beide (`unallocatedCash` **und** `uncoveredDebts`)?
 *   4. Kommt eine manipulierte Abrechnung an `verifySettlement` vorbei? Diese
 *      Funktion ist laut Testauftrag WP6 die einzige Verteidigung für
 *      Invariante 5 und für die Deckung je Schuldner — genau die zwei Lücken,
 *      die tests/gaby/wp1-close-session.gaby.test.ts als offen dokumentiert.
 *
 * Erwartungswerte stehen hier als Literale und sind von Hand aus
 * docs/SETTLEMENT.md gerechnet, nicht aus dem Code übernommen.
 *
 * Diese Tests gehören Gaby: nie löschen oder abschwächen (CLAUDE.md).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { computeSettlement } from '@/lib/settlement';
import { buildShareText } from '@/lib/settlement/shareText';
import { fromStoredRows, toStoredRows } from '@/lib/settlement/toPersist';
import type { FrozenSettlement, SettlementParticipant } from '@/lib/settlement/types';
import { verifySettlement } from '@/lib/settlement/verify';
import { SettlementView } from '@/components/settlement/SettlementView';

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

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

function namesOf(rows: readonly Row[]): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.playerId, row.playerId]));
}

function clone(result: FrozenSettlement): FrozenSettlement {
  return {
    ...result,
    lines: result.lines.map((line) => ({ ...line })),
    transfers: result.transfers.map((transfer) => ({ ...transfer })),
  };
}

/** Der sichtbare Text der Komponente, ohne Markup und mit klaren Trennern. */
function renderText(settlement: FrozenSettlement, names: Record<string, string>): string {
  const html = renderToStaticMarkup(
    createElement(SettlementView, { settlement, names }),
  );
  return html
    .replace(/<[^>]+>/g, ' | ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;| /g, ' ')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/[ \t]+/g, ' ');
}

const TV2_ROWS: Row[] = [
  { playerId: 'Ali', cashIn: 10000, stack: 20000 },
  { playerId: 'Ben', cashIn: 10000, stack: 4000 },
  { playerId: 'Can', creditIn: 10000, stack: 6000 },
];

const TV4_ROWS: Row[] = [
  { playerId: 'A', cashIn: 10000, stack: 30000 },
  { playerId: 'B', cashIn: 10000 },
  { playerId: 'C', creditIn: 10000, stack: 5000 },
  { playerId: 'D', creditIn: 10000, stack: 5000 },
];

const TV8_ROWS: Row[] = [
  { playerId: 'A', cashIn: 10000, stack: 20000 },
  { playerId: 'B', cashIn: 10000, stack: 20000 },
  { playerId: 'C', cashIn: 10000, stack: 20000 },
  { playerId: 'D', cashIn: 10000 },
  { playerId: 'E', cashIn: 10000 },
  { playerId: 'F', creditIn: 10000 },
];

const TV9_ROWS: Row[] = [
  { playerId: 'A', cashIn: 10000, stack: 9000 },
  { playerId: 'B', cashIn: 10000, stack: 10000 },
];

const TV9B_ROWS: Row[] = [
  { playerId: 'A', creditIn: 10000 },
  { playerId: 'B', creditIn: 10000, stack: 10000 },
];

const TV10_ROWS: Row[] = [
  { playerId: 'A', cashIn: 10000, stack: 12000 },
  { playerId: 'B', creditIn: 10000, stack: 9000 },
];

// ---------------------------------------------------------------------------
// 1. Gespeicherte Werte statt Neuberechnung
// ---------------------------------------------------------------------------

describe('die abgeschlossene Ansicht zeigt gespeicherte Werte, nie eine Neuberechnung', () => {
  it('SettlementView und ClosedSessionSection rufen computeSettlement nicht auf', () => {
    for (const file of [
      '../../src/components/settlement/SettlementView.tsx',
      '../../src/components/sessions/ClosedSessionSection.tsx',
      '../../src/components/settlement/CopySettlementButton.tsx',
      '../../src/lib/settlement/shareText.ts',
      '../../src/lib/queries/sessionDetail.ts',
    ]) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      expect(source, file).not.toMatch(/computeSettlement/);
      expect(source, file).not.toMatch(/\bdistribute\b/);
    }
  });

  it('ein manipuliertes Fixture wird unverändert angezeigt (die Anzeige korrigiert nichts)', () => {
    const honest = computeSettlement(participants(TV2_ROWS));
    const stored = toStoredRows(honest, 'session-1', new Map());

    // Jemand hat in der Datenbank an den eingefrorenen Zeilen gedreht:
    // Ali bekommt statt 160,00 € nur noch 111,11 €, Can schuldet statt
    // 40,00 € plötzlich 12,34 €. Eine Neuberechnung aus cashIn/stack/payout
    // käme weiterhin auf 160,00 € bzw. 40,00 €.
    const ali = stored.lines.find((line) => line.player_id === 'Ali');
    if (ali === undefined) throw new Error('Zeile Ali fehlt');
    ali.cash_from_box_cents = 11111;
    ali.cash_tier2_cents = 1111;
    stored.transfers[0].amount_cents = 1234;
    stored.settlement.unallocated_cash_cents = 4889;

    const shown = fromStoredRows(stored);
    expect(shown.lines.find((line) => line.playerId === 'Ali')?.cashFromBox).toBe(11111);
    expect(shown.transfers[0].amount).toBe(1234);

    const text = renderText(shown, namesOf(TV2_ROWS));
    expect(text).toContain('111,11 € bar');
    expect(text).toContain('12,34 €');
    // Die ehrlichen Zahlen dürfen nirgends auftauchen — sonst rechnet jemand nach.
    expect(text).not.toContain('160,00 €');
    expect(text).toContain('Bleibt in der Kasse: 48,89 €');

    // Gegenprobe: genau diese Manipulation würde beim Abschluss auffliegen.
    expect(verifySettlement(shown).length).toBeGreaterThan(0);
  });

  it('gespeicherte Reihenfolge (position) schlägt die Array-Reihenfolge', () => {
    const honest = computeSettlement(participants(TV4_ROWS));
    const stored = toStoredRows(honest, 'session-2', new Map());
    stored.lines.reverse();
    expect(fromStoredRows(stored).lines.map((line) => line.playerId)).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Share-Text gegen die Handrechnung (TV2, TV4)
// ---------------------------------------------------------------------------

describe('Share-Text', () => {
  it('TV2 — Handrechnung: Ali 160,00 € + Ben 40,00 € bar, Can schuldet Ali 40,00 €', () => {
    const settlement = computeSettlement(participants(TV2_ROWS));
    const text = buildShareText({
      playedOn: '2026-09-12',
      name: null,
      settlement,
      names: namesOf(TV2_ROWS),
    });

    expect(text).toBe(
      [
        'Poker-Kasse · Sa, 12.09.2026',
        '',
        'Aus der Kasse:',
        '- Ali bekommt 160,00 € bar',
        '- Ben bekommt 40,00 € bar',
        'Summe: 200,00 €',
        '',
        'Überweisungen:',
        '- Can schuldet Ali 40,00 €',
        'Summe: 40,00 €',
        '',
        'Ergebnis des Abends:',
        '- Ali: +100,00 €',
        '- Can: -40,00 €',
        '- Ben: -60,00 €',
      ].join('\n'),
    );
  });

  it('TV4 — Handrechnung: A bekommt die komplette Kasse, C und D je 50,00 €', () => {
    const settlement = computeSettlement(participants(TV4_ROWS));
    const text = buildShareText({
      playedOn: '2026-09-12',
      name: 'Freitagsrunde',
      settlement,
      names: namesOf(TV4_ROWS),
    });

    expect(text).toBe(
      [
        'Poker-Kasse · Sa, 12.09.2026 · Freitagsrunde',
        '',
        'Aus der Kasse:',
        '- A bekommt 200,00 € bar',
        'Summe: 200,00 €',
        '',
        'Überweisungen:',
        '- C schuldet A 50,00 €',
        '- D schuldet A 50,00 €',
        'Summe: 100,00 €',
        '',
        'Ergebnis des Abends:',
        '- A: +200,00 €',
        '- C: -50,00 €',
        '- D: -50,00 €',
        '- B: -100,00 €',
      ].join('\n'),
    );
  });

  it('enthält kein Markup und keine Tabulatoren (WhatsApp-tauglich)', () => {
    for (const rows of [TV2_ROWS, TV4_ROWS, TV8_ROWS, TV9_ROWS, TV9B_ROWS, TV10_ROWS]) {
      const text = buildShareText({
        playedOn: '2026-09-12',
        name: null,
        settlement: computeSettlement(participants(rows)),
        names: namesOf(rows),
      });
      expect(text).not.toMatch(/[<>\t]/);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. SettlementView: TV8 (Rundung) und die Differenz-Hinweise
// ---------------------------------------------------------------------------

describe('SettlementView', () => {
  it('TV8 — die Cent-Rundung steht so auf dem Schirm, wie sie gespeichert ist', () => {
    const settlement = computeSettlement(participants(TV8_ROWS));
    // Handrechnung docs/SETTLEMENT.md TV8: Stufe 2 = 66,67 / 66,67 / 66,66.
    expect(settlement.lines.map((line) => line.cashTier2)).toEqual([6667, 6667, 6666, 0, 0, 0]);
    expect(settlement.lines.map((line) => line.cashFromBox)).toEqual([
      16667, 16667, 16666, 0, 0, 0,
    ]);
    expect(settlement.transfers).toEqual([
      { fromPlayerId: 'F', toPlayerId: 'C', amount: 3334 },
      { fromPlayerId: 'F', toPlayerId: 'A', amount: 3333 },
      { fromPlayerId: 'F', toPlayerId: 'B', amount: 3333 },
    ]);

    const text = renderText(settlement, namesOf(TV8_ROWS));
    expect(text).toContain('166,67 € bar');
    expect(text).toContain('166,66 € bar');
    expect(text).toContain('33,34 €');
    expect(text).toContain('33,33 €');
    // Summe der Kasse: 500,00 €
    expect(text).toContain('500,00 €');
    // Keine Differenz -> kein Hinweis
    expect(text).not.toContain('Differenz');
  });

  it('TV9 — fehlende Chips bleiben als „Bleibt in der Kasse“ sichtbar', () => {
    const settlement = computeSettlement(participants(TV9_ROWS));
    expect(settlement.discrepancy).toBe(-1000);
    expect(settlement.unallocatedCash).toBe(1000);
    expect(settlement.uncoveredDebts).toBe(0);

    const text = renderText(settlement, namesOf(TV9_ROWS));
    expect(text).toContain('Bleibt in der Kasse: 10,00 € (Differenz)');
    expect(text).toContain('Keine Schulden, alles bar erledigt.');
    expect(text).toContain('Differenz -10,00 €');
    expect(text).toContain('10,00 € weniger gezählt als eingekauft');
  });

  it('TV9b — unallocatedCash UND uncoveredDebts sind beide sichtbar', () => {
    const settlement = computeSettlement(participants(TV9B_ROWS));
    expect(settlement.discrepancy).toBe(-10000);
    expect(settlement.unallocatedCash).toBe(0);
    expect(settlement.uncoveredDebts).toBe(10000);

    // Der reine TV9b hat unallocatedCash = 0. Um zu prüfen, dass die Anzeige
    // beide Hinweise gleichzeitig trägt (Testauftrag WP6), wird zusätzlich der
    // Fall mit beiden Resten gerendert: A auf Liste ohne Stack, B bar mit
    // Stack 0 -> Kasse bleibt liegen und eine Schuld bleibt ohne Gläubiger.
    const bothRows: Row[] = [
      { playerId: 'A', creditIn: 10000 },
      { playerId: 'B', cashIn: 10000 },
    ];
    const both = computeSettlement(participants(bothRows));
    expect(both.discrepancy).toBe(-20000);
    expect(both.unallocatedCash).toBe(10000);
    expect(both.uncoveredDebts).toBe(10000);

    const text = renderText(both, namesOf(bothRows));
    expect(text).toContain('Bleibt in der Kasse: 100,00 € (Differenz)');
    expect(text).toContain('100,00 € Schuld ohne Gläubiger (Differenz)');
    expect(text).toContain('Differenz -200,00 €');

    // Und der Original-TV9b zeigt wenigstens den Schuld-Hinweis.
    const plain = renderText(settlement, namesOf(TV9B_ROWS));
    expect(plain).toContain('100,00 € Schuld ohne Gläubiger (Differenz)');
    expect(plain).not.toContain('Bleibt in der Kasse');
  });

  it('TV10 — zu viel gezählt: Anspruch ohne Deckung', () => {
    const settlement = computeSettlement(participants(TV10_ROWS));
    expect(settlement.discrepancy).toBe(1000);
    expect(settlement.uncoveredClaims).toBe(1000);

    const text = renderText(settlement, namesOf(TV10_ROWS));
    expect(text).toContain('10,00 € Anspruch ohne Deckung (Differenz)');
    expect(text).toContain('Differenz +10,00 €');
    expect(text).toContain('10,00 € mehr gezählt als eingekauft');
  });

  it('unbekannte Spieler-Id wird nie als rohe Id angezeigt', () => {
    const settlement = computeSettlement(participants(TV2_ROWS));
    const text = renderText(settlement, {});
    expect(text).toContain('Unbekannt');
    expect(text).not.toContain('Ali');
  });
});

// ---------------------------------------------------------------------------
// 4. Angriffe auf verifySettlement — die einzige Verteidigung für
//    Invariante 5 und die Deckung je Schuldner
// ---------------------------------------------------------------------------

describe('verifySettlement schließt die dokumentierten Lücken von close_session', () => {
  it('kein Fehlalarm: alle Pflichtfälle gehen durch', () => {
    for (const rows of [
      TV2_ROWS,
      TV4_ROWS,
      TV8_ROWS,
      TV9_ROWS,
      TV9B_ROWS,
      TV10_ROWS,
      [{ playerId: 'A', cashIn: 10000, stack: 15000, payout: 15000 }, { playerId: 'B', cashIn: 10000, stack: 5000 }, { playerId: 'C', creditIn: 10000, stack: 10000 }],
      [{ playerId: 'A', cashIn: 10000, stack: 10000 }, { playerId: 'B', creditIn: 10000, stack: 10000, payout: 10000 }],
      [{ playerId: 'A' }, { playerId: 'B' }],
    ] satisfies Row[][]) {
      expect(verifySettlement(computeSettlement(participants(rows)))).toEqual([]);
    }
  });

  it('Lücke 1 (Invariante 5): Stufe 1 einseitig statt anteilig -> abgewiesen', () => {
    const rows: Row[] = [
      { playerId: 'A', cashIn: 10000, stack: 10000 },
      { playerId: 'B', cashIn: 10000, stack: 10000 },
      { playerId: 'C', creditIn: 10000, stack: 10000, payout: 10000 },
    ];
    const honest = computeSettlement(participants(rows));
    expect(honest.lines.map((line) => line.cashFromBox)).toEqual([5000, 5000, 0]);

    const payload = clone(honest);
    payload.lines[0].cashTier1 = 10000;
    payload.lines[0].cashFromBox = 10000;
    payload.lines[0].residual = 0;
    payload.lines[1].cashTier1 = 0;
    payload.lines[1].cashFromBox = 0;
    payload.lines[1].residual = 10000;
    payload.transfers = [{ fromPlayerId: 'C', toPlayerId: 'B', amount: 10000 }];

    expect(verifySettlement(payload)).toContain('TIER1_NOT_PROPORTIONAL');
  });

  it('Lücke 2: ein Schuldner zahlt für den anderen mit -> abgewiesen', () => {
    const rows: Row[] = [
      { playerId: 'A', creditIn: 20000, stack: 10000 },
      { playerId: 'B', creditIn: 20000, stack: 10000 },
      { playerId: 'C', creditIn: 10000, stack: 20000 },
      { playerId: 'D', creditIn: 10000, stack: 20000 },
    ];
    const payload = clone(computeSettlement(participants(rows)));
    payload.transfers = [
      { fromPlayerId: 'A', toPlayerId: 'C', amount: 10000 },
      { fromPlayerId: 'A', toPlayerId: 'D', amount: 10000 },
    ];
    expect(verifySettlement(payload)).toContain('DEBTOR_OVERPAYS');
  });

  it('Lücke 3: eine Stufe wird nur umetikettiert -> abgewiesen', () => {
    const rows: Row[] = [
      { playerId: 'A', cashIn: 10000, stack: 10000 },
      { playerId: 'B', creditIn: 10000, stack: 10000 },
    ];
    const payload = clone(computeSettlement(participants(rows)));
    const a = payload.lines[0];
    a.cashTier3 = a.cashTier1 + a.cashTier2;
    a.cashTier1 = 0;
    a.cashTier2 = 0;
    expect(verifySettlement(payload).length).toBeGreaterThan(0);
  });

  it('ein Gläubiger bekommt mehr, als ihm zusteht -> abgewiesen', () => {
    const rows: Row[] = [
      { playerId: 'A', creditIn: 20000, stack: 10000 },
      { playerId: 'B', creditIn: 20000, stack: 10000 },
      { playerId: 'C', creditIn: 10000, stack: 20000 },
      { playerId: 'D', creditIn: 10000, stack: 20000 },
    ];
    const payload = clone(computeSettlement(participants(rows)));
    payload.transfers = [
      { fromPlayerId: 'A', toPlayerId: 'C', amount: 10000 },
      { fromPlayerId: 'B', toPlayerId: 'C', amount: 10000 },
    ];
    expect(verifySettlement(payload)).toContain('CREDITOR_OVERPAID');
  });

  it('Bargeld an den Listen-Spieler, während ein Bar-Zahler offen ist -> abgewiesen', () => {
    const payload = clone(computeSettlement(participants(TV2_ROWS)));
    const [ali, , can] = payload.lines;
    ali.cashTier2 -= 6000;
    ali.cashFromBox -= 6000;
    ali.residual += 6000;
    can.cashTier3 += 6000;
    can.cashFromBox += 6000;
    can.residual -= 6000;
    payload.transfers = [{ fromPlayerId: 'Can', toPlayerId: 'Ali', amount: 10000 }];

    const problems = verifySettlement(payload);
    expect(problems).toContain('CASH_FIRST_VIOLATED');
    expect(problems).toContain('TIER2_WRONG');
  });

  it('Kopfzahlen frisiert (Differenz weggerechnet) -> abgewiesen', () => {
    const payload = clone(computeSettlement(participants(TV9_ROWS)));
    payload.discrepancy = 0;
    payload.totalStack = payload.totalBuyIn;
    expect(verifySettlement(payload).length).toBeGreaterThan(0);
  });

  it('Nicht-ganzzahlige Cent-Beträge -> abgewiesen (kein Float in der Kasse)', () => {
    const payload = clone(computeSettlement(participants(TV2_ROWS)));
    payload.lines[0].cashFromBox = 15999.5;
    expect(verifySettlement(payload)).toContain('NON_INTEGER_AMOUNT');
  });

  it('eine unterschlagene Überweisung fliegt auf', () => {
    const payload = clone(computeSettlement(participants(TV4_ROWS)));
    payload.transfers = payload.transfers.slice(0, 1);
    expect(verifySettlement(payload)).toContain('TRANSFER_TOTAL_WRONG');
  });
});

// ---------------------------------------------------------------------------
// 5. Statische Zusicherungen zur Server Action
// ---------------------------------------------------------------------------

describe('src/actions/close.ts', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/actions/close.ts', import.meta.url)),
    'utf8',
  );

  it('closeSession verlangt Editor, reopenSession Admin', () => {
    const close = /export async function closeSession\([\s\S]*?\r?\n\}\r?\n/.exec(source)?.[0] ?? '';
    const reopen =
      /export async function reopenSession\([\s\S]*?\r?\n\}\r?\n/.exec(source)?.[0] ?? '';
    expect(close).not.toBe('');
    expect(reopen).not.toBe('');
    expect(close).toContain('requireEditor()');
    expect(reopen).toContain('requireAdmin()');
  });

  it('p_settlement kommt aus der eigenen Berechnung, nie aus der Eingabe', () => {
    expect(source).toContain('p_settlement: toSettlementPayload(settlement)');
    // Das zod-Schema der Action lässt nur sessionId und note zu.
    const schema = readFileSync(
      fileURLToPath(new URL('../../src/lib/validation/close.ts', import.meta.url)),
      'utf8',
    );
    const closeSchema =
      /export const closeSessionSchema = z\.object\(\{([\s\S]*?)\n\}\);/.exec(schema)?.[1] ?? '';
    expect(closeSchema).toContain('sessionId');
    expect(closeSchema).toContain('note');
    expect(closeSchema).not.toMatch(/lines|transfers|settlement|cash/i);
  });

  it('verifySettlement läuft vor der RPC und blockt bei einem Verstoß', () => {
    const verifyAt = source.indexOf('verifySettlement(settlement)');
    const rpcAt = source.indexOf("rpc('close_session'");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(rpcAt).toBeGreaterThan(verifyAt);
    expect(source).toContain("throw new AppError('SETTLEMENT_INVARIANT'");
  });
});
