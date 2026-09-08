/**
 * WP1 — statische Prüfung der Datenbank-Migrationen.
 *
 * Die Datenbank ist (Stand WP1) nicht eingespielt, es gibt weder psql noch
 * Docker. Diese Tests können deshalb kein SQL ausführen. Sie frieren stattdessen
 * die sicherheitsrelevanten Eigenschaften der Migrationsdateien ein, damit ein
 * späteres Paket (0005 in WP2, Views in WP4/WP7, …) sie nicht unbemerkt
 * aufweicht:
 *
 *   - RLS ist auf jeder Tabelle an, jede Policy gilt nur `to authenticated`
 *   - kein Schreibrecht ohne is_editor()/is_admin(), anon hat gar nichts
 *   - audit_log ist nur lesbar
 *   - jede SECURITY-DEFINER-Funktion setzt `search_path`
 *   - execute auf den RPCs ist anon/public entzogen
 *   - Migrationen sind ein zweites Mal ausführbar (if not exists / drop … if exists)
 *   - Geld ist überall `integer` (Cent), nie numeric/float
 *   - die 22 Fehlercodes der Trigger sind vollständig bekannt (WP5 braucht für
 *     jeden eine deutsche Meldung) — ein neuer Code lässt diesen Test scheitern
 *   - database.types.ts passt zu den Tabellen und Enums der Migration
 *   - seed.sql enthält keine echte E-Mail-Adresse
 *
 * Quelle der Wahrheit: docs/ARBEITSPAKETE.md (WP1), docs/SPEC.md §3–§5.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url)), 'utf8');
}

const schemaSql = read('supabase/migrations/0001_schema.sql');
const functionsSql = read('supabase/migrations/0002_functions_triggers.sql');
const rlsSql = read('supabase/migrations/0003_rls.sql');
const realtimeSql = read('supabase/migrations/0004_realtime.sql');
const seedSql = read('supabase/seed.sql');
const typesTs = read('src/lib/database.types.ts');

const MIGRATIONS: readonly (readonly [string, string])[] = [
  ['0001_schema.sql', schemaSql],
  ['0002_functions_triggers.sql', functionsSql],
  ['0003_rls.sql', rlsSql],
  ['0004_realtime.sql', realtimeSql],
];

/** Alle Tabellen des Pakets (Plan WP1 Schritt 1). */
const TABLES = [
  'role_whitelist',
  'app_users',
  'players',
  'sessions',
  'session_players',
  'entries',
  'settlements',
  'settlement_lines',
  'settlement_transfers',
  'settings',
  'audit_log',
] as const;

/** Aufrufbare Funktionen, für die es explizite Grants geben muss. */
const CALLABLE_FUNCTIONS = [
  'close_session',
  'reopen_session',
  'settlement_input',
  'current_app_role',
  'is_admin',
  'is_editor',
  'session_is_open',
] as const;

/** Fehlercodes, die die Trigger/RPCs werfen. WP5 braucht je eine deutsche Meldung. */
const KNOWN_ERROR_CODES = [
  'CASH_OUT_HAS_PAYOUT',
  'DISCREPANCY_REQUIRES_ADMIN_NOTE',
  // Runde 2 (F3): validate_entry sperrt session_id/player_id/type gegen UPDATE
  'ENTRY_IMMUTABLE_KEYS',
  'FORBIDDEN',
  'IMMUTABLE_FIELD',
  'LAST_ADMIN',
  'MISSING_CASH_OUT',
  'NO_PARTICIPANTS',
  'ONLY_ROLE_EDITABLE',
  'PAYOUT_EXCEEDS_CASHBOX',
  'PAYOUT_EXCEEDS_STACK',
  'PAYOUT_REQUIRES_CASH_OUT',
  'PLAYER_ALREADY_CASHED_OUT',
  'PLAYER_HAS_ENTRIES',
  'REASON_REQUIRED',
  'SESSION_CLOSED',
  'SESSION_NOT_CLOSED',
  'SESSION_NOT_FOUND',
  'SETTLEMENT_INVARIANT',
  'SETTLEMENT_MISMATCH',
  'STACK_BELOW_PAYOUT',
  'USE_RPC',
] as const;

type Policy = { name: string; table: string; statement: string };

/** Zerlegt 0003 in einzelne `create policy … ;`-Anweisungen. */
function parsePolicies(sql: string): Policy[] {
  const result: Policy[] = [];
  const re = /create policy\s+(\w+)\s+on\s+public\.(\w+)([\s\S]*?);/g;
  let match: RegExpExecArray | null = re.exec(sql);
  while (match !== null) {
    result.push({ name: match[1], table: match[2], statement: match[0] });
    match = re.exec(sql);
  }
  return result;
}

/** Zerlegt 0002 in Funktionsköpfe (alles bis zum Body-Anfang `as $$`). */
function parseFunctionHeaders(sql: string): { name: string; header: string }[] {
  const result: { name: string; header: string }[] = [];
  const re = /create (?:or replace )?function\s+public\.(\w+)\s*\(([\s\S]*?)\bas\s\$\$/g;
  let match: RegExpExecArray | null = re.exec(sql);
  while (match !== null) {
    result.push({ name: match[1], header: match[0] });
    match = re.exec(sql);
  }
  return result;
}

const policies = parsePolicies(rlsSql);
const functionHeaders = parseFunctionHeaders(functionsSql);

// ---------------------------------------------------------------------------
// 0001 — Schema
// ---------------------------------------------------------------------------

describe('0001_schema.sql', () => {
  it('legt alle elf Tabellen des Plans an', () => {
    for (const table of TABLES) {
      expect(schemaSql).toContain(`create table if not exists public.${table} (`);
    }
  });

  it('legt die vier Enums mit den Werten aus dem Plan an', () => {
    expect(schemaSql).toContain("create type public.app_role as enum ('admin', 'editor', 'viewer')");
    expect(schemaSql).toContain("create type public.session_status as enum ('open', 'closed')");
    expect(schemaSql).toContain(
      "create type public.entry_type as enum ('buy_in', 'cash_out', 'payout')",
    );
    expect(schemaSql).toContain("create type public.payment_method as enum ('cash', 'credit')");
  });

  it('erzwingt genau einen cash_out je Spieler und Session', () => {
    expect(schemaSql).toMatch(
      /create unique index if not exists entries_one_cash_out_per_player\s+on public\.entries \(session_id, player_id\) where type = 'cash_out'/,
    );
  });

  it('erzwingt payment genau bei buy_in und die Betragsvorzeichen', () => {
    expect(schemaSql).toContain("check ((type = 'buy_in') = (payment is not null))");
    expect(schemaSql).toMatch(/check \(\(type = 'cash_out' and amount_cents >= 0\)/);
    expect(schemaSql).toMatch(/or \(type <> 'cash_out' and amount_cents > 0\)\)/);
  });

  it('normalisiert Spielernamen und macht sie eindeutig (" ali " vs "Ali")', () => {
    expect(schemaSql).toContain('generated always as (lower(trim(name))) stored');
    expect(schemaSql).toContain(
      'create unique index if not exists players_name_normalized_key\n  on public.players (name_normalized)',
    );
    expect(schemaSql).toContain('check (length(trim(name)) between 1 and 40)');
  });

  it('friert die Abrechnung ein: settlements hat den Primärschlüssel session_id', () => {
    expect(schemaSql).toMatch(/settlements \(\s*\n\s*session_id\s+uuid primary key/);
  });

  it('speichert Geld ausschließlich als integer-Cent', () => {
    const moneyColumns = schemaSql
      .split('\n')
      .filter((line) => /^\s{2,}\w*_cents\s/.test(line));
    expect(moneyColumns.length).toBeGreaterThan(15);
    for (const line of moneyColumns) {
      expect(line).toMatch(/_cents\s+integer\b/);
    }
    expect(schemaSql).not.toMatch(/\b(numeric|decimal|real|double precision|money)\b/);
  });
});

// ---------------------------------------------------------------------------
// Idempotenz — ein zweites `db push` darf nicht scheitern (DoD WP1)
// ---------------------------------------------------------------------------

describe('Migrationen sind ein zweites Mal ausführbar', () => {
  it('legt keine Tabelle ohne "if not exists" an', () => {
    for (const [file, sql] of MIGRATIONS) {
      const all = sql.match(/create table/g)?.length ?? 0;
      const guarded = sql.match(/create table if not exists/g)?.length ?? 0;
      expect(`${file}: ${guarded}/${all}`).toBe(`${file}: ${all}/${all}`);
    }
  });

  it('legt keinen Index ohne "if not exists" an', () => {
    for (const [file, sql] of MIGRATIONS) {
      const all = sql.match(/create (?:unique )?index/g)?.length ?? 0;
      const guarded = sql.match(/create (?:unique )?index if not exists/g)?.length ?? 0;
      expect(`${file}: ${guarded}/${all}`).toBe(`${file}: ${all}/${all}`);
    }
  });

  it('kapselt jedes create type in einen do-Block mit duplicate_object', () => {
    const types = schemaSql.match(/create type/g)?.length ?? 0;
    const handlers = schemaSql.match(/exception when duplicate_object then null/g)?.length ?? 0;
    expect(handlers).toBe(types);
    expect(types).toBe(4);
  });

  it('droppt jeden Trigger vor dem Anlegen und ruft ihn mit "execute function" auf', () => {
    const created = functionsSql.match(/create trigger/g)?.length ?? 0;
    const dropped = functionsSql.match(/drop trigger if exists/g)?.length ?? 0;
    const executed = functionsSql.match(/for each row execute function/g)?.length ?? 0;
    // Runde 2 (F4): + 5 stamp_*-Trigger für created_by/added_by/updated_by
    expect(created).toBe(20);
    expect(dropped).toBe(created);
    expect(executed).toBe(created);
  });

  it('droppt jede Policy vor dem Anlegen', () => {
    expect(policies.length).toBe(28);
    for (const policy of policies) {
      expect(rlsSql).toContain(`drop policy if exists ${policy.name} on public.${policy.table};`);
    }
  });

  it('erneuert Funktionen per "create or replace" oder mit vorherigem drop', () => {
    for (const { name, header } of functionHeaders) {
      const replaced = header.startsWith('create or replace');
      const dropped = new RegExp(`drop function if exists public\\.${name}\\(`).test(functionsSql);
      expect(`${name}: ${replaced || dropped}`).toBe(`${name}: true`);
    }
  });

  it('fügt Realtime-Tabellen nur hinzu, wenn sie fehlen', () => {
    expect(realtimeSql).toContain('if not exists (');
    expect(realtimeSql).toContain("pubname = 'supabase_realtime'");
    for (const table of ['sessions', 'session_players', 'entries', 'players', 'settings']) {
      expect(realtimeSql).toContain(`'${table}'`);
    }
    expect(realtimeSql).toContain('alter table public.entries replica identity full;');
  });

  it('hat in jeder Datei ausbalancierte Dollar-Quotes', () => {
    for (const [file, sql] of MIGRATIONS) {
      const count = sql.match(/\$\$/g)?.length ?? 0;
      expect(`${file}: ${count % 2}`).toBe(`${file}: 0`);
    }
  });
});

// ---------------------------------------------------------------------------
// 0003 — RLS, Policies, Grants
// ---------------------------------------------------------------------------

describe('0003_rls.sql — Row Level Security', () => {
  it('schaltet RLS auf jeder Tabelle ein', () => {
    for (const table of TABLES) {
      expect(rlsSql).toMatch(
        new RegExp(`alter table public\\.${table}\\s+enable row level security;`),
      );
    }
  });

  it('entzieht anon jedes Tabellenrecht und legt keine Policy für anon an', () => {
    const revokeFromAnon = /revoke all on ([\s\S]*?)\s+from anon;/.exec(rlsSql);
    expect(revokeFromAnon).not.toBeNull();
    for (const table of TABLES) {
      expect(revokeFromAnon?.[1]).toContain(`public.${table}`);
    }
    expect(rlsSql).not.toMatch(/to anon/);
    expect(rlsSql).not.toMatch(/grant [\s\S]*? to anon/);
  });

  it('richtet jede Policy ausschließlich an authenticated', () => {
    for (const policy of policies) {
      expect(`${policy.name}: ${/\bto authenticated\b/.test(policy.statement)}`).toBe(
        `${policy.name}: true`,
      );
      expect(`${policy.name}: ${/\bto (anon|public)\b/.test(policy.statement)}`).toBe(
        `${policy.name}: false`,
      );
    }
  });

  it('lässt keinen Schreibzugriff ohne Rollenprüfung zu (Viewer schreibt nie)', () => {
    const writePolicies = policies.filter((p) => /for (insert|update|delete)/.test(p.statement));
    expect(writePolicies.length).toBeGreaterThan(0);
    for (const policy of writePolicies) {
      const guarded = /public\.is_(editor|admin)\(\)/.test(policy.statement);
      expect(`${policy.name}: ${guarded}`).toBe(`${policy.name}: true`);
    }
  });

  it('erlaubt Schreiben an Einträgen und Teilnehmern nur in offenen Sessions', () => {
    const guarded = policies.filter(
      (p) =>
        (p.table === 'entries' || p.table === 'session_players') &&
        /for (insert|update|delete)/.test(p.statement),
    );
    expect(guarded.length).toBe(5);
    for (const policy of guarded) {
      expect(`${policy.name}: ${policy.statement.includes('public.session_is_open(')}`).toBe(
        `${policy.name}: true`,
      );
    }
  });

  it('macht audit_log nur lesbar — für niemanden schreibbar (SPEC 4)', () => {
    const auditPolicies = policies.filter((p) => p.table === 'audit_log');
    expect(auditPolicies.map((p) => p.name)).toEqual(['audit_log_select']);
    expect(auditPolicies[0].statement).toContain('for select');
    expect(rlsSql).toContain('grant select                         on public.audit_log      to authenticated;');
    expect(rlsSql).not.toMatch(/grant [^;]*insert[^;]*on public\.audit_log/);
    expect(rlsSql).toContain('revoke all on sequence public.audit_log_id_seq from anon, authenticated;');
  });

  it('gibt settlements/_lines/_transfers nur zum Lesen frei (RPC schreibt)', () => {
    for (const table of ['settlements', 'settlement_lines', 'settlement_transfers']) {
      const tablePolicies = policies.filter((p) => p.table === table);
      expect(tablePolicies.map((p) => p.name)).toEqual([`${table}_select`]);
      expect(rlsSql).toMatch(
        new RegExp(`grant select\\s+on public\\.${table}\\s+to authenticated;`),
      );
    }
  });

  it('erlaubt das Löschen einer Session nur Admins, nur offen, nur ohne Abrechnung', () => {
    const sessionsDelete = policies.find((p) => p.name === 'sessions_delete');
    expect(sessionsDelete).toBeDefined();
    expect(sessionsDelete?.statement).toContain('public.is_admin()');
    expect(sessionsDelete?.statement).toContain("status = 'open'");
    expect(sessionsDelete?.statement).toContain('not exists (select 1 from public.settlements');
  });

  it('lässt keine Session direkt als "closed" anlegen', () => {
    const sessionsInsert = policies.find((p) => p.name === 'sessions_insert');
    expect(sessionsInsert?.statement).toContain("status = 'open'");
  });

  it('gibt app_users nur Admins zum Ändern frei und kennt kein insert/delete', () => {
    const appUsers = policies.filter((p) => p.table === 'app_users').map((p) => p.name);
    expect(appUsers.sort()).toEqual(['app_users_select', 'app_users_update']);
    const update = policies.find((p) => p.name === 'app_users_update');
    expect(update?.statement).toContain('public.is_admin()');
  });
});

// ---------------------------------------------------------------------------
// 0002 — Funktionen und Trigger
// ---------------------------------------------------------------------------

describe('0002_functions_triggers.sql — Funktionen', () => {
  it('setzt in jeder Funktion den search_path fest', () => {
    // Runde 2 (F4): + stamp_actor()
    expect(functionHeaders.length).toBe(16);
    for (const { name, header } of functionHeaders) {
      expect(`${name}: ${/set search_path = (public|pg_catalog, public)/.test(header)}`).toBe(
        `${name}: true`,
      );
    }
  });

  it('hat keine security-definer-Funktion ohne search_path', () => {
    for (const { name, header } of functionHeaders) {
      if (!header.includes('security definer')) continue;
      expect(`${name}: ${header.includes('set search_path')}`).toBe(`${name}: true`);
    }
  });

  it('entzieht anon und public das Ausführungsrecht und gibt es nur authenticated', () => {
    for (const fn of CALLABLE_FUNCTIONS) {
      expect(functionsSql).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon;`),
      );
      expect(functionsSql).toMatch(
        new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated;`),
      );
    }
  });

  it('legt den Audit-Trigger auf allen sieben Tabellen des Plans an', () => {
    for (const table of [
      'sessions',
      'session_players',
      'entries',
      'players',
      'app_users',
      'settings',
      'settlements',
    ]) {
      expect(functionsSql).toMatch(
        new RegExp(
          `create trigger audit_\\w+\\s+after insert or update or delete on public\\.${table}`,
        ),
      );
    }
  });

  it('kennt genau die 22 dokumentierten Fehlercodes (WP5 braucht je eine Meldung)', () => {
    const found = new Set(
      [...functionsSql.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1]),
    );
    expect([...found].sort()).toEqual([...KNOWN_ERROR_CODES]);
  });

  it('wirft jede Ausnahme mit errcode P0001, damit der Client sie unterscheiden kann', () => {
    const raises = functionsSql.match(/raise exception '[A-Z_]+'/g)?.length ?? 0;
    const coded = functionsSql.match(/raise exception '[A-Z_]+' using errcode = 'P0001'/g)?.length ?? 0;
    expect(coded).toBe(raises);
  });
});

describe('validate_entry — Regeln aus SPEC §4', () => {
  const body = /create or replace function public\.validate_entry\(\)([\s\S]*?)\$\$;/.exec(
    functionsSql,
  )?.[1];

  it('prüft alle fünf Regeln (a)–(e)', () => {
    expect(body).toBeDefined();
    expect(body).toContain('SESSION_CLOSED');
    expect(body).toContain('PLAYER_ALREADY_CASHED_OUT');
    expect(body).toContain('PAYOUT_REQUIRES_CASH_OUT');
    expect(body).toContain('PAYOUT_EXCEEDS_STACK');
    expect(body).toContain('PAYOUT_EXCEEDS_CASHBOX');
    expect(body).toContain('STACK_BELOW_PAYOUT');
    expect(body).toContain('CASH_OUT_HAS_PAYOUT');
  });

  it('hängt am Trigger für insert, update und delete', () => {
    expect(functionsSql).toContain(
      'create trigger validate_entry_trg\n  before insert or update or delete on public.entries',
    );
  });

  it('fasst NEW/OLD nur innerhalb der passenden Operation an', () => {
    // Ein `new.`-Zugriff außerhalb eines `tg_op <> 'DELETE'`-Zweigs würde bei
    // DELETE "record new is not assigned yet" werfen.
    expect(body).toContain("if tg_op = 'DELETE' then");
    expect(body).toContain("if tg_op <> 'DELETE' then");
    const declareBlock = /declare([\s\S]*?)begin/.exec(body ?? '')?.[1] ?? '';
    expect(declareBlock).not.toMatch(/\b(new|old)\./);
  });
});

describe('validate_session_update — Status nur über die RPCs (SPEC §5)', () => {
  const body = /create or replace function public\.validate_session_update\(\)([\s\S]*?)\$\$;/.exec(
    functionsSql,
  )?.[1];

  it('sperrt status und alle Abschlussfelder gegen direkte Updates', () => {
    for (const column of [
      'status',
      'closed_at',
      'closed_by',
      'discrepancy_cents',
      'close_note',
      'reopened_at',
      'reopened_by',
    ]) {
      expect(body).toContain(`new.${column}`);
    }
    expect(body).toContain('USE_RPC');
  });

  it('öffnet den Weg nur über die transaktionslokale Einstellung app.session_transition', () => {
    expect(body).toContain("current_setting('app.session_transition', true)");
    // beide RPCs setzen sie lokal (dritter Parameter true) und wieder zurück
    const setCalls = functionsSql.match(/set_config\('app\.session_transition', '(on|off)', true\)/g);
    expect(setCalls?.length).toBe(4);
  });

  it('verbietet Namens- und Datumsänderung an abgeschlossenen Sessions', () => {
    expect(body).toContain("old.status <> 'open'");
    expect(body).toContain('SESSION_CLOSED');
  });
});

describe('close_session — rechnet selbst nach (WP1 Testauftrag)', () => {
  const body = /create function public\.close_session\(([\s\S]*?)\n\$\$;/.exec(functionsSql)?.[1];

  it('prüft Rolle, Status und Vollständigkeit der Cash-outs', () => {
    expect(body).toContain('if not public.is_editor() then');
    expect(body).toContain('SESSION_NOT_FOUND');
    expect(body).toContain('SESSION_CLOSED');
    expect(body).toContain('MISSING_CASH_OUT');
    expect(body).toContain('NO_PARTICIPANTS');
  });

  it('sperrt die Session-Zeile (kein doppelter Abschluss bei gleichzeitigen Aufrufen)', () => {
    expect(body).toMatch(/from public\.sessions s where s\.id = p_session_id for update/);
  });

  it('aggregiert Summen serverseitig aus entries statt sie dem Client zu glauben', () => {
    expect(body).toMatch(/from public\.entries e where e\.session_id = p_session_id/);
    expect(body).toContain('v_discrepancy := v_stack - v_buy_in;');
    for (const key of [
      'totalBuyIn',
      'totalStack',
      'discrepancy',
      'cashBoxStart',
      'cashBoxAfterPayouts',
    ]) {
      expect(body).toContain(`p_settlement ->> '${key}'`);
    }
    expect(body).toContain('SETTLEMENT_MISMATCH');
  });

  it('prüft jede Zeile gegen die Aggregation und die Formeln aus SETTLEMENT.md', () => {
    expect(body).toContain('l."cashFromBox" is distinct from (l."cashTier1" + l."cashTier2" + l."cashTier3")');
    expect(body).toContain('l."cashFromBox" > (agg.stack - agg.payout)');
    expect(body).toContain(
      'l."residual"    is distinct from (agg.stack - agg.payout - l."cashFromBox" - agg.credit_in)',
    );
    expect(body).toContain('l."claim"        is distinct from (agg.stack - agg.payout)');
    expect(body).toContain(
      'l."netResult"    is distinct from (agg.stack - agg.cash_in - agg.credit_in)',
    );
  });

  it('prüft die Kasseninvariante Σ cashFromBox + unallocated = Σ cash − Σ payout', () => {
    expect(body).toMatch(
      /v_from_box \+ \(p_settlement ->> 'unallocatedCash'\)::integer <> \(v_cash - v_payout\)/,
    );
    expect(body).toContain('SETTLEMENT_INVARIANT');
  });

  it('prüft Σ transfers + uncoveredClaims = Σ positive residual', () => {
    expect(body).toMatch(
      /v_transfers \+ \(p_settlement ->> 'uncoveredClaims'\)::integer <> v_pos_residual/,
    );
  });

  it('verlangt bei Differenz ≠ 0 einen Admin und einen Kommentar (SPEC 5.5)', () => {
    expect(body).toContain('if v_discrepancy <> 0 then');
    expect(body).toContain('if not public.is_admin() or v_note is null or length(v_note) < 3 then');
    expect(body).toContain('DISCREPANCY_REQUIRES_ADMIN_NOTE');
  });

  it('schreibt alles in einer Funktion, also einer Transaktion', () => {
    expect(body).toContain('insert into public.settlements');
    expect(body).toContain('insert into public.settlement_lines');
    expect(body).toContain('insert into public.settlement_transfers');
    expect(body).toContain("update public.sessions s\n     set status            = 'closed'");
    expect(body).not.toMatch(/\bcommit\b|\brollback\b/);
  });

  it('speichert die serverseitig gerechneten Summen, nicht die des Clients', () => {
    expect(body).toContain('v_buy_in, v_stack, v_discrepancy,');
    expect(body).toContain('v_cash, v_cash - v_payout,');
  });
});

describe('reopen_session — nur Admin, Grund Pflicht, Abrechnung weg (SPEC §4)', () => {
  const body = /create function public\.reopen_session\(([\s\S]*?)\n\$\$;/.exec(functionsSql)?.[1];

  it('prüft Admin, Grund und Status', () => {
    expect(body).toContain('if not public.is_admin() then');
    expect(body).toContain('REASON_REQUIRED');
    expect(body).toContain('SESSION_NOT_CLOSED');
  });

  it('löscht die eingefrorene Abrechnung und hängt den Grund an close_note an', () => {
    expect(body).toContain('delete from public.settlements where session_id = p_session_id;');
    expect(body).toContain('[wieder geöffnet: ');
    expect(body).toContain('close_note  = coalesce(s.close_note');
  });
});

// ---------------------------------------------------------------------------
// Seed und Typen
// ---------------------------------------------------------------------------

describe('supabase/seed.sql', () => {
  it('enthält keine echte E-Mail-Adresse, nur Platzhalter', () => {
    expect(seedSql).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(seedSql).toContain('ADMIN_EMAIL_1');
    expect(seedSql).toContain('EDITOR_EMAIL_1');
  });

  it('ist mehrfach ausführbar', () => {
    expect(seedSql).toContain('on conflict (email) do update');
    expect(seedSql).toContain('on conflict (key) do nothing');
  });

  it('setzt die Schnellbeträge 50/100/200 € aus SPEC §4', () => {
    expect(seedSql).toContain("'quick_amounts_cents', '[5000,10000,20000]'::jsonb");
  });
});

describe('src/lib/database.types.ts', () => {
  it('kennt genau die Tabellen der Migration', () => {
    const tablesBlock = /Tables: \{([\s\S]*?)\n {4}Views: \{/.exec(typesTs)?.[1] ?? '';
    const declared = [...tablesBlock.matchAll(/^ {6}(\w+): \{$/gm)].map((m) => m[1]);
    expect(declared.sort()).toEqual([...TABLES].sort());
  });

  it('listet in TABLE_NAMES alle elf Tabellen (das Smoke-Script nutzt sie)', () => {
    const block = /export const TABLE_NAMES = \[([\s\S]*?)\] as const/.exec(typesTs)?.[1] ?? '';
    const names = [...block.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...TABLES].sort());
  });

  it('spiegelt die vier Enums wortgleich', () => {
    expect(typesTs).toContain("app_role: 'admin' | 'editor' | 'viewer'");
    expect(typesTs).toContain("entry_type: 'buy_in' | 'cash_out' | 'payout'");
    expect(typesTs).toContain("payment_method: 'cash' | 'credit'");
    expect(typesTs).toContain("session_status: 'open' | 'closed'");
  });

  it('kennt die Signaturen der drei RPCs', () => {
    expect(typesTs).toMatch(/close_session: \{\s*Args: \{\s*p_session_id: string;\s*p_settlement: Json;\s*p_note\?: string \| null;/);
    expect(typesTs).toMatch(/reopen_session: \{\s*Args: \{\s*p_session_id: string;\s*p_reason: string;/);
    expect(typesTs).toMatch(/settlement_input: \{\s*Args: \{\s*p_session_id: string;/);
  });

  it('markiert die generierte Spalte name_normalized als nullable und nicht beschreibbar', () => {
    expect(typesTs).toContain('name_normalized: string | null;');
    const playersInsert =
      /players: \{[\s\S]*?Insert: \{([\s\S]*?)\};/.exec(typesTs)?.[1] ?? '';
    expect(playersInsert).not.toContain('name_normalized');
  });
});
