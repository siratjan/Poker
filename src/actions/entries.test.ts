import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '@/lib/auth/getCurrentUser';
import type { Role } from '@/lib/auth/roles';

/**
 * Unit tests for the entry server actions (docs/ARBEITSPAKETE.md WP5, step 1):
 * role guard, zod bounds, and the translation of the trigger codes into German.
 * Supabase and the current user are mocked; the database itself is Gaby's.
 */

type DbResult = { data: unknown; error: unknown };

interface Builder extends PromiseLike<DbResult> {
  insert: (...args: unknown[]) => Builder;
  update: (...args: unknown[]) => Builder;
  delete: (...args: unknown[]) => Builder;
  eq: (...args: unknown[]) => Builder;
  select: (...args: unknown[]) => Builder;
  order: (...args: unknown[]) => Builder;
  limit: (...args: unknown[]) => Builder;
  single: () => Promise<DbResult>;
  maybeSingle: () => Promise<DbResult>;
}

/** A `from()` that answers per table, so multi-step actions can be scripted. */
function builderFor(next: () => DbResult): Builder {
  const builder: Builder = {
    insert: () => builder,
    update: () => builder,
    delete: () => builder,
    eq: () => builder,
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    single: () => Promise.resolve(next()),
    maybeSingle: () => Promise.resolve(next()),
    then: (onFulfilled, onRejected) => Promise.resolve(next()).then(onFulfilled, onRejected),
  };
  return builder;
}

const getCurrentUser = vi.hoisted(() => vi.fn<() => Promise<CurrentUser | null>>());
vi.mock('@/lib/auth/getCurrentUser', () => ({ getCurrentUser }));

const createClient = vi.hoisted(() =>
  vi.fn<() => Promise<{ from: (table: string) => Builder }>>(),
);
vi.mock('@/lib/supabase/server', () => ({ createClient }));

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));

const {
  addBuyIn,
  addCashOut,
  addParticipant,
  addParticipantByNewPlayer,
  addPayout,
  deleteEntry,
  removeParticipant,
  updateCashOut,
} = await import('./entries');

const SESSION = '33333333-3333-4333-8333-333333333333';
const PLAYER = '11111111-1111-4111-8111-111111111111';
const ENTRY = '44444444-4444-4444-8444-444444444444';

function asUser(role: Role): CurrentUser {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    email: 'test@example.test',
    displayName: 'Test',
    avatarUrl: null,
    role,
  };
}

/** Every query answers the same result. */
function setDb(result: DbResult) {
  createClient.mockResolvedValue({ from: () => builderFor(() => result) });
}

/** Results are handed out in order, one per awaited query. */
function setDbSequence(results: DbResult[]) {
  let index = 0;
  createClient.mockResolvedValue({
    from: () => builderFor(() => results[Math.min(index++, results.length - 1)]),
  });
}

function editor() {
  getCurrentUser.mockResolvedValue(asUser('editor'));
}

afterEach(() => {
  getCurrentUser.mockReset();
  createClient.mockReset();
  revalidatePath.mockReset();
});

describe('role guard', () => {
  const cases: [string, () => Promise<{ ok: boolean }>][] = [
    ['addParticipant', () => addParticipant({ sessionId: SESSION, playerId: PLAYER })],
    [
      'addParticipantByNewPlayer',
      () => addParticipantByNewPlayer({ sessionId: SESSION, name: 'Ali' }),
    ],
    ['removeParticipant', () => removeParticipant({ sessionId: SESSION, playerId: PLAYER })],
    [
      'addBuyIn',
      () => addBuyIn({ sessionId: SESSION, playerId: PLAYER, amountCents: 10000, payment: 'cash' }),
    ],
    ['addCashOut', () => addCashOut({ sessionId: SESSION, playerId: PLAYER, amountCents: 10000 })],
    ['updateCashOut', () => updateCashOut({ id: ENTRY, sessionId: SESSION, amountCents: 1 })],
    ['addPayout', () => addPayout({ sessionId: SESSION, playerId: PLAYER, amountCents: 100 })],
    ['deleteEntry', () => deleteEntry({ id: ENTRY, sessionId: SESSION })],
  ];

  it.each(cases)('%s refuses a viewer and never touches the database', async (_name, call) => {
    getCurrentUser.mockResolvedValue(asUser('viewer'));

    const result = await call();

    expect(result.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(cases)('%s refuses a signed-out visitor', async (_name, call) => {
    getCurrentUser.mockResolvedValue(null);

    const result = await call();

    expect(result.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('amount validation', () => {
  it('rejects a buy-in of 0', async () => {
    editor();

    const result = await addBuyIn({
      sessionId: SESSION,
      playerId: PLAYER,
      amountCents: 0,
      payment: 'cash',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects a non-integer amount (no floats in a money path)', async () => {
    editor();

    const result = await addBuyIn({
      sessionId: SESSION,
      playerId: PLAYER,
      amountCents: 100.5,
      payment: 'cash',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
  });

  it('rejects an amount above 1.000.000 cents with a German message', async () => {
    editor();

    const result = await addBuyIn({
      sessionId: SESSION,
      playerId: PLAYER,
      amountCents: 1_000_001,
      payment: 'cash',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('10.000,00 €');
  });

  it('accepts exactly 1.000.000 cents', async () => {
    editor();
    setDb({ data: { id: ENTRY }, error: null });

    const result = await addBuyIn({
      sessionId: SESSION,
      playerId: PLAYER,
      amountCents: 1_000_000,
      payment: 'cash',
    });

    expect(result.ok).toBe(true);
  });

  it('accepts a cash-out of 0 but rejects a negative one', async () => {
    editor();
    setDb({ data: { id: ENTRY }, error: null });

    const zero = await addCashOut({ sessionId: SESSION, playerId: PLAYER, amountCents: 0 });
    const negative = await addCashOut({ sessionId: SESSION, playerId: PLAYER, amountCents: -1 });

    expect(zero.ok).toBe(true);
    expect(negative.ok).toBe(false);
  });

  it('rejects a payout of 0', async () => {
    editor();

    const result = await addPayout({ sessionId: SESSION, playerId: PLAYER, amountCents: 0 });

    expect(result.ok).toBe(false);
  });

  it('rejects an unknown payment method', async () => {
    editor();

    const result = await addBuyIn({
      sessionId: SESSION,
      playerId: PLAYER,
      amountCents: 100,
      payment: 'paypal',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
  });

  it('rejects an id that is not a uuid', async () => {
    editor();

    const result = await addBuyIn({
      sessionId: 'not-a-uuid',
      playerId: PLAYER,
      amountCents: 100,
      payment: 'cash',
    });

    expect(result.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('trigger error translation', () => {
  const cases: [string, string][] = [
    ['SESSION_CLOSED', 'abgeschlossen'],
    ['PLAYER_ALREADY_CASHED_OUT', 'ausgestiegen'],
    ['PAYOUT_EXCEEDS_STACK', 'Stack'],
    ['PAYOUT_EXCEEDS_CASHBOX', 'Kasse'],
    ['PAYOUT_REQUIRES_CASH_OUT', 'Stack'],
    ['STACK_BELOW_PAYOUT', 'bar'],
  ];

  it.each(cases)('%s becomes a German message', async (code, fragment) => {
    editor();
    setDb({ data: null, error: { code: 'P0001', message: code, details: '', hint: '' } });

    const result = await addPayout({ sessionId: SESSION, playerId: PLAYER, amountCents: 5000 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe(code);
      expect(result.error.message).toContain(fragment);
      expect(result.error.message).not.toContain(code);
    }
  });

  it('answers generically for an unknown database error', async () => {
    editor();
    setDb({
      data: null,
      error: { code: '08006', message: 'connection to server lost', details: '', hint: '' },
    });

    const result = await addBuyIn({
      sessionId: SESSION,
      playerId: PLAYER,
      amountCents: 100,
      payment: 'cash',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNEXPECTED');
      expect(result.error.message).not.toContain('connection');
    }
  });

  it('translates CASH_OUT_HAS_PAYOUT when deleting a stack', async () => {
    editor();
    setDb({
      data: null,
      error: { code: 'P0001', message: 'CASH_OUT_HAS_PAYOUT', details: '', hint: '' },
    });

    const result = await deleteEntry({ id: ENTRY, sessionId: SESSION });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('CASH_OUT_HAS_PAYOUT');
  });
});

describe('addBuyIn', () => {
  it('records the entry and revalidates the session page', async () => {
    editor();
    setDb({ data: { id: ENTRY }, error: null });

    const result = await addBuyIn({
      sessionId: SESSION,
      playerId: PLAYER,
      amountCents: 10000,
      payment: 'credit',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe(ENTRY);
    expect(revalidatePath).toHaveBeenCalledWith(`/sessions/${SESSION}`);
  });
});

describe('updateCashOut', () => {
  it('reports a missing row instead of pretending success', async () => {
    editor();
    setDb({ data: null, error: null });

    const result = await updateCashOut({ id: ENTRY, sessionId: SESSION, amountCents: 5000 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ENTRY_NOT_FOUND');
  });

  it('translates STACK_BELOW_PAYOUT', async () => {
    editor();
    setDb({
      data: null,
      error: { code: 'P0001', message: 'STACK_BELOW_PAYOUT', details: '', hint: '' },
    });

    const result = await updateCashOut({ id: ENTRY, sessionId: SESSION, amountCents: 100 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('STACK_BELOW_PAYOUT');
  });
});

describe('deleteEntry', () => {
  it('reports ENTRY_NOT_FOUND when the row was filtered out', async () => {
    editor();
    setDb({ data: [], error: null });

    const result = await deleteEntry({ id: ENTRY, sessionId: SESSION });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ENTRY_NOT_FOUND');
  });

  it('deletes an entry of the session', async () => {
    editor();
    setDb({ data: [{ id: ENTRY }], error: null });

    const result = await deleteEntry({ id: ENTRY, sessionId: SESSION });

    expect(result.ok).toBe(true);
  });
});

describe('addParticipant', () => {
  it('assigns the next position after the highest one', async () => {
    editor();
    setDbSequence([
      { data: { position: 3 }, error: null }, // highest position so far
      { data: null, error: null }, // insert
    ]);

    const result = await addParticipant({ sessionId: SESSION, playerId: PLAYER });

    expect(result.ok).toBe(true);
  });

  it('starts at position 1 in an empty session', async () => {
    editor();
    setDbSequence([
      { data: null, error: null }, // no participant yet
      { data: null, error: null },
    ]);

    const result = await addParticipant({ sessionId: SESSION, playerId: PLAYER });

    expect(result.ok).toBe(true);
  });

  it('reports a duplicate participant readably', async () => {
    editor();
    setDbSequence([
      { data: { position: 1 }, error: null },
      {
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "session_players_pkey"',
          details: 'Key (session_id, player_id) already exists.',
          hint: '',
        },
      },
    ]);

    const result = await addParticipant({ sessionId: SESSION, playerId: PLAYER });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PLAYER_ALREADY_IN_SESSION');
      expect(result.error.message).toBe('Dieser Spieler ist schon dabei.');
    }
  });

  it('retries once when two devices grabbed the same position', async () => {
    editor();
    setDbSequence([
      { data: { position: 1 }, error: null },
      {
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "session_players_session_id_position_key"',
          details: 'Key (session_id, position) already exists.',
          hint: '',
        },
      },
      { data: { position: 2 }, error: null },
      { data: null, error: null },
    ]);

    const result = await addParticipant({ sessionId: SESSION, playerId: PLAYER });

    expect(result.ok).toBe(true);
  });

  it('translates SESSION_CLOSED from the insert policy', async () => {
    editor();
    setDbSequence([
      { data: null, error: null },
      { data: null, error: { code: 'P0001', message: 'SESSION_CLOSED', details: '', hint: '' } },
    ]);

    const result = await addParticipant({ sessionId: SESSION, playerId: PLAYER });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('SESSION_CLOSED');
  });
});

describe('addParticipantByNewPlayer', () => {
  it('rejects an empty name before touching the database', async () => {
    editor();

    const result = await addParticipantByNewPlayer({ sessionId: SESSION, name: '   ' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VALIDATION');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('reports an existing player name readably', async () => {
    editor();
    setDb({
      data: null,
      error: { code: '23505', message: 'duplicate key', details: 'name_normalized', hint: '' },
    });

    const result = await addParticipantByNewPlayer({ sessionId: SESSION, name: 'Ali' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PLAYER_EXISTS');
  });

  it('creates the player and joins him to the session', async () => {
    editor();
    setDbSequence([
      { data: { id: PLAYER }, error: null }, // players insert
      { data: { position: 2 }, error: null }, // highest position
      { data: null, error: null }, // session_players insert
    ]);

    const result = await addParticipantByNewPlayer({ sessionId: SESSION, name: 'Ali' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.playerId).toBe(PLAYER);
  });
});

describe('removeParticipant', () => {
  it('translates PLAYER_HAS_ENTRIES', async () => {
    editor();
    setDb({
      data: null,
      error: { code: 'P0001', message: 'PLAYER_HAS_ENTRIES', details: '', hint: '' },
    });

    const result = await removeParticipant({ sessionId: SESSION, playerId: PLAYER });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PLAYER_HAS_ENTRIES');
      expect(result.error.message).toContain('Einträge');
    }
  });

  it('reports a row the policy filtered out', async () => {
    editor();
    setDb({ data: [], error: null });

    const result = await removeParticipant({ sessionId: SESSION, playerId: PLAYER });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PARTICIPANT_NOT_FOUND');
  });

  it('removes a participant without entries', async () => {
    editor();
    setDb({ data: [{ player_id: PLAYER }], error: null });

    const result = await removeParticipant({ sessionId: SESSION, playerId: PLAYER });

    expect(result.ok).toBe(true);
  });
});
