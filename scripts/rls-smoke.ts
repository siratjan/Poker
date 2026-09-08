/**
 * rls-smoke — proves that an anonymous visitor (publishable key, no login)
 * cannot read or write anything.
 *
 *   npm run rls:smoke
 *
 * Runs against the cloud project from .env.local. It never logs in, so it can
 * only ever see what RLS lets `anon` see — which must be nothing.
 *
 * A check passes when the request is BLOCKED, which the API expresses in two
 * equally valid ways:
 *   - an error (permission denied / RLS violation), or
 *   - an empty result set (policy filtered everything away).
 * It fails when rows come back or a write succeeds.
 *
 * If the migrations were never applied, every table reports "does not exist".
 * The script then says so in one clear sentence and exits 1 instead of
 * pretending the database is secure.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { TABLE_NAMES } from '../src/lib/database.types';

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

function loadEnvLocal(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const key = match[1];
      const value = match[2].replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // no .env.local — fall back to the real environment
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error(
    'FEHLER: NEXT_PUBLIC_SUPABASE_URL oder NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY fehlt.\n' +
      'Lege .env.local nach dem Muster von .env.example an (Werte siehe docs/SPEC.md).',
  );
  process.exit(2);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// result plumbing
// ---------------------------------------------------------------------------

type Verdict = 'blocked' | 'leak' | 'missing';

type Check = {
  what: string;
  verdict: Verdict;
  detail: string;
};

const checks: Check[] = [];

type PostgrestErrorLike = { code?: string; message?: string } | null;

/** True when the error means "this relation/function is not in the database". */
function isMissing(error: PostgrestErrorLike): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const message = (error.message ?? '').toLowerCase();
  return (
    code === '42P01' || // undefined_table
    code === '42883' || // undefined_function
    code === 'PGRST202' || // function not found in schema cache
    code === 'PGRST205' || // table not found in schema cache
    message.includes('does not exist') ||
    message.includes('schema cache')
  );
}

function record(what: string, error: PostgrestErrorLike, rowCount: number | null): void {
  if (isMissing(error)) {
    checks.push({ what, verdict: 'missing', detail: error?.message ?? 'not found' });
    return;
  }
  if (error) {
    checks.push({ what, verdict: 'blocked', detail: `${error.code ?? '-'}: ${error.message}` });
    return;
  }
  if (rowCount === null || rowCount === 0) {
    checks.push({ what, verdict: 'blocked', detail: '0 Zeilen' });
    return;
  }
  checks.push({ what, verdict: 'leak', detail: `${rowCount} Zeile(n) sichtbar` });
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

/** Minimal, schema-valid payloads — a rejection must come from RLS, not a check constraint. */
const INSERT_PAYLOAD: Record<string, Record<string, unknown>> = {
  role_whitelist: { email: 'rls.smoke@example.invalid', role: 'admin' },
  app_users: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'rls.smoke@example.invalid',
    role: 'admin',
  },
  players: { name: 'RLS Smoke' },
  sessions: { played_on: '2000-01-01', name: 'RLS Smoke' },
  session_players: {
    session_id: '00000000-0000-4000-8000-000000000002',
    player_id: '00000000-0000-4000-8000-000000000003',
    position: 0,
  },
  entries: {
    session_id: '00000000-0000-4000-8000-000000000002',
    player_id: '00000000-0000-4000-8000-000000000003',
    type: 'buy_in',
    amount_cents: 10000,
    payment: 'cash',
  },
  settlements: {
    session_id: '00000000-0000-4000-8000-000000000002',
    algorithm_version: 1,
    total_buy_in_cents: 0,
    total_stack_cents: 0,
    discrepancy_cents: 0,
    cash_box_start_cents: 0,
    cash_box_after_payouts_cents: 0,
    unallocated_cash_cents: 0,
    uncovered_claims_cents: 0,
  },
  settlement_lines: {
    session_id: '00000000-0000-4000-8000-000000000002',
    player_id: '00000000-0000-4000-8000-000000000003',
    position: 0,
    cash_in_cents: 0,
    credit_in_cents: 0,
    stack_cents: 0,
    payout_cents: 0,
    is_cash_player: false,
    claim_cents: 0,
    cash_tier1_cents: 0,
    cash_tier2_cents: 0,
    cash_tier3_cents: 0,
    cash_from_box_cents: 0,
    net_result_cents: 0,
    residual_cents: 0,
  },
  settlement_transfers: {
    session_id: '00000000-0000-4000-8000-000000000002',
    position: 0,
    from_player_id: '00000000-0000-4000-8000-000000000003',
    to_player_id: '00000000-0000-4000-8000-000000000004',
    amount_cents: 100,
  },
  settings: { key: 'rls_smoke', value: [1] },
  audit_log: {
    table_name: 'rls_smoke',
    row_id: 'x',
    action: 'INSERT',
  },
};

async function run(): Promise<void> {
  for (const table of TABLE_NAMES) {
    const read = await supabase.from(table).select('*').limit(5);
    record(`select ${table}`, read.error, read.data ? read.data.length : null);

    const write = await supabase.from(table).insert(INSERT_PAYLOAD[table]).select();
    if (write.error) {
      record(`insert ${table}`, write.error, null);
    } else {
      checks.push({
        what: `insert ${table}`,
        verdict: 'leak',
        detail: 'Insert ohne Login erfolgreich — RLS greift nicht!',
      });
    }
  }

  const rpcs: { name: string; args: Record<string, unknown> }[] = [
    { name: 'settlement_input', args: { p_session_id: '00000000-0000-4000-8000-000000000002' } },
    {
      name: 'close_session',
      args: {
        p_session_id: '00000000-0000-4000-8000-000000000002',
        p_settlement: { algorithmVersion: 1, lines: [], transfers: [] },
        p_note: 'rls smoke',
      },
    },
    {
      name: 'reopen_session',
      args: { p_session_id: '00000000-0000-4000-8000-000000000002', p_reason: 'rls smoke' },
    },
    { name: 'is_admin', args: {} },
    { name: 'is_editor', args: {} },
  ];

  for (const rpc of rpcs) {
    const result = await supabase.rpc(rpc.name, rpc.args);
    if (result.error) {
      record(`rpc ${rpc.name}`, result.error, null);
    } else {
      // Even a harmless `false` from is_admin() is a leak here: EXECUTE is
      // revoked from anon, so the call must not get through at all.
      checks.push({
        what: `rpc ${rpc.name}`,
        verdict: 'leak',
        detail: `ohne Login aufrufbar (Ergebnis: ${JSON.stringify(result.data)})`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

function report(): number {
  const width = Math.max(...checks.map((c) => c.what.length));
  const icon: Record<Verdict, string> = { blocked: 'OK  ', leak: 'LECK', missing: 'FEHLT' };

  for (const check of checks) {
    console.log(`${icon[check.verdict].padEnd(6)} ${check.what.padEnd(width)}  ${check.detail}`);
  }

  const leaks = checks.filter((c) => c.verdict === 'leak');
  const missing = checks.filter((c) => c.verdict === 'missing');

  console.log('');
  console.log(
    `${checks.length} Prüfungen · ${checks.length - leaks.length - missing.length} geblockt · ` +
      `${leaks.length} Leck(s) · ${missing.length} nicht vorhanden`,
  );

  if (missing.length > 0) {
    console.log('');
    console.error(
      'ABBRUCH: Tabellen/Funktionen existieren nicht → die Migrationen sind noch nicht\n' +
        'eingespielt. Erst supabase/migrations/0001–0004 (und seed.sql) im SQL-Editor\n' +
        'oder per `npx supabase db push` einspielen, dann erneut `npm run rls:smoke`.\n' +
        'Anleitung: qa/handoffs/WP1-siri.md, Abschnitt „So spielt der Planer die Migrationen ein“.',
    );
    return 1;
  }

  if (leaks.length > 0) {
    console.log('');
    console.error(
      `FEHLGESCHLAGEN: ${leaks.length} Zugriff(e) ohne Login möglich:\n` +
        leaks.map((l) => `  - ${l.what}: ${l.detail}`).join('\n'),
    );
    return 1;
  }

  console.log('');
  console.log('OK: Ohne Login ist nichts lesbar und nichts schreibbar.');
  return 0;
}

run()
  .then(() => process.exit(report()))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      'ABBRUCH: Die Prüfung konnte nicht durchgeführt werden.\n' +
        `Grund: ${message}\n` +
        'Häufigste Ursachen: keine Internetverbindung, falsche NEXT_PUBLIC_SUPABASE_URL,\n' +
        'oder das Supabase-Projekt ist pausiert.',
    );
    process.exit(2);
  });
