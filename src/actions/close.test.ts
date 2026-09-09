import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/getCurrentUser';
import type { Role } from '@/lib/auth/roles';
import { computeSettlement } from '@/lib/settlement';
import { toSettlementPayload } from '@/lib/settlement/toPersist';

/**
 * Unit tests for the close/reopen server actions (docs/ARBEITSPAKETE.md WP6,
 * step 1 and Testauftrag Gaby).
 *
 * The point of these tests is the sentence from the work package: the action
 * **always computes the settlement itself** from `settlement_input` and never
 * forwards anything the client sent. Supabase and the current user are mocked;
 * the database itself is Gaby's.
 */

type DbResult = { data: unknown; error: unknown };

const getCurrentUser = vi.hoisted(() => vi.fn<() => Promise<CurrentUser | null>>());
vi.mock('@/lib/auth/getCurrentUser', () => ({ getCurrentUser }));

const rpc = vi.hoisted(() => vi.fn<(name: string, args: unknown) => Promise<DbResult>>());
const createClient = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({ createClient }));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { closeSession, previewSettlement, reopenSession } = await import('./close');

const SESSION = '33333333-3333-4333-8333-333333333333';
const ALI = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
const CAN = '44444444-4444-4444-8444-444444444444';

type InputRow = {
  player_id: string;
  player_name: string;
  position: number;
  cash_in_cents: number;
  credit_in_cents: number;
  stack_cents: number;
  payout_cents: number;
  has_cash_out: boolean;
};

function row(
  playerId: string,
  name: string,
  position: number,
  values: Partial<Omit<InputRow, 'player_id' | 'player_name' | 'position'>> = {},
): InputRow {
  return {
    player_id: playerId,
    player_name: name,
    position,
    cash_in_cents: 0,
    credit_in_cents: 0,
    stack_cents: 0,
    payout_cents: 0,
    has_cash_out: true,
    ...values,
  };
}

/** TV2 of docs/SETTLEMENT.md: Ali 100 bar/200, Ben 100 bar/40, Can 100 Liste/60. */
const TV2: InputRow[] = [
  row(ALI, 'Ali', 0, { cash_in_cents: 10000, stack_cents: 20000 }),
  row(BEN, 'Ben', 1, { cash_in_cents: 10000, stack_cents: 4000 }),
  row(CAN, 'Can', 2, { credit_in_cents: 10000, stack_cents: 6000 }),
];

function asUser(role: Role): CurrentUser {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    email: 'test@example.test',
    displayName: 'Test',
    avatarUrl: null,
    role,
  };
}

/** `settlement_input` answers with `rows`; the write RPCs answer with `write`. */
function setDb(rows: InputRow[] | DbResult, write: DbResult = { data: null, error: null }) {
  rpc.mockImplementation((name) => {
    if (name === 'settlement_input') {
      return Promise.resolve(
        Array.isArray(rows) ? { data: rows, error: null } : (rows as DbResult),
      );
    }
    return Promise.resolve(write);
  });
  createClient.mockResolvedValue({ rpc });
}

/** The arguments the given RPC was called with, or `null`. */
function callTo(name: string): Record<string, unknown> | null {
  const call = rpc.mock.calls.find((entry) => entry[0] === name);
  return call === undefined ? null : (call[1] as Record<string, unknown>);
}

function dbError(message: string): DbResult {
  return { data: null, error: { message, code: 'P0001', details: '', hint: '' } };
}

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

describe('Rollen', () => {
  it('previewSettlement braucht einen Login, mehr nicht', async () => {
    getCurrentUser.mockResolvedValue(null);
    setDb(TV2);
    expect((await previewSettlement({ sessionId: SESSION })).ok).toBe(false);

    getCurrentUser.mockResolvedValue(asUser('viewer'));
    const result = await previewSettlement({ sessionId: SESSION });
    expect(result.ok).toBe(true);
  });

  it('closeSession verlangt mindestens Bearbeiter', async () => {
    setDb(TV2);
    for (const user of [null, asUser('viewer')]) {
      getCurrentUser.mockResolvedValue(user);
      const result = await closeSession({ sessionId: SESSION });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(['UNAUTHENTICATED', 'FORBIDDEN']).toContain(result.error.code);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reopenSession verlangt Admin', async () => {
    setDb(TV2);
    for (const role of ['viewer', 'editor'] as const) {
      getCurrentUser.mockResolvedValue(asUser(role));
      const result = await reopenSession({ sessionId: SESSION, reason: 'Stack falsch' });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('FORBIDDEN');
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The settlement is always computed on the server
// ---------------------------------------------------------------------------

describe('die Abrechnung kommt immer vom Server', () => {
  it('reicht kein vom Client geliefertes Ergebnis durch', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb(TV2);

    // A manipulated client sends its own settlement: Can keeps 60 € cash and
    // Ali is sent home with a promise. It must be ignored completely.
    const forged = toSettlementPayload(
      computeSettlement([
        { playerId: ALI, name: 'Ali', position: 0, cashIn: 10000, creditIn: 0, stack: 20000, payout: 0 },
        { playerId: BEN, name: 'Ben', position: 1, cashIn: 10000, creditIn: 0, stack: 4000, payout: 0 },
        { playerId: CAN, name: 'Can', position: 2, cashIn: 0, creditIn: 10000, stack: 6000, payout: 0 },
      ]),
    );
    forged.lines[0].cashFromBox = 0;
    forged.transfers = [{ fromPlayerId: ALI, toPlayerId: CAN, amount: 99999 }];

    const result = await closeSession({
      sessionId: SESSION,
      settlement: forged,
      totalBuyIn: 1,
      lines: forged.lines,
    });

    expect(result.ok).toBe(true);

    const args = callTo('close_session');
    expect(args).not.toBeNull();
    // Exactly what the server computes from settlement_input, nothing else.
    const expected = toSettlementPayload(
      computeSettlement(
        TV2.map((entry) => ({
          playerId: entry.player_id,
          name: entry.player_name,
          position: entry.position,
          cashIn: entry.cash_in_cents,
          creditIn: entry.credit_in_cents,
          stack: entry.stack_cents,
          payout: entry.payout_cents,
        })),
      ),
    );
    expect(args?.p_settlement).toEqual(expected);
    expect(args?.p_settlement).not.toEqual(forged);
  });

  it('schickt genau die drei Argumente der RPC', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb(TV2);

    await closeSession({ sessionId: SESSION });
    expect(Object.keys(callTo('close_session') ?? {}).sort()).toEqual([
      'p_note',
      'p_session_id',
      'p_settlement',
    ]);
  });

  it('rechnet TV2 korrekt: Ali 160 € bar, Can schuldet Ali 40 €', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb(TV2);

    const preview = await previewSettlement({ sessionId: SESSION });
    expect(preview.ok).toBe(true);
    if (!preview.ok || preview.data.settlement === null) throw new Error('keine Vorschau');

    expect(preview.data.settlement.lines.map((line) => line.cashFromBox)).toEqual([16000, 4000, 0]);
    expect(preview.data.settlement.transfers).toEqual([
      { fromPlayerId: CAN, toPlayerId: ALI, amount: 4000 },
    ]);
    expect(preview.data.discrepancyCents).toBe(0);
    expect(preview.data.names).toEqual({ [ALI]: 'Ali', [BEN]: 'Ben', [CAN]: 'Can' });
  });
});

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

describe('Vorbedingungen', () => {
  it('ohne Stacks wird nicht abgeschlossen und nichts geschrieben', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb([
      row(ALI, 'Ali', 0, { cash_in_cents: 10000, has_cash_out: false }),
      row(BEN, 'Ben', 1, { cash_in_cents: 10000, has_cash_out: false }),
      row(CAN, 'Can', 2, { cash_in_cents: 10000, stack_cents: 30000 }),
    ]);

    const result = await closeSession({ sessionId: SESSION });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_CASH_OUT');
      expect(result.error.message).toBe('Es fehlen noch die Stacks von Ali und Ben.');
    }
    expect(callTo('close_session')).toBeNull();
  });

  it('nennt den einen fehlenden Spieler beim Namen', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb([
      row(ALI, 'Ali', 0, { cash_in_cents: 10000, has_cash_out: false }),
      row(BEN, 'Ben', 1, { cash_in_cents: 10000, stack_cents: 20000 }),
    ]);

    const result = await closeSession({ sessionId: SESSION });
    if (result.ok) throw new Error('hätte scheitern müssen');
    expect(result.error.message).toBe('Es fehlt noch der Stack von Ali.');
  });

  it('ohne Teilnehmer gibt es nichts abzuschließen', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb([]);

    const result = await closeSession({ sessionId: SESSION });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NO_PARTICIPANTS');
    expect(callTo('close_session')).toBeNull();
  });

  it('previewSettlement meldet fehlende Stacks statt eine Abrechnung zu erfinden', async () => {
    getCurrentUser.mockResolvedValue(asUser('viewer'));
    setDb([
      row(ALI, 'Ali', 0, { cash_in_cents: 10000, stack_cents: 20000 }),
      row(BEN, 'Ben', 1, { cash_in_cents: 10000, has_cash_out: false }),
    ]);

    const result = await previewSettlement({ sessionId: SESSION });
    if (!result.ok) throw new Error('Vorschau fehlgeschlagen');

    expect(result.data.canClose).toBe(false);
    expect(result.data.settlement).toBeNull();
    expect(result.data.missingCashOuts).toEqual([{ playerId: BEN, name: 'Ben' }]);
    expect(result.data.totalBuyInCents).toBe(20000);
    expect(result.data.totalStackCents).toBe(20000);
  });

  it('eine ungültige Session-Id kommt gar nicht erst zur Datenbank', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb(TV2);

    for (const action of [previewSettlement, closeSession]) {
      const result = await action({ sessionId: 'nope' });
      expect(result.ok).toBe(false);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Difference: admin plus comment (SPEC 5.5)
// ---------------------------------------------------------------------------

describe('Differenz', () => {
  /** Ali counted 10 € less than was bought in. */
  const withDiscrepancy: InputRow[] = [
    row(ALI, 'Ali', 0, { cash_in_cents: 10000, stack_cents: 9000 }),
    row(BEN, 'Ben', 1, { cash_in_cents: 10000, stack_cents: 10000 }),
  ];

  it('ein Bearbeiter kann mit Differenz nicht abschließen', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb(withDiscrepancy);

    const result = await closeSession({ sessionId: SESSION, note: 'Chip verloren' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DISCREPANCY_REQUIRES_ADMIN_NOTE');
    expect(callTo('close_session')).toBeNull();
  });

  it('ein Admin ohne Kommentar auch nicht', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb(withDiscrepancy);

    for (const note of [undefined, '', '  ', 'ok']) {
      const result = await closeSession({ sessionId: SESSION, note });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('DISCREPANCY_REQUIRES_ADMIN_NOTE');
    }
    expect(callTo('close_session')).toBeNull();
  });

  it('ein Admin mit Kommentar schließt ab, der Kommentar wird getrimmt', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb(withDiscrepancy);

    const result = await closeSession({ sessionId: SESSION, note: '  Ein Chip lag am Boden  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.discrepancyCents).toBe(-1000);
    expect(callTo('close_session')?.p_note).toBe('Ein Chip lag am Boden');
  });

  it('ohne Differenz wird kein Kommentar verlangt und keiner erfunden', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb(TV2);

    const result = await closeSession({ sessionId: SESSION });
    expect(result.ok).toBe(true);
    expect(callTo('close_session')?.p_note).toBeNull();
  });

  it('ein zu langer Kommentar wird abgelehnt, bevor geschrieben wird', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb(withDiscrepancy);

    const result = await closeSession({ sessionId: SESSION, note: 'x'.repeat(301) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    expect(callTo('close_session')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Database errors become German sentences
// ---------------------------------------------------------------------------

describe('Fehler der Datenbank', () => {
  it('SETTLEMENT_MISMATCH wird zu „Daten haben sich geändert“', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb(TV2, dbError('SETTLEMENT_MISMATCH'));

    const result = await closeSession({ sessionId: SESSION });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SETTLEMENT_MISMATCH');
      expect(result.error.message).toBe('Die Daten haben sich geändert. Bitte noch einmal prüfen.');
    }
  });

  it('SESSION_CLOSED beim Wettlauf zweier Abschlüsse', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb(TV2, dbError('SESSION_CLOSED'));

    const result = await closeSession({ sessionId: SESSION });
    if (result.ok) throw new Error('hätte scheitern müssen');
    expect(result.error.code).toBe('SESSION_CLOSED');
    expect(result.error.message).toBe(
      'Diese Session ist abgeschlossen und kann nicht mehr geändert werden.',
    );
  });

  it('roher Postgres-Text erreicht den Browser nie', async () => {
    getCurrentUser.mockResolvedValue(asUser('editor'));
    setDb(TV2, {
      data: null,
      error: { message: 'null value in column "x" violates not-null constraint', code: '23502' },
    });

    const result = await closeSession({ sessionId: SESSION });
    if (result.ok) throw new Error('hätte scheitern müssen');
    expect(result.error.code).toBe('UNEXPECTED');
    expect(result.error.message).not.toContain('null value');
  });

  it('ein Fehler beim Lesen von settlement_input schreibt nichts', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb(dbError('FORBIDDEN'));

    const result = await closeSession({ sessionId: SESSION });
    expect(result.ok).toBe(false);
    expect(callTo('close_session')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reopen
// ---------------------------------------------------------------------------

describe('reopenSession', () => {
  it('verlangt einen Grund von mindestens drei Zeichen', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb(TV2);

    for (const reason of ['', '  ', 'ok']) {
      const result = await reopenSession({ sessionId: SESSION, reason });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    }
    expect(callTo('reopen_session')).toBeNull();
  });

  it('ruft die RPC mit dem getrimmten Grund', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb(TV2);

    const result = await reopenSession({ sessionId: SESSION, reason: '  Stack war falsch  ' });
    expect(result.ok).toBe(true);
    expect(callTo('reopen_session')).toEqual({
      p_session_id: SESSION,
      p_reason: 'Stack war falsch',
    });
  });

  it('übersetzt SESSION_NOT_CLOSED', async () => {
    getCurrentUser.mockResolvedValue(asUser('admin'));
    setDb(TV2, dbError('SESSION_NOT_CLOSED'));

    const result = await reopenSession({ sessionId: SESSION, reason: 'Versehen' });
    if (result.ok) throw new Error('hätte scheitern müssen');
    expect(result.error.message).toBe('Diese Session ist gar nicht abgeschlossen.');
  });
});
