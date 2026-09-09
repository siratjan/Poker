import { describe, expect, it } from 'vitest';
import { formatPlayedOn } from '@/lib/time';
import { computeSettlement } from './index';
import { buildShareText, describeDiscrepancy, sortedByResult, sumCashFromBox } from './shareText';
import type { SettlementParticipant } from './types';

/**
 * The text of the „Abrechnung kopieren“ button (docs/ARBEITSPAKETE.md WP6,
 * step 5 and 6). It is what actually gets pasted into the group chat, so every
 * amount is asserted literally against the hand calculation of
 * `docs/SETTLEMENT.md` — not against the code.
 */

const PLAYED_ON = '2026-09-11';
const DATE = formatPlayedOn(PLAYED_ON);

function participants(
  rows: readonly {
    playerId: string;
    cashIn?: number;
    creditIn?: number;
    stack?: number;
    payout?: number;
  }[],
): SettlementParticipant[] {
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

/** Player ids are their own names in these tests, except where stated. */
function namesOf(input: readonly SettlementParticipant[]): Record<string, string> {
  return Object.fromEntries(input.map((row) => [row.playerId, row.playerId]));
}

function share(
  input: readonly SettlementParticipant[],
  name: string | null = null,
  names: Record<string, string> = namesOf(input),
): string {
  return buildShareText({
    playedOn: PLAYED_ON,
    name,
    settlement: computeSettlement(input),
    names,
  });
}

describe('buildShareText', () => {
  it('TV2 – Bar-Zahler vor Listen-Gewinner', () => {
    // Ali 100 bar / Stack 200, Ben 100 bar / Stack 40, Can 100 Liste / Stack 60.
    // Stufe 1: Ali 100, Ben 40 (box 60). Stufe 2: Ali 60. Can bekommt nichts.
    const input = participants([
      { playerId: 'Ali', cashIn: 10000, stack: 20000 },
      { playerId: 'Ben', cashIn: 10000, stack: 4000 },
      { playerId: 'Can', creditIn: 10000, stack: 6000 },
    ]);

    expect(share(input)).toBe(
      [
        `Poker-Kasse · ${DATE}`,
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

  it('TV4 – ein Bar-Zahler bekommt die komplette Kasse', () => {
    // A 100 bar / Stack 300, B 100 bar / Stack 0, C und D je 100 Liste / Stack 50.
    // A bekommt die ganzen 200 bar; C und D schulden ihm je 50.
    const input = participants([
      { playerId: 'A', cashIn: 10000, stack: 30000 },
      { playerId: 'B', cashIn: 10000 },
      { playerId: 'C', creditIn: 10000, stack: 5000 },
      { playerId: 'D', creditIn: 10000, stack: 5000 },
    ]);

    expect(share(input, 'Freitagsrunde')).toBe(
      [
        `Poker-Kasse · ${DATE} · Freitagsrunde`,
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

  it('TV9 – Chips fehlen, Bargeld bleibt in der Kasse', () => {
    const input = participants([
      { playerId: 'A', cashIn: 10000, stack: 9000 },
      { playerId: 'B', cashIn: 10000, stack: 10000 },
    ]);

    expect(share(input)).toBe(
      [
        `Poker-Kasse · ${DATE}`,
        '',
        'Aus der Kasse:',
        '- A bekommt 90,00 € bar',
        '- B bekommt 100,00 € bar',
        // „Summe = Kasse“ (WP6, step 3): 190,00 € handed out + 10,00 € left in
        // the box = the 200,00 € that were paid in cash.
        'Summe: 200,00 €',
        'Bleibt in der Kasse: 10,00 € (Differenz)',
        '',
        'Überweisungen:',
        '- Keine Schulden, alles bar erledigt.',
        '',
        'Ergebnis des Abends:',
        '- B: 0,00 €',
        '- A: -10,00 €',
        'Differenz: -10,00 € (10,00 € weniger gezählt als eingekauft)',
      ].join('\n'),
    );
  });

  it('TV9b – Schuld ohne Gläubiger, kein Bargeld im Spiel', () => {
    const input = participants([
      { playerId: 'A', creditIn: 10000 },
      { playerId: 'B', creditIn: 10000, stack: 10000 },
    ]);

    expect(share(input)).toBe(
      [
        `Poker-Kasse · ${DATE}`,
        '',
        'Aus der Kasse:',
        '- Es ist kein Bargeld zu verteilen.',
        '',
        'Überweisungen:',
        '- Keine Schulden, alles bar erledigt.',
        'Achtung: 100,00 € Schuld ohne Gläubiger (Differenz)',
        '',
        'Ergebnis des Abends:',
        '- B: 0,00 €',
        '- A: -100,00 €',
        'Differenz: -100,00 € (100,00 € weniger gezählt als eingekauft)',
      ].join('\n'),
    );
  });

  it('TV10 – Anspruch ohne Deckung', () => {
    const input = participants([
      { playerId: 'A', cashIn: 10000, stack: 12000 },
      { playerId: 'B', creditIn: 10000, stack: 9000 },
    ]);

    expect(share(input)).toBe(
      [
        `Poker-Kasse · ${DATE}`,
        '',
        'Aus der Kasse:',
        '- A bekommt 100,00 € bar',
        'Summe: 100,00 €',
        '',
        'Überweisungen:',
        '- B schuldet A 10,00 €',
        'Summe: 10,00 €',
        'Achtung: 10,00 € Anspruch ohne Deckung (Differenz)',
        '',
        'Ergebnis des Abends:',
        '- A: +20,00 €',
        '- B: -10,00 €',
        'Differenz: +10,00 € (10,00 € mehr gezählt als eingekauft)',
      ].join('\n'),
    );
  });

  it('TV8 – die Cent aus der Largest-Remainder-Rundung stehen im Text', () => {
    const input = participants([
      { playerId: 'A', cashIn: 10000, stack: 20000 },
      { playerId: 'B', cashIn: 10000, stack: 20000 },
      { playerId: 'C', cashIn: 10000, stack: 20000 },
      { playerId: 'D', cashIn: 10000 },
      { playerId: 'E', cashIn: 10000 },
      { playerId: 'F', creditIn: 10000 },
    ]);
    const text = share(input);

    expect(text).toContain('- A bekommt 166,67 € bar');
    expect(text).toContain('- B bekommt 166,67 € bar');
    expect(text).toContain('- C bekommt 166,66 € bar');
    expect(text).toContain('Summe: 500,00 €');
    expect(text).toContain('- F schuldet C 33,34 €');
    expect(text).toContain('- F schuldet A 33,33 €');
    expect(text).toContain('- F schuldet B 33,33 €');
    // The three transfers add up to F's full debt, to the cent.
    expect(text).toContain('Summe: 100,00 €');
  });

  it('uses the display names, and „Unbekannt“ for a player it does not know', () => {
    const input = participants([
      { playerId: 'p1', cashIn: 10000, stack: 20000 },
      { playerId: 'p2', creditIn: 10000 },
    ]);
    const text = buildShareText({
      playedOn: PLAYED_ON,
      name: null,
      settlement: computeSettlement(input),
      names: { p1: 'Ali' },
    });

    expect(text).toContain('- Ali bekommt 100,00 € bar');
    expect(text).toContain('- Unbekannt schuldet Ali 100,00 €');
    expect(text).not.toContain('p1');
    expect(text).not.toContain('p2');
  });

  it('drops an empty session name instead of leaving a dangling separator', () => {
    const input = participants([{ playerId: 'A', cashIn: 10000, stack: 10000 }]);

    expect(share(input, '   ').split('\n')[0]).toBe(`Poker-Kasse · ${DATE}`);
    expect(share(input, ' Heimspiel ').split('\n')[0]).toBe(`Poker-Kasse · ${DATE} · Heimspiel`);
  });

  it('is plain text: no markup, no tab, no trailing blank line', () => {
    const input = participants([
      { playerId: 'Ali', cashIn: 10000, stack: 20000 },
      { playerId: 'Can', creditIn: 10000 },
    ]);
    const text = share(input);

    expect(text).not.toMatch(/[<>*_|\t]/);
    expect(text).toBe(text.trim());
  });
});

describe('helpers shared with the settlement view', () => {
  it('describeDiscrepancy names the direction in plain German', () => {
    expect(describeDiscrepancy(0)).toBe('Buy-ins und Stacks stimmen überein');
    expect(describeDiscrepancy(-2000)).toBe('20,00 € weniger gezählt als eingekauft');
    expect(describeDiscrepancy(2000)).toBe('20,00 € mehr gezählt als eingekauft');
  });

  it('sortedByResult puts the biggest plus first and keeps ties in join order', () => {
    const input = participants([
      { playerId: 'A', cashIn: 10000, stack: 5000 },
      { playerId: 'B', cashIn: 10000, stack: 20000 },
      { playerId: 'C', cashIn: 10000, stack: 5000 },
    ]);
    const settlement = computeSettlement(input);

    expect(sortedByResult(settlement).map((line) => line.playerId)).toEqual(['B', 'A', 'C']);
    // and it does not reorder the settlement itself
    expect(settlement.lines.map((line) => line.playerId)).toEqual(['A', 'B', 'C']);
  });

  it('sumCashFromBox is the cash that is physically handed out', () => {
    const settlement = computeSettlement(
      participants([
        { playerId: 'A', cashIn: 10000, stack: 15000, payout: 5000 },
        { playerId: 'B', cashIn: 10000, stack: 5000 },
      ]),
    );

    expect(sumCashFromBox(settlement) + settlement.unallocatedCash).toBe(
      settlement.cashBoxAfterPayouts,
    );
  });
});
