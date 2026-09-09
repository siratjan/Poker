import { describe, expect, it } from 'vitest';
import type { Json } from '@/lib/database.types';
import {
  auditActionLabel,
  auditTableLabel,
  AUDITED_TABLES,
  describeAuditEntry,
  referencedIds,
  type AuditEntry,
  type AuditNames,
} from './describe';

/**
 * Every table × action of the audit trigger (0002) has a sentence here
 * (docs/ARBEITSPAKETE.md WP8, Testauftrag). Unknown input must produce a
 * generic text, never an exception.
 */

const NAMES: AuditNames = {
  players: { 'player-1': 'Ali', 'player-2': 'Can' },
  sessions: { 'session-1': 'Sa, 12.09.2026' },
};

function entry(overrides: Partial<AuditEntry> & Pick<AuditEntry, 'tableName' | 'action'>): AuditEntry {
  return {
    id: 1,
    at: '2026-09-12T19:14:00.000Z',
    userId: 'user-1',
    userEmail: 'sirat@example.com',
    userName: 'Sirat',
    rowId: 'row-1',
    oldData: null,
    newData: null,
    sessionId: 'session-1',
    ...overrides,
  };
}

function say(overrides: Partial<AuditEntry> & Pick<AuditEntry, 'tableName' | 'action'>): string {
  return describeAuditEntry(entry(overrides), NAMES);
}

const BUY_IN: Json = {
  id: 'entry-1',
  session_id: 'session-1',
  player_id: 'player-1',
  type: 'buy_in',
  amount_cents: 10000,
  payment: 'cash',
};

describe('describeAuditEntry – entries', () => {
  it('INSERT buy-in names amount, payment method and player', () => {
    expect(say({ tableName: 'entries', action: 'INSERT', newData: BUY_IN })).toBe(
      'hat Buy-in 100,00 € bar für Ali eingetragen',
    );
  });

  it('INSERT buy-in on the list', () => {
    expect(
      say({
        tableName: 'entries',
        action: 'INSERT',
        newData: { ...(BUY_IN as object), payment: 'credit' } as Json,
      }),
    ).toBe('hat Buy-in 100,00 € auf Liste für Ali eingetragen');
  });

  it('INSERT cash-out', () => {
    expect(
      say({
        tableName: 'entries',
        action: 'INSERT',
        newData: { player_id: 'player-2', type: 'cash_out', amount_cents: 25000, payment: null },
      }),
    ).toBe('hat Stack 250,00 € für Can eingetragen');
  });

  it('INSERT payout', () => {
    expect(
      say({
        tableName: 'entries',
        action: 'INSERT',
        newData: { player_id: 'player-1', type: 'payout', amount_cents: 5000 },
      }),
    ).toBe('hat Bar-Auszahlung 50,00 € für Ali eingetragen');
  });

  it('UPDATE of the amount shows old and new value', () => {
    expect(
      say({
        tableName: 'entries',
        action: 'UPDATE',
        oldData: { player_id: 'player-1', type: 'cash_out', amount_cents: 10000 },
        newData: { player_id: 'player-1', type: 'cash_out', amount_cents: 12000 },
      }),
    ).toBe('hat Stack für Ali von 100,00 € auf 120,00 € geändert');
  });

  it('UPDATE without an amount change stays generic but readable', () => {
    expect(
      say({
        tableName: 'entries',
        action: 'UPDATE',
        oldData: BUY_IN,
        newData: BUY_IN,
      }),
    ).toBe('hat Buy-in 100,00 € bar für Ali geändert');
  });

  it('DELETE describes the row from its old values (WP8 DoD)', () => {
    expect(say({ tableName: 'entries', action: 'DELETE', oldData: BUY_IN })).toBe(
      'hat Buy-in 100,00 € bar für Ali gelöscht',
    );
  });

  it('names an unknown player „Unbekannt“, never a raw id', () => {
    const text = say({
      tableName: 'entries',
      action: 'INSERT',
      newData: { player_id: 'ghost', type: 'buy_in', amount_cents: 100, payment: 'cash' },
    });
    expect(text).toBe('hat Buy-in 1,00 € bar für Unbekannt eingetragen');
    expect(text).not.toContain('ghost');
  });
});

describe('describeAuditEntry – sessions', () => {
  const SESSION: Json = { id: 'session-1', played_on: '2026-09-12', name: 'Freitagsrunde', status: 'open' };

  it('INSERT', () => {
    expect(say({ tableName: 'sessions', action: 'INSERT', newData: SESSION })).toBe(
      'hat die Session vom Sa, 12.09.2026 angelegt',
    );
  });

  it('UPDATE open -> closed reads as „abgeschlossen“', () => {
    expect(
      say({
        tableName: 'sessions',
        action: 'UPDATE',
        oldData: SESSION,
        newData: { ...(SESSION as object), status: 'closed', discrepancy_cents: 0 } as Json,
      }),
    ).toBe('hat die Session vom Sa, 12.09.2026 abgeschlossen');
  });

  it('UPDATE open -> closed with a difference shows it', () => {
    expect(
      say({
        tableName: 'sessions',
        action: 'UPDATE',
        oldData: SESSION,
        newData: { ...(SESSION as object), status: 'closed', discrepancy_cents: -2000 } as Json,
      }),
    ).toBe('hat die Session vom Sa, 12.09.2026 abgeschlossen (Differenz -20,00 €)');
  });

  it('UPDATE closed -> open reads as „wieder geöffnet“', () => {
    expect(
      say({
        tableName: 'sessions',
        action: 'UPDATE',
        oldData: { ...(SESSION as object), status: 'closed' } as Json,
        newData: SESSION,
      }),
    ).toBe('hat die Session vom Sa, 12.09.2026 wieder geöffnet');
  });

  it('UPDATE of the name', () => {
    expect(
      say({
        tableName: 'sessions',
        action: 'UPDATE',
        oldData: SESSION,
        newData: { ...(SESSION as object), name: 'Samstagsrunde' } as Json,
      }),
    ).toBe('hat die Session vom Sa, 12.09.2026 umbenannt: „Freitagsrunde“ → „Samstagsrunde“');
  });

  it('UPDATE of the date', () => {
    expect(
      say({
        tableName: 'sessions',
        action: 'UPDATE',
        oldData: SESSION,
        newData: { ...(SESSION as object), played_on: '2026-09-13' } as Json,
      }),
    ).toBe('hat das Datum der Session auf So, 13.09.2026 geändert');
  });

  it('UPDATE without a recognisable change', () => {
    expect(
      say({ tableName: 'sessions', action: 'UPDATE', oldData: SESSION, newData: SESSION }),
    ).toBe('hat die Session vom Sa, 12.09.2026 geändert');
  });

  it('DELETE', () => {
    expect(say({ tableName: 'sessions', action: 'DELETE', oldData: SESSION })).toBe(
      'hat die Session vom Sa, 12.09.2026 gelöscht',
    );
  });
});

describe('describeAuditEntry – session_players', () => {
  it('INSERT and DELETE name the player', () => {
    const row: Json = { session_id: 'session-1', player_id: 'player-2', position: 2 };
    expect(say({ tableName: 'session_players', action: 'INSERT', newData: row })).toBe(
      'hat Can zur Session hinzugefügt',
    );
    expect(say({ tableName: 'session_players', action: 'DELETE', oldData: row })).toBe(
      'hat Can aus der Session entfernt',
    );
    expect(
      say({ tableName: 'session_players', action: 'UPDATE', oldData: row, newData: row }),
    ).toBe('hat die Teilnahme von Can geändert');
  });
});

describe('describeAuditEntry – players', () => {
  it('INSERT, UPDATE (rename) and DELETE', () => {
    expect(
      say({ tableName: 'players', action: 'INSERT', newData: { id: 'player-1', name: 'Ali' } }),
    ).toBe('hat den Spieler „Ali“ angelegt');
    expect(
      say({
        tableName: 'players',
        action: 'UPDATE',
        oldData: { id: 'player-1', name: 'Ali' },
        newData: { id: 'player-1', name: 'Alex' },
      }),
    ).toBe('hat den Spieler „Ali“ in „Alex“ umbenannt');
    expect(
      say({ tableName: 'players', action: 'DELETE', oldData: { id: 'player-1', name: 'Ali' } }),
    ).toBe('hat den Spieler „Ali“ gelöscht');
  });
});

describe('describeAuditEntry – app_users', () => {
  it('INSERT is the first login, with the role from the whitelist', () => {
    expect(
      say({
        tableName: 'app_users',
        action: 'INSERT',
        newData: { id: 'user-2', email: 'ali@example.com', role: 'editor' },
      }),
    ).toBe('hat sich zum ersten Mal angemeldet (Rolle Bearbeiter)');
  });

  it('UPDATE spells out both roles in German', () => {
    expect(
      say({
        tableName: 'app_users',
        action: 'UPDATE',
        oldData: { id: 'user-2', email: 'ali@example.com', role: 'viewer' },
        newData: { id: 'user-2', email: 'ali@example.com', role: 'editor' },
      }),
    ).toBe('hat die Rolle von ali@example.com von Betrachter auf Bearbeiter gesetzt');
  });

  it('DELETE', () => {
    expect(
      say({
        tableName: 'app_users',
        action: 'DELETE',
        oldData: { id: 'user-2', email: 'ali@example.com', role: 'viewer' },
      }),
    ).toBe('hat den Nutzer ali@example.com gelöscht');
  });
});

describe('describeAuditEntry – settings', () => {
  it('quick amounts are formatted as money', () => {
    expect(
      say({
        tableName: 'settings',
        action: 'UPDATE',
        oldData: { key: 'quick_amounts_cents', value: [5000, 10000, 20000] },
        newData: { key: 'quick_amounts_cents', value: [2500, 5000] },
      }),
    ).toBe('hat die Schnellbeträge auf 25,00 € / 50,00 € gesetzt');
  });

  it('INSERT of the seed row', () => {
    expect(
      say({
        tableName: 'settings',
        action: 'INSERT',
        newData: { key: 'quick_amounts_cents', value: [5000] },
      }),
    ).toBe('hat die Schnellbeträge auf 50,00 € gesetzt');
  });

  it('a broken value does not break the sentence', () => {
    expect(
      say({
        tableName: 'settings',
        action: 'UPDATE',
        newData: { key: 'quick_amounts_cents', value: [12.5, 'x'] },
      }),
    ).toBe('hat die Schnellbeträge geändert');
  });

  it('an unknown key keeps its name', () => {
    expect(
      say({ tableName: 'settings', action: 'UPDATE', newData: { key: 'theme', value: 'dark' } }),
    ).toBe('hat die Einstellung „theme“ geändert');
  });

  it('DELETE', () => {
    expect(
      say({ tableName: 'settings', action: 'DELETE', oldData: { key: 'theme', value: 'dark' } }),
    ).toBe('hat die Einstellung „theme“ gelöscht');
  });
});

describe('describeAuditEntry – settlements', () => {
  it('INSERT, UPDATE and DELETE mention the session', () => {
    const row: Json = { session_id: 'session-1', algorithm_version: 1 };
    expect(say({ tableName: 'settlements', action: 'INSERT', newData: row })).toBe(
      'hat die Abrechnung der Session vom Sa, 12.09.2026 gespeichert',
    );
    expect(say({ tableName: 'settlements', action: 'DELETE', oldData: row })).toBe(
      'hat die gespeicherte Abrechnung der Session vom Sa, 12.09.2026 gelöscht',
    );
    expect(say({ tableName: 'settlements', action: 'UPDATE', newData: row })).toBe(
      'hat die Abrechnung der Session vom Sa, 12.09.2026 geändert',
    );
  });

  it('works without a known session', () => {
    expect(
      describeAuditEntry(
        entry({ tableName: 'settlements', action: 'INSERT', sessionId: 'unknown' }),
        NAMES,
      ),
    ).toBe('hat die Abrechnung gespeichert');
  });
});

describe('describeAuditEntry – robustness', () => {
  it('every audited table has a non-generic sentence for every action', () => {
    for (const tableName of AUDITED_TABLES) {
      for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
        const text = describeAuditEntry(entry({ tableName, action }), NAMES);
        expect(text.length).toBeGreaterThan(0);
        expect(text).not.toContain('undefined');
        expect(text).not.toContain('NaN');
      }
    }
  });

  it('an unknown table falls back to a generic sentence', () => {
    expect(say({ tableName: 'role_whitelist', action: 'INSERT' })).toBe(
      'hat einen Eintrag in „role_whitelist“ angelegt',
    );
    expect(say({ tableName: 'role_whitelist', action: 'DELETE' })).toBe(
      'hat einen Eintrag in „role_whitelist“ gelöscht',
    );
  });

  it('an unknown action falls back as well', () => {
    expect(say({ tableName: 'entries', action: 'TRUNCATE', newData: BUY_IN })).toBe(
      'hat einen Eintrag in „Einträge“ verändert',
    );
  });

  it('never throws on hostile or malformed payloads', () => {
    const payloads: (Json | null)[] = [
      null,
      [],
      'not an object',
      42,
      { amount_cents: 10.5, type: 'buy_in', player_id: 'player-1' },
      { amount_cents: 'viel', type: 12, player_id: 7 },
      { played_on: 'nicht-ein-datum' },
      { value: { nested: true } },
    ];

    for (const tableName of [...AUDITED_TABLES, 'was_auch_immer']) {
      for (const action of ['INSERT', 'UPDATE', 'DELETE', '???']) {
        for (const payload of payloads) {
          expect(() =>
            describeAuditEntry(entry({ tableName, action, oldData: payload, newData: payload })),
          ).not.toThrow();
        }
      }
    }
  });

  it('a non-integer amount is dropped instead of crashing formatCents', () => {
    expect(
      say({
        tableName: 'entries',
        action: 'INSERT',
        newData: { player_id: 'player-1', type: 'buy_in', amount_cents: 10.5, payment: 'cash' },
      }),
    ).toBe('hat Buy-in bar für Ali eingetragen');
  });
});

describe('helpers', () => {
  it('labels tables and actions in German', () => {
    expect(auditTableLabel('entries')).toBe('Einträge');
    expect(auditTableLabel('etwas_neues')).toBe('etwas_neues');
    expect(auditActionLabel('INSERT')).toBe('Neu');
    expect(auditActionLabel('UPDATE')).toBe('Geändert');
    expect(auditActionLabel('DELETE')).toBe('Gelöscht');
    expect(auditActionLabel('OTHER')).toBe('OTHER');
  });

  it('collects the ids a row references', () => {
    expect(referencedIds(entry({ tableName: 'entries', action: 'INSERT', newData: BUY_IN }))).toEqual(
      { playerIds: ['player-1'], sessionIds: ['session-1'] },
    );
    expect(
      referencedIds(
        entry({
          tableName: 'players',
          action: 'DELETE',
          sessionId: null,
          oldData: { id: 'player-9', name: 'Zoe' },
        }),
      ),
    ).toEqual({ playerIds: ['player-9'], sessionIds: [] });
  });
});
