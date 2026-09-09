/**
 * WP2 — Rollen, Fehlerkontrakt, Konfiguration und die SQL-Zusagen (Gaby).
 *
 * Zwei Sorten Prüfung:
 *  1. Verhalten: requireEditor/requireAdmin + actionResult ergeben genau die
 *     Form `{ ok:false, error:{ code, message } }` mit deutscher Meldung, und
 *     keine rohe Datenbank- oder Anbietermeldung erreicht den Browser.
 *  2. Zusagen über das Repo, die kein Unit-Test sonst festhält: keine
 *     `process.env`-Zugriffe außerhalb von src/lib/env.ts, kein Service-Role-Key,
 *     keine Tabellenzugriffe aus Client-Komponenten, und die beiden
 *     SQL-Eigenschaften aus dem Plan (Profil-Sync fasst `role` nie an,
 *     `created_by` überlebt ein UPDATE).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, actionResult } from '@/lib/actions/result';
import { LOGIN_ERROR_CODES, loginErrorMessage } from '@/lib/auth/loginErrors';
import { parseEnv, EnvError } from '@/lib/env';
import type { CurrentUser } from '@/lib/auth/getCurrentUser';
import type { Role } from '@/lib/auth/roles';

const ROOT = join(__dirname, '..', '..');

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8');
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) {
      sourceFiles(relative, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(relative);
    }
  }
  return out;
}

const SRC_FILES = sourceFiles('src');

/** Blockkommentare und Zeilenkommentare entfernen, damit Prosa keine Treffer liefert. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

// -----------------------------------------------------------------------------
// Rollenwächter und Fehlerkontrakt
// -----------------------------------------------------------------------------

const getCurrentUser = vi.hoisted(() => vi.fn<() => Promise<CurrentUser | null>>());
vi.mock('@/lib/auth/getCurrentUser', () => ({ getCurrentUser }));

const { requireAdmin, requireEditor, requireUser } = await import('@/lib/auth/requireRole');

function asUser(role: Role): CurrentUser {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    email: 'test@example.test',
    displayName: 'Test',
    avatarUrl: null,
    role,
  };
}

afterEach(() => {
  getCurrentUser.mockReset();
  vi.restoreAllMocks();
});

describe('Rollenwächter in Server Actions', () => {
  it.each<[Role, boolean, boolean]>([
    ['viewer', false, false],
    ['editor', true, false],
    ['admin', true, true],
  ])('%s: darf bearbeiten=%s, ist Admin=%s', async (role, mayEdit, mayAdmin) => {
    getCurrentUser.mockResolvedValue(asUser(role));

    const edit = await actionResult(async () => {
      await requireEditor();
      return 'ok';
    });
    expect(edit.ok).toBe(mayEdit);

    getCurrentUser.mockResolvedValue(asUser(role));
    const admin = await actionResult(async () => {
      await requireAdmin();
      return 'ok';
    });
    expect(admin.ok).toBe(mayAdmin);
  });

  it('ein Viewer bekommt FORBIDDEN in genau der vereinbarten Form', async () => {
    getCurrentUser.mockResolvedValue(asUser('viewer'));
    const result = await actionResult(async () => {
      await requireEditor();
      return 'nie erreicht';
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: expect.any(String) },
    });
    // genau zwei Schlüssel, damit sich nichts Unerwartetes einschleicht
    if (!result.ok) {
      expect(Object.keys(result.error).sort()).toEqual(['code', 'message']);
      expect(result.error.message).toMatch(/[äöüß„]/); // deutscher Satz
      expect(result.error.message).toMatch(/Bearbeiter/);
      expect(result.error.message).not.toMatch(/forbidden|permission|denied/i);
    }
  });

  it('ohne Anmeldung ist der Code UNAUTHENTICATED und die Meldung deutsch', async () => {
    getCurrentUser.mockResolvedValue(null);
    const result = await actionResult(async () => {
      await requireUser();
      return 'nie erreicht';
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('UNAUTHENTICATED');
      expect(result.error.message).toMatch(/angemeldet/);
    }
  });

  it.each([
    'duplicate key value violates unique constraint "players_name_normalized_key"',
    'new row violates row-level security policy for table "entries"',
    'permission denied for table app_users',
  ])('leitet die Postgres-Meldung %# nicht an den Browser weiter', async (pgMessage) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await actionResult(async () => {
      throw Object.assign(new Error(pgMessage), { code: '42501' });
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain(pgMessage);
      expect(result.error.message).toMatch(/[äöüß]|schiefgelaufen/);
      expect(result.error.code).toBe('UNEXPECTED');
    }
    expect(spy).toHaveBeenCalled(); // im Serverlog steht die Wahrheit
  });

  it('AppError bleibt eine Error-Instanz (Stacktrace im Log)', () => {
    const error = new AppError('FORBIDDEN', 'Das darf nur ein Admin.');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('FORBIDDEN');
  });
});

// -----------------------------------------------------------------------------
// Login-Fehlertexte
// -----------------------------------------------------------------------------

describe('Login-Fehlertexte', () => {
  it('gibt zu jedem Code einen deutschen Satz und nie englischen Anbietertext', () => {
    for (const code of LOGIN_ERROR_CODES) {
      const message = loginErrorMessage(code);
      expect(message.length).toBeGreaterThan(15);
      expect(message).not.toMatch(/unsupported provider|is not enabled|invalid request/i);
    }
  });

  it('fällt bei Unfug auf den allgemeinen Satz zurück (kein reflektierter Text)', () => {
    const generic = loginErrorMessage('unknown');
    for (const junk of ['<script>alert(1)</script>', 'Unsupported provider', '', null, 42]) {
      expect(loginErrorMessage(junk)).toBe(generic);
    }
  });
});

// -----------------------------------------------------------------------------
// Konfiguration
// -----------------------------------------------------------------------------

describe('src/lib/env.ts', () => {
  it('wirft bei fehlender Konfiguration eine verständliche deutsche Meldung', () => {
    let thrown: unknown;
    try {
      parseEnv({});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(EnvError);
    const message = (thrown as EnvError).message;
    expect(message).toMatch(/Konfiguration ist unvollständig/);
    expect(message).toMatch(/\.env\.local/);
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it.each([
    [{ NEXT_PUBLIC_SUPABASE_URL: 'nicht-url', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'k' }],
    [{ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' }],
    [{ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '   ' }],
  ])('lehnt unbrauchbare Werte ab: %j', (env) => {
    expect(() => parseEnv(env)).toThrow(EnvError);
  });

  it('akzeptiert eine vollständige Konfiguration', () => {
    expect(
      parseEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://vcyqzqgybjggoreffwjc.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dummy',
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'https://vcyqzqgybjggoreffwjc.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_dummy',
    });
  });
});

// -----------------------------------------------------------------------------
// Zusagen über das Repo
// -----------------------------------------------------------------------------

describe('Repo-Zusagen (WP2 Testauftrag)', () => {
  it('liest process.env nur in src/lib/env.ts', () => {
    const offenders = SRC_FILES.filter(
      (file) => file !== 'src/lib/env.ts' && /process\.env\./.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });

  it('benutzt keine Non-Null-Assertion auf process.env', () => {
    for (const file of SRC_FILES) {
      expect(read(file)).not.toMatch(/process\.env\.[A-Z0-9_]+\s*!/);
    }
  });

  it('enthält keinen Service-Role-Key und keine Secrets', () => {
    for (const file of [...SRC_FILES, 'scripts/rls-smoke.ts', '.env.example']) {
      const text = read(file);
      expect(text).not.toMatch(/service_role/i);
      expect(text).not.toMatch(/SUPABASE_SERVICE/i);
      // JWTs und Supabase-Secret-Keys haben ein erkennbares Präfix
      expect(text).not.toMatch(/\bsb_secret_[A-Za-z0-9]/);
      expect(text).not.toMatch(/\beyJ[A-Za-z0-9_-]{20,}\./);
    }
  });

  it('greift aus keiner Client-Komponente auf eine Tabelle zu', () => {
    for (const file of SRC_FILES) {
      const text = read(file);
      if (!/^['"]use client['"]/m.test(text)) continue;
      expect(text, `${file} ist 'use client'`).not.toMatch(/\.from\(/);
      expect(text, `${file} ist 'use client'`).not.toMatch(/\.rpc\(/);
    }
  });

  // WP2-Momentaufnahme, ab WP4 (Gaby) verallgemeinert: WP4 fügt planmäßig
  // serverseitige Tabellenzugriffe hinzu (src/lib/queries/*, src/actions/*),
  // daher ist die feste 1-Datei-Liste überholt. Die dahinterstehende Zusage ist
  // stärker und bleibt eingefroren: JEDE Datei mit .from( oder .rpc( ist
  // serverseitig, also keine 'use client'-Komponente. getCurrentUser (WP2) muss
  // weiterhin unter den Server-Lesern sein.
  it('greift überhaupt nur aus Server-Dateien auf eine Tabelle zu', () => {
    const withTable = SRC_FILES.filter((file) => /\.from\(|\.rpc\(/.test(read(file)));
    for (const file of withTable) {
      expect(/^['"]use client['"]/m.test(read(file)), `${file} ist 'use client'`).toBe(false);
    }
    expect(withTable).toContain('src/lib/auth/getCurrentUser.ts');
  });

  it('markiert jede Datei in src/actions als Server Action', () => {
    const actions = SRC_FILES.filter((file) => file.startsWith('src/actions/'));
    expect(actions.length).toBeGreaterThan(0);
    for (const file of actions) {
      expect(read(file)).toMatch(/^['"]use server['"];/);
    }
  });

  it('entscheidet den Admin-Tab serverseitig, nicht per CSS', () => {
    const layout = read('src/app/(app)/layout.tsx');
    expect(layout).toMatch(/showAdmin=\{isAdmin\(user\.role\)\}/);
    const tabbar = read('src/components/app/TabBar.tsx');
    // kein Ausblenden über Klassen: der Tab entsteht gar nicht erst
    expect(tabbar).toMatch(/showAdmin \? \[\.\.\.BASE_TABS, ADMIN_TAB\] : BASE_TABS/);
    expect(tabbar.replace(/aria-hidden/g, '')).not.toMatch(
      /hidden|invisible|display:\s*none/,
    );
    // und die Seite dahinter prüft selbst
    expect(read('src/app/(app)/admin/page.tsx')).toMatch(/isAdmin\(/);
  });

  it('meldet über eine Server Action ab', () => {
    expect(read('src/actions/auth.ts')).toMatch(/auth\.signOut\(\)/);
    expect(read('src/components/app/UserMenu.tsx')).toMatch(/<form action=\{signOut\}>/);
  });

  it('holt den Nutzer über React.cache, damit ein Request nur einmal fragt', () => {
    const file = read('src/lib/auth/getCurrentUser.ts');
    expect(file).toMatch(/import \{ cache \} from 'react'/);
    expect(file).toMatch(/export const getCurrentUser = cache\(/);
    // getUser() statt getSession(): das Token wird verifiziert, nicht geglaubt
    expect(file).toMatch(/auth\.getUser\(\)/);
    // getSession() darf nirgends aufgerufen werden (im Kommentar erwähnt zu
    // werden ist erlaubt, deshalb wird ohne Kommentare geprüft)
    expect(withoutComments(file)).not.toMatch(/auth\.getSession\(/);
    // genau ein Tabellenzugriff pro Request
    expect(withoutComments(file).match(/\.from\(/g)).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// SQL: Migration 0005 und die F11-Änderung in 0002
// -----------------------------------------------------------------------------

describe('0005_profile_sync.sql', () => {
  const sql = read('supabase/migrations/0005_profile_sync.sql');

  it('hängt am Update von raw_user_meta_data auf auth.users', () => {
    expect(sql).toMatch(/after update of raw_user_meta_data on auth\.users/);
    expect(sql).toMatch(/when \(old\.raw_user_meta_data is distinct from new\.raw_user_meta_data\)/);
    expect(sql).toMatch(/drop trigger if exists on_auth_user_profile_updated on auth\.users/);
  });

  it('schreibt niemals die Rolle (SPEC §3: „Die Rolle bleibt davon unberührt“)', () => {
    const updates = [...sql.matchAll(/update\s+public\.app_users[\s\S]*?;/g)].map((m) => m[0]);
    expect(updates.length).toBeGreaterThan(0);
    for (const statement of updates) {
      expect(statement).not.toMatch(/\brole\s*=/);
      // gesetzt werden ausschließlich die zwei Anzeigespalten
      const assigned = [...statement.matchAll(/^\s*(?:set\s+)?(\w+)\s*=\s*coalesce/gm)].map(
        (m) => m[1],
      );
      expect(assigned.sort()).toEqual(['avatar_url', 'display_name']);
    }
  });

  it('meldet sich beim Spaltenschutz an und wieder ab', () => {
    expect(sql).toMatch(/set_config\('app\.profile_sync',\s*'on',\s*true\)/);
    expect(sql).toMatch(/set_config\('app\.profile_sync',\s*'off',\s*true\)/);
  });

  it('ist security definer mit festem search_path und entzieht die Rechte', () => {
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public/);
    expect(sql).toMatch(
      /revoke all on function public\.sync_auth_user_profile\(\) from public, anon, authenticated/,
    );
  });
});

describe('0002_functions_triggers.sql — WP2-Änderungen', () => {
  const sql = read('supabase/migrations/0002_functions_triggers.sql');

  it('lässt den Profil-Sync nur display_name und avatar_url ändern', () => {
    const guard = sql.slice(
      sql.indexOf('function public.protect_app_user_columns()'),
      sql.indexOf('drop trigger if exists protect_app_user_columns_trg'),
    );
    expect(guard).toMatch(/app\.profile_sync/);
    // im Sync-Zweig sind id, email, role und created_at tabu
    const branch = guard.slice(guard.indexOf('if v_profile_sync then'));
    for (const column of ['id', 'email', 'role', 'created_at']) {
      expect(branch).toMatch(new RegExp(`new\\.${column} is distinct from old\\.${column}`));
    }
    expect(branch).toMatch(/raise exception 'FORBIDDEN' using errcode = 'P0001'/);
  });

  it('hält created_by und created_at beim UPDATE fest (WP1-Finding F11)', () => {
    const stamp = sql.slice(
      sql.indexOf('function public.stamp_actor()'),
      sql.indexOf('drop trigger if exists stamp_players'),
    );
    expect(stamp).toMatch(/if tg_op = 'UPDATE' then/);
    expect(stamp).toMatch(/tg_table_name in \('players', 'entries'\)/);
    expect(stamp).toMatch(/new\.created_by := old\.created_by/);
    expect(stamp).toMatch(/new\.created_at := old\.created_at/);
  });

  it('lässt die stamp-Trigger auf players und entries auch bei UPDATE laufen', () => {
    for (const table of ['players', 'entries']) {
      expect(sql).toMatch(
        new RegExp(
          `create trigger stamp_${table}\\s+before insert or update on public\\.${table}`,
        ),
      );
    }
  });

  it('lässt sessions und session_players unverändert bei insert', () => {
    expect(sql).toMatch(/create trigger stamp_sessions\s+before insert on public\.sessions/);
    expect(sql).toMatch(
      /create trigger stamp_session_players\s+before insert on public\.session_players/,
    );
  });

  it('führt keinen neuen Fehlercode ein (die deutschen Texte kommen erst in WP5)', () => {
    const codes = new Set(
      [...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((match) => match[1]),
    );
    expect(codes.has('FORBIDDEN')).toBe(true);
    expect([...codes].sort()).not.toContain('PROFILE_SYNC_FORBIDDEN');
  });
});
