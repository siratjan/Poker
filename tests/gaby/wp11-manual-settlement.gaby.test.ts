/**
 * WP11 — manuelle Übersteuerung der Abrechnung in der Vorschau.
 *
 * Prüft die drei Grenzen, die ohne eingespielte DB überhaupt beweisbar sind:
 *
 *   1. `verifyManual` (die serverseitige Grundintegrität in der Server-Action):
 *      lässt absichtlich „unstimmige“, aber wohlgeformte Zahlen durch und weist
 *      genau die Verletzungen aus SPEC §6.1 ab (Betrag 0/negativ, Selbst-Transfer,
 *      Nicht-Teilnehmer, Nicht-Integer, Kasse < 0, doppelte/fehlende Zeile).
 *   2. Der Round-Trip `toStoredRows`/`fromStoredRows` friert eine manuelle
 *      Abrechnung Byte für Byte ein und gibt sie exakt so zurück — nie neu
 *      gerechnet. Genau diesen Weg nimmt die Detailseite aus der DB.
 *   3. Statischer SQL-Review von `0008_manual_settlement.sql`: die RPC ist
 *      admin-only, verlangt `p_note`, setzt `is_manual = true`, rechnet nichts
 *      nach (keine SETTLEMENT_INVARIANT-Prüfung) und die Audit-Trigger auf beiden
 *      Zeilen-Tabellen sind da. Der erste echte Lauf im SQL-Editor bleibt der
 *      eigentliche Test (siehe „Nicht verifiziert“ in qa/reports/WP11-gaby.md).
 *
 * Diese Tests gehören Gaby: nie löschen oder abschwächen (CLAUDE.md).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeSettlement } from '@/lib/settlement';
import { fromStoredRows, toStoredRows } from '@/lib/settlement/toPersist';
import type { FrozenSettlement, SettlementParticipant } from '@/lib/settlement/types';
import { verifyManual } from '@/lib/settlement/verifyManual';

const ALI = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CAN = '44444444-4444-4444-8444-444444444444';
const STRANGER = '55555555-5555-4555-8555-555555555555';
const SESSION = '33333333-3333-4333-8333-333333333333';

// TV2-ähnlich: Ali 100 bar, Ben 100 bar, Can 100 auf Liste; Stacks 200/40/60.
const PARTS: SettlementParticipant[] = [
  { playerId: ALI, name: 'Ali', position: 0, cashIn: 10000, creditIn: 0, stack: 20000, payout: 0 },
  { playerId: BEN, name: 'Ben', position: 1, cashIn: 10000, creditIn: 0, stack: 4000, payout: 0 },
  { playerId: CAN, name: 'Can', position: 2, cashIn: 0, creditIn: 10000, stack: 6000, payout: 0 },
];

const IDS = new Set([ALI, BEN, CAN]);

function base(): FrozenSettlement {
  return computeSettlement(PARTS);
}

/** A hand-edited settlement: patch applied on top of the automatic base. */
function manual(patch: Partial<FrozenSettlement>): FrozenSettlement {
  return { ...base(), isManual: true, ...patch };
}

describe('verifyManual — Grundintegrität ohne Reconciliation (SPEC §6.1)', () => {
  it('lässt eine absichtlich unstimmige, aber wohlgeformte Abrechnung durch', () => {
    // Ali bekommt 0 € bar (Automatik gäbe 160 €), dazu ein Transfer, der zu
    // keinem Residuum passt. Frei erlaubt, keine Stimmigkeitsprüfung.
    const edited = manual({
      lines: base().lines.map((line, index) =>
        index === 0 ? { ...line, cashFromBox: 0, cashTier1: 0, cashTier2: 0, cashTier3: 0 } : line,
      ),
      transfers: [{ fromPlayerId: CAN, toPlayerId: ALI, amount: 12345 }],
    });
    expect(verifyManual(edited, IDS)).toEqual([]);
  });

  it('lehnt einen Transfer-Betrag von 0 und einen negativen Betrag ab', () => {
    expect(
      verifyManual(manual({ transfers: [{ fromPlayerId: CAN, toPlayerId: ALI, amount: 0 }] }), IDS),
    ).toContain('TRANSFER_AMOUNT_INVALID');
    expect(
      verifyManual(
        manual({ transfers: [{ fromPlayerId: CAN, toPlayerId: ALI, amount: -100 }] }),
        IDS,
      ),
    ).toContain('TRANSFER_AMOUNT_INVALID');
  });

  it('lehnt einen nicht-ganzzahligen Transfer-Betrag ab', () => {
    expect(
      verifyManual(
        manual({ transfers: [{ fromPlayerId: CAN, toPlayerId: ALI, amount: 100.5 }] }),
        IDS,
      ),
    ).toContain('TRANSFER_AMOUNT_INVALID');
  });

  it('lehnt eine Selbst-Überweisung ab', () => {
    expect(
      verifyManual(manual({ transfers: [{ fromPlayerId: ALI, toPlayerId: ALI, amount: 100 }] }), IDS),
    ).toContain('TRANSFER_TO_SELF');
  });

  it('lehnt einen Transfer an einen Nicht-Teilnehmer ab (beide Richtungen)', () => {
    expect(
      verifyManual(
        manual({ transfers: [{ fromPlayerId: STRANGER, toPlayerId: ALI, amount: 100 }] }),
        IDS,
      ),
    ).toContain('TRANSFER_PLAYER_UNKNOWN');
    expect(
      verifyManual(
        manual({ transfers: [{ fromPlayerId: ALI, toPlayerId: STRANGER, amount: 100 }] }),
        IDS,
      ),
    ).toContain('TRANSFER_PLAYER_UNKNOWN');
  });

  it('lehnt eine negative „Aus der Kasse“-Auszahlung ab', () => {
    const edited = manual({
      lines: base().lines.map((line, index) =>
        index === 0 ? { ...line, cashFromBox: -1 } : line,
      ),
    });
    expect(verifyManual(edited, IDS)).toContain('CASH_FROM_BOX_NEGATIVE');
  });

  it('lehnt einen nicht-ganzzahligen Zeilen-Betrag ab', () => {
    const edited = manual({
      lines: base().lines.map((line, index) =>
        index === 0 ? { ...line, cashFromBox: 100.25 } : line,
      ),
    });
    expect(verifyManual(edited, IDS)).toContain('NON_INTEGER_AMOUNT');
  });

  it('lehnt eine Zeile für einen Nicht-Teilnehmer ab', () => {
    const edited = manual({
      lines: [...base().lines, { ...base().lines[0], playerId: STRANGER }],
    });
    const problems = verifyManual(edited, IDS);
    expect(problems).toContain('LINE_PLAYER_UNKNOWN');
    // Vier Zeilen für drei Teilnehmer -> auch die Anzahl passt nicht.
    expect(problems).toContain('LINE_COUNT_MISMATCH');
  });

  it('lehnt eine doppelte Spielerzeile ab', () => {
    const edited = manual({
      lines: [base().lines[0], base().lines[0], base().lines[1]],
    });
    expect(verifyManual(edited, IDS)).toContain('DUPLICATE_PLAYER');
  });

  it('verlangt genau eine Zeile je Teilnehmer (fehlende Zeile)', () => {
    const edited = manual({ lines: base().lines.slice(0, 2) });
    expect(verifyManual(edited, IDS)).toContain('LINE_COUNT_MISMATCH');
  });

  it('lehnt einen nicht-ganzzahligen Header-Betrag ab', () => {
    expect(verifyManual(manual({ discrepancy: 10.5 }), IDS)).toContain('NON_INTEGER_AMOUNT');
  });
});

describe('Round-Trip — manuelle Abrechnung wird eingefroren, nie neu gerechnet', () => {
  it('gibt exakt die gesetzten unstimmigen Werte aus den DB-Zeilen zurück', () => {
    const edited = manual({
      lines: base().lines.map((line) => ({
        ...line,
        cashFromBox: 12345,
        cashTier1: 12345,
        cashTier2: 0,
        cashTier3: 0,
        residual: line.claim - 12345 - line.creditIn,
      })),
      transfers: [{ fromPlayerId: BEN, toPlayerId: ALI, amount: 777 }],
    });

    const positions = new Map<string, number>([
      [ALI, 0],
      [BEN, 1],
      [CAN, 2],
    ]);
    const rows = toStoredRows(edited, SESSION, positions);

    expect(rows.settlement.is_manual).toBe(true);
    // Der Weg, den die Detailseite nimmt (fromStoredRows), reproduziert 1:1.
    expect(fromStoredRows(rows)).toEqual(edited);
    expect(fromStoredRows(rows).lines.every((line) => line.cashFromBox === 12345)).toBe(true);
    expect(fromStoredRows(rows).transfers).toEqual(edited.transfers);
  });

  it('der Automatik-Pfad ist niemals manuell', () => {
    expect(base().isManual).toBe(false);
  });
});

const migration0008 = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/0008_manual_settlement.sql', import.meta.url)),
  'utf8',
);
const schemaSql = readFileSync(
  fileURLToPath(new URL('../../supabase/migrations/0001_schema.sql', import.meta.url)),
  'utf8',
);

describe('SQL-Review 0008 — statisch (DB nicht eingespielt)', () => {
  it('fügt is_manual mit Default false hinzu', () => {
    expect(migration0008).toMatch(
      /add column if not exists is_manual boolean not null default false/i,
    );
  });

  it('close_session_manual ist admin-only und security definer', () => {
    expect(migration0008).toMatch(/security definer/i);
    expect(migration0008).toMatch(/if not public\.is_admin\(\) then\s*\n\s*raise exception 'FORBIDDEN'/i);
  });

  it('verlangt eine Begründung von mindestens drei Zeichen', () => {
    expect(migration0008).toMatch(/length\(v_note\) < 3/);
    expect(migration0008).toMatch(/REASON_REQUIRED/);
  });

  it('schreibt nur in eine offene Session', () => {
    expect(migration0008).toMatch(/if v_status <> 'open' then\s*\n\s*raise exception 'SESSION_CLOSED'/i);
  });

  it('setzt is_manual = true beim Insert', () => {
    // im settlements-Insert steht die Spalte und der Wert true.
    expect(migration0008).toMatch(/is_manual\s*\n\s*\)\s*values/i);
    expect(migration0008).toMatch(/true\s*\n\s*\);/);
  });

  it('rechnet nichts nach: keine algorithmische Invarianten-Prüfung', () => {
    expect(migration0008).not.toMatch(/SETTLEMENT_INVARIANT/);
    // keine Neuberechnung aus entries (kein sum(...) filter über entries).
    expect(migration0008).not.toMatch(/filter \(where e\.type/);
  });

  it('prüft, dass Transfers echte Teilnehmer referenzieren', () => {
    expect(migration0008).toMatch(/settlement_transfers st/);
    expect(migration0008).toMatch(/SETTLEMENT_MISMATCH/);
  });

  it('legt Audit-Trigger auf beide Zeilen-Tabellen', () => {
    expect(migration0008).toMatch(/create trigger audit_settlement_lines/i);
    expect(migration0008).toMatch(/create trigger audit_settlement_transfers/i);
    expect(migration0008).toMatch(/audit_row_change/);
  });

  it('erteilt execute nur authenticated, entzieht public/anon', () => {
    expect(migration0008).toMatch(
      /revoke all on function public\.close_session_manual\(uuid, jsonb, text\) from public, anon/i,
    );
    expect(migration0008).toMatch(
      /grant execute on function public\.close_session_manual\(uuid, jsonb, text\) to authenticated/i,
    );
  });

  it('die Tabellen-Check-Constraints (Betrag > 0, kein Selbst-Transfer) bleiben in 0001', () => {
    expect(schemaSql).toMatch(/amount_cents\s+integer not null check \(amount_cents > 0\)/);
    expect(schemaSql).toMatch(/settlement_transfers_not_self check \(from_player_id <> to_player_id\)/);
  });
});
