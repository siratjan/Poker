# Arbeitspakete (WP) – Poker-App v1

Verbindliche Grundlagen: `docs/SPEC.md` (fachlich), `docs/SETTLEMENT.md` (Algorithmus),
`docs/WORKFLOW.md` (Zusammenarbeit Sirat / Siri / Gaby).

Jedes Paket hat: Ziel, Abhängigkeiten, Implementation Plan (für Siri), Definition of Done (DoD),
Testauftrag (für Gaby). Ein Paket ist fertig, wenn Gaby es freigegeben hat und der Planer es
abgenommen hat.

## Reihenfolge und Abhängigkeiten

```
WP0 Setup
 ├── WP1 Datenbank ──── WP2 Auth ──── WP4 Spieler + Session-Liste ──── WP5 Session-Detail ──┐
 └── WP3 Algorithmus (parallel, reine TS-Bibliothek) ─────────────────────────────────────────┤
                                                                                           WP6 Abschluss + Abrechnung
                                                                                            ├── WP7 Spieler-Übersicht
                                                                                            └── WP8 Admin + Audit-Log
                                                                                                  └── WP9 PWA + Polish ── WP10 Deployment
```

WP3 kann direkt nach WP0 parallel zu WP1/WP2 laufen.

## Projektweite Konventionen (gelten für alle Pakete)

- Sprache: UI-Texte Deutsch, Code/Kommentare/Commits Englisch, Dokumente in `docs/` und `qa/` Deutsch.
- Geld: immer Integer-Cent (`*_cents`), nie Float. Anzeige über `formatCents()` in `src/lib/money.ts` (`1.234,50 €`). Eingabe über `parseEuroInput()` (akzeptiert `100`, `100,5`, `100.50`, `1.000,00`).
- Zeit: Datenbank in UTC (`timestamptz`), Anzeige in `Europe/Berlin`.
- Schreibzugriffe: ausschließlich über Next.js Server Actions in `src/actions/*.ts` mit dem Server-Supabase-Client (RLS greift über die Nutzer-Session). Kein direkter Schreibzugriff aus Client-Komponenten.
- Lesezugriffe: Server Components für den Erstaufbau, Client-Komponenten mit Supabase Realtime für Live-Updates.
- Fehler: Server Actions geben `{ ok: true, data } | { ok: false, error: { code, message } }` zurück; nie werfen Richtung Client. Fehlermeldungen Deutsch.
- Autorisierung: Serverseitig durch RLS und DB-Trigger. Die UI blendet nur zusätzlich aus (Buttons je nach Rolle), sie ist nicht die Sicherheitsgrenze.
- Tests: Vitest. Reine Logik in `src/lib/**` hat Unit-Tests. Testdateien `*.test.ts` neben dem Code oder in `tests/`.
- Kein `any`, `strict: true`, ESLint muss sauber sein. `npm run check` (typecheck + lint + test) muss vor jeder Übergabe grün sein.
- Jedes Paket endet mit einem Git-Commit `WPn: <kurz>` auf `main`.
- Keine neuen Abhängigkeiten ohne Nennung in der Übergabe (`qa/handoffs/WPn-siri.md`).

---

## WP0 – Projekt-Setup

**Ziel**: Lauffähiges Next.js-Projekt mit Supabase-Anbindung, Tooling und Ordnerstruktur, ohne Fachlogik.

**Abhängigkeiten**: keine.

**Implementation Plan**

1. `git init` im Projektordner (`C:\Users\sirat\Poker_App`), `.gitignore` für Node/Next (inkl. `.env*.local`, `.vercel`, `qa/tmp`).
2. Next.js anlegen: `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack` (bei Rückfrage zu React Compiler: nein). Falls der Ordner wegen `docs/`, `qa/`, `.claude/` als „nicht leer“ abgelehnt wird: in temporärem Ordner anlegen und Inhalte verschieben.
3. Abhängigkeiten: `@supabase/supabase-js`, `@supabase/ssr`, `vitest`, `@vitest/coverage-v8`, `fast-check`, `zod`, `clsx`. Dev: `@types/node`.
4. `.env.local` mit `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Werte aus `docs/SPEC.md` Abschnitt 2). `.env.example` ohne Werte committen.
5. Supabase-Client-Helfer nach Supabase-Vorlage: `src/lib/supabase/client.ts` (Browser), `src/lib/supabase/server.ts` (Server Components/Actions), `src/lib/supabase/middleware.ts` + `src/middleware.ts` (Session-Refresh; Redirect-Logik kommt in WP2).
6. `src/lib/money.ts` mit `formatCents(cents: number): string` und `parseEuroInput(input: string): number | null` inkl. Tests (`src/lib/money.test.ts`): `"100"→10000`, `"100,5"→10050`, `"100.50"→10050`, `"1.000,00"→100000`, `"1,000.50"→100050`, `"abc"→null`, `"-5"→null`, `""→null`, `"0"→0`.
7. `vitest.config.ts` (environment node, include `src/**/*.test.ts`, `tests/**/*.test.ts`), Scripts in `package.json`: `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `test:watch`, `check` (`npm run typecheck && npm run lint && npm run test`).
8. Ordnerstruktur anlegen (leere `index.ts` oder `.gitkeep`): `src/actions/`, `src/components/ui/`, `src/lib/settlement/`, `src/lib/auth/`, `supabase/migrations/`, `tests/gaby/`.
9. `src/app/layout.tsx`: `lang="de"`, Viewport-Meta für Mobile, Basis-Tailwind, Titel „Poker-Kasse“. `src/app/page.tsx`: Platzhalter „Poker-Kasse – Setup OK“.
10. `.claude/launch.json` mit Konfiguration `dev` (`npm run dev`, Port 3000), damit der Planer den Dev-Server per Browser-Pane starten kann.
11. `npm run check` und `npm run build` grün. Commit `WP0: project setup`.

**DoD**

- `npm run dev` zeigt die Platzhalterseite unter `http://localhost:3000`.
- `npm run check` und `npm run build` grün.
- Keine Secrets im Repo (nur Publishable Key, der ist öffentlich).
- Übergabe in `qa/handoffs/WP0-siri.md`.

**Testauftrag Gaby**

- Frische Installation prüfen: `npm ci`, `npm run check`, `npm run build`.
- `money.test.ts` gegen die Fälle oben abgleichen; zusätzlich eigene Grenzfälle in `tests/gaby/money.gaby.test.ts` (z. B. `"1.234.567,89"`, `" 100 "`, `"100,555"` → Erwartung: auf Cent runden oder ablehnen? Regel: **ablehnen** (`null`), mehr als zwei Nachkommastellen sind kein gültiger Betrag).
- `.gitignore` deckt `.env.local` ab; `git status` zeigt keine Env-Datei.
- Ordnerstruktur und Scripts vollständig laut Plan.

---

## WP1 – Datenbank: Schema, RLS, Trigger, Seed

**Ziel**: Vollständiges Datenmodell in Supabase mit serverseitig erzwungenen Rechten und Audit-Log.

**Abhängigkeiten**: WP0. Zum Einspielen: Supabase-CLI verlinkt (`npx supabase link --project-ref vcyqzqgybjggoreffwjc`) **oder** der Planer spielt die SQL-Datei über den SQL-Editor ein. Siri fragt nicht, sondern schreibt die Migrationen so, dass beide Wege funktionieren, und dokumentiert in der Übergabe, ob sie eingespielt wurden.

**Implementation Plan**

1. `supabase/migrations/0001_schema.sql`:
   - Enums: `app_role ('admin','editor','viewer')`, `session_status ('open','closed')`, `entry_type ('buy_in','cash_out','payout')`, `payment_method ('cash','credit')`.
   - `role_whitelist(email text primary key check (email = lower(email)), role app_role not null, note text, created_at timestamptz default now())`.
   - `app_users(id uuid primary key references auth.users(id) on delete cascade, email text not null unique, display_name text, avatar_url text, role app_role not null default 'viewer', created_at timestamptz default now(), updated_at timestamptz default now())`.
   - `players(id uuid pk default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 40), name_normalized text generated always as (lower(trim(name))) stored unique, created_by uuid references app_users(id), created_at timestamptz default now())`.
   - `sessions(id uuid pk default gen_random_uuid(), played_on date not null default current_date, name text check (length(name) <= 60), status session_status not null default 'open', created_by uuid references app_users(id), created_at timestamptz default now(), closed_at timestamptz, closed_by uuid references app_users(id), discrepancy_cents integer, close_note text, reopened_at timestamptz, reopened_by uuid references app_users(id))`.
   - `session_players(session_id uuid references sessions(id) on delete cascade, player_id uuid references players(id) on delete restrict, position integer not null, added_by uuid references app_users(id), added_at timestamptz default now(), primary key (session_id, player_id), unique (session_id, position))`.
   - `entries(id uuid pk default gen_random_uuid(), session_id uuid not null, player_id uuid not null, type entry_type not null, amount_cents integer not null, payment payment_method, note text check (length(note) <= 200), created_by uuid references app_users(id), created_at timestamptz default now(), foreign key (session_id, player_id) references session_players(session_id, player_id) on delete cascade, check ((type = 'buy_in') = (payment is not null)), check ((type = 'cash_out' and amount_cents >= 0) or (type <> 'cash_out' and amount_cents > 0)))`. Partial Unique Index: `(session_id, player_id) where type = 'cash_out'`. Index auf `(session_id, created_at)`.
   - `settlements(session_id uuid primary key references sessions(id) on delete cascade, algorithm_version integer not null, computed_at timestamptz default now(), computed_by uuid references app_users(id), total_buy_in_cents integer not null, total_stack_cents integer not null, discrepancy_cents integer not null, cash_box_start_cents integer not null, cash_box_after_payouts_cents integer not null, unallocated_cash_cents integer not null, uncovered_claims_cents integer not null)`.
   - `settlement_lines(session_id uuid references settlements(session_id) on delete cascade, player_id uuid references players(id), position integer not null, cash_in_cents, credit_in_cents, stack_cents, payout_cents, is_cash_player boolean, claim_cents, cash_tier1_cents, cash_tier2_cents, cash_tier3_cents, cash_from_box_cents, net_result_cents, residual_cents – alle integer not null, primary key (session_id, player_id))`.
   - `settlement_transfers(id uuid pk default gen_random_uuid(), session_id uuid references settlements(session_id) on delete cascade, position integer not null, from_player_id uuid references players(id), to_player_id uuid references players(id), amount_cents integer not null check (amount_cents > 0), check (from_player_id <> to_player_id))`.
   - `settings(key text primary key, value jsonb not null, updated_at timestamptz default now(), updated_by uuid references app_users(id))`. Seed: `('quick_amounts_cents', '[5000,10000,20000]')`.
   - `audit_log(id bigserial pk, at timestamptz not null default now(), user_id uuid, user_email text, table_name text not null, row_id text not null, action text not null check (action in ('INSERT','UPDATE','DELETE')), old_data jsonb, new_data jsonb, session_id uuid)`. Index auf `(at desc)`, `(session_id, at desc)`, `(user_id, at desc)`.
2. `supabase/migrations/0002_functions_triggers.sql`:
   - `current_app_role() returns app_role` – `security definer`, `stable`, `set search_path = public`, liest `app_users.role` für `auth.uid()`. Dazu `is_admin()`, `is_editor()` (= editor oder admin).
   - `handle_new_auth_user()` – Trigger `after insert on auth.users`: legt `app_users` an; Rolle = `coalesce((select role from role_whitelist where email = lower(new.email)), 'viewer')`; `display_name` aus `raw_user_meta_data->>'full_name'` (Fallback `name`, Fallback E-Mail-Teil vor `@`), `avatar_url` aus `raw_user_meta_data->>'avatar_url'` (Fallback `picture`).
   - `protect_last_admin()` – Trigger `before update or delete on app_users`: Fehler `LAST_ADMIN`, wenn danach kein Admin mehr existieren würde.
   - `touch_updated_at()` für `app_users`, `settings`.
   - `audit_row_change()` – generischer Trigger `after insert or update or delete` auf `sessions`, `session_players`, `entries`, `players`, `app_users`, `settings`, `settlements`. Schreibt `audit_log` mit `auth.uid()`, E-Mail aus `app_users`, `row_id` als Text des PK (bei zusammengesetzten PKs `session_id:player_id`), `session_id` wenn die Zeile eine hat. `security definer`. Bei `app_users`-Updates nur loggen, wenn sich `role` ändert.
   - `validate_entry()` – Trigger `before insert or update on entries`: (a) Session muss `open` sein (Fehler `SESSION_CLOSED`); (b) `buy_in` nur, wenn für diesen Spieler kein `cash_out` existiert (`PLAYER_ALREADY_CASHED_OUT`); (c) `payout` nur, wenn `cash_out` existiert (`PAYOUT_REQUIRES_CASH_OUT`), `Σ payout` des Spielers inkl. neuem ≤ `stack` (`PAYOUT_EXCEEDS_STACK`), und `Σ payout` der Session inkl. neuem ≤ `Σ cash buy_in` (`PAYOUT_EXCEEDS_CASHBOX`); (d) `cash_out` darf nicht kleiner werden als `Σ payout` des Spielers (`STACK_BELOW_PAYOUT`); (e) Löschen eines `cash_out` nur, wenn kein `payout` für den Spieler existiert (`before delete`, `CASH_OUT_HAS_PAYOUT`).
   - `validate_session_update()` – Trigger `before update on sessions`: direkte Änderung von `status`, `closed_*`, `discrepancy_cents`, `close_note`, `reopened_*` nur, wenn `current_setting('app.session_transition', true) = 'on'` (wird nur von den RPCs gesetzt); sonst Fehler `USE_RPC`. `name`/`played_on` nur änderbar, solange `open`.
   - `validate_session_player_delete()` – `before delete on session_players`: nur, wenn der Spieler keine `entries` in der Session hat (`PLAYER_HAS_ENTRIES`), Session `open`.
   - RPC `close_session(p_session_id uuid, p_settlement jsonb, p_note text) returns void` – `security definer`, prüft selbst: Aufrufer `is_editor()`; Session `open`; jeder Teilnehmer hat `cash_out` (`MISSING_CASH_OUT`); berechnet serverseitig `total_buy_in`, `total_stack`, `discrepancy` aus `entries` und vergleicht mit `p_settlement` (Abweichung → `SETTLEMENT_MISMATCH`); prüft `Σ cash_from_box + unallocated = Σ cash − Σ payout` (`SETTLEMENT_INVARIANT`); bei `discrepancy ≠ 0`: `is_admin()` und `length(trim(p_note)) >= 3` (`DISCREPANCY_REQUIRES_ADMIN_NOTE`); schreibt in einer Transaktion `settlements`, `settlement_lines`, `settlement_transfers`, setzt `sessions.status = 'closed'`, `closed_at/by`, `discrepancy_cents`, `close_note` (mit `set_config('app.session_transition','on', true)`).
   - RPC `reopen_session(p_session_id uuid, p_reason text) returns void` – `security definer`, `is_admin()`, Session `closed`, `length(trim(p_reason)) >= 3` (`REASON_REQUIRED`); löscht `settlements` (Kaskade), setzt `status = 'open'`, `reopened_at/by`, hängt den Grund an `close_note` an (`close_note || E'\n[wieder geöffnet: ' || reason || ']'`) – der alte Wert bleibt im Audit-Log.
   - RPC `settlement_input(p_session_id uuid) returns table (player_id uuid, player_name text, position int, cash_in_cents int, credit_in_cents int, stack_cents int, payout_cents int, has_cash_out boolean)` – `security invoker`, aggregiert `entries` je Teilnehmer. Wird von WP5/WP6 für Vorschau und Abschluss genutzt.
3. `supabase/migrations/0003_rls.sql` – `alter table … enable row level security` für alle Tabellen, Policies:
   | Tabelle | select | insert | update | delete |
   |---|---|---|---|---|
   | `role_whitelist` | admin | admin | admin | admin |
   | `app_users` | authenticated | – (nur Trigger) | admin (nur `role`; via Trigger absichern, dass Nicht-Admins nichts ändern) | – |
   | `players` | authenticated | editor | editor | admin |
   | `sessions` | authenticated | editor | editor (Trigger schränkt Felder ein) | admin, nur `open` und ohne `settlements` |
   | `session_players` | authenticated | editor, Session `open` | – | editor, Session `open` (Trigger prüft Entries) |
   | `entries` | authenticated | editor, Session `open` | editor, Session `open` | editor, Session `open` |
   | `settlements`, `_lines`, `_transfers` | authenticated | – (nur RPC) | – | – (nur RPC) |
   | `settings` | authenticated | admin | admin | – |
   | `audit_log` | authenticated | – (nur Trigger) | – | – |
   Alle Policies mit `to authenticated`; für `anon` gibt es keine Policies (Ergebnis: leer/verboten). `grant execute` auf die RPCs nur für `authenticated`; `revoke` für `anon`.
4. `supabase/migrations/0004_realtime.sql` – `alter publication supabase_realtime add table sessions, session_players, entries, players, settings;` und `replica identity full` für `entries` (damit Deletes vollständig übertragen werden).
5. `supabase/seed.sql` – `insert into role_whitelist … on conflict (email) do update set role = excluded.role` mit **Platzhaltern** `ADMIN_EMAIL_1`, `ADMIN_EMAIL_2`, `ADMIN_EMAIL_3` und einem Kommentarblock, wie der Planer sie ersetzt. Zusätzlich das Settings-Seed. Die echten Adressen werden **nicht** in Git committet, sondern vom Planer beim Einspielen ersetzt; alternativ `supabase/seed.local.sql` (in `.gitignore`).
6. `supabase/config.toml` minimal (project_id), damit `npx supabase db push` funktioniert, falls verlinkt.
7. TypeScript-Typen: wenn CLI verlinkt: `npx supabase gen types typescript --linked > src/lib/database.types.ts`; sonst handgeschrieben in derselben Struktur (Tabellenzeilen als `Row`/`Insert`/`Update`). Script `types:gen` in `package.json`.
8. `scripts/rls-smoke.ts` (ausführbar mit `npx tsx`): nutzt nur den Publishable Key **ohne Login** und prüft, dass `select` auf jede Tabelle 0 Zeilen liefert und `insert` fehlschlägt; Aufruf der RPCs schlägt fehl. Script `rls:smoke`.
9. Übergabe dokumentiert: eingespielt ja/nein, mit welchem Weg, `rls:smoke`-Ergebnis. Commit `WP1: database schema, RLS, triggers`.

**DoD**

- Alle vier Migrationen laufen fehlerfrei in leerer Datenbank durch (Reihenfolge 0001–0004) und sind idempotent genug für ein zweites `db push` (Fehler bei erneutem Anlegen vermeiden: `create … if not exists`, `drop policy if exists` vor `create policy`).
- `npm run rls:smoke` grün gegen das Cloud-Projekt (setzt Einspielen voraus; sonst als offen markieren).
- `database.types.ts` vorhanden und `npm run check` grün.

**Testauftrag Gaby**

- SQL-Review Zeile für Zeile gegen den Plan: fehlt eine Policy, ein Check, ein Trigger? Besonders: kann ein `editor` in einer `closed`-Session etwas ändern? Kann jemand `audit_log` schreiben oder löschen? Kann ein Viewer irgendetwas schreiben? Kann `anon` irgendetwas lesen?
- Trigger-Logik gegen `docs/SPEC.md` Abschnitt 4 und 5 prüfen (jede Regel muss einem Trigger/Check zugeordnet sein; Tabelle im Report).
- `close_session`: prüft sie wirklich `discrepancy` selbst nach und vertraut nicht dem Client? Schreibt sie atomar?
- `reopen_session`: bleibt der alte `close_note` im Audit-Log nachvollziehbar?
- Seed enthält keine echten E-Mail-Adressen im Git.
- Wenn DB eingespielt: `npm run rls:smoke` selbst ausführen. Wenn nicht eingespielt: ausdrücklich als „nicht verifiziert“ berichten.

---

## WP2 – Authentifizierung und Rollen im Frontend

**Ziel**: Google-Login, geschützte Bereiche, Rolle des eingeloggten Nutzers überall verfügbar.

**Abhängigkeiten**: WP1 eingespielt; Google-Provider in Supabase aktiv (liefert der Auftraggeber). Siri baut auch ohne aktiven Provider fertig; die Live-Prüfung macht der Planer.

**Implementation Plan**

1. `src/app/login/page.tsx`: Zentrierte Karte, Titel „Poker-Kasse“, ein Button „Mit Google anmelden“. Client-Komponente ruft `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${origin}/auth/callback?next=${next}` } })`. Fehlertext, falls der Provider nicht konfiguriert ist.
2. `src/app/auth/callback/route.ts`: `exchangeCodeForSession(code)`, Redirect auf `next` (nur relative Pfade zulassen) oder `/`. Bei Fehler Redirect `/login?error=…`.
3. `src/proxy.ts` (Next 16 hat `middleware.ts` zugunsten von `proxy.ts` abgekündigt; die WP0-Datei `src/middleware.ts` wird hier umbenannt, Export `proxy` statt `middleware`, Helfer in `src/lib/supabase/middleware.ts` darf den Namen behalten): Session refreshen; nicht eingeloggt und Pfad nicht `/login`, `/auth/*`, statische Assets → Redirect `/login?next=<pfad>`. Eingeloggt und `/login` → Redirect `/`.
4. `src/lib/auth/getCurrentUser.ts` (Server): liest `auth.getUser()` und `app_users`-Zeile; gibt `{ id, email, displayName, avatarUrl, role }` oder `null`. `React.cache()` verwenden.
5. `src/lib/auth/roles.ts`: `type Role = 'admin' | 'editor' | 'viewer'`, `canEdit(role)`, `isAdmin(role)`, `ROLE_LABELS` (Deutsch: Admin, Bearbeiter, Betrachter).
6. `src/lib/auth/requireRole.ts` für Server Actions: `requireEditor()`, `requireAdmin()` – wirft strukturierten Fehler `FORBIDDEN`, den `actionResult()` in `{ ok:false }` übersetzt. (Doppelte Absicherung zur RLS für bessere Fehlermeldungen.)
7. `src/app/(app)/layout.tsx`: App-Shell mit unterer Tab-Navigation (Mobile): Sessions, Spieler, Log, und für Admins zusätzlich Admin. Oben rechts Avatar/Name mit Menü „Abmelden“ (Server Action `signOut`). Rolle als kleines Badge.
8. `src/components/auth/RoleGate.tsx`: rendert Kinder nur bei ausreichender Rolle (nur UI-Komfort).
9. `src/app/(app)/page.tsx`: vorerst „Eingeloggt als … (Rolle)“ – wird in WP4 ersetzt.
10. Abmelden: `src/actions/auth.ts` → `supabase.auth.signOut()`, Redirect `/login`.
11. Migration `supabase/migrations/0005_profile_sync.sql`: Trigger `after update of raw_user_meta_data on auth.users` → aktualisiert `app_users.display_name` und `avatar_url` (nie `role`). Der bestehende Spalten-Schutz-Trigger auf `app_users` muss diesen Pfad zulassen (z. B. über `set_config('app.profile_sync','on', true)` wie bei den Session-RPCs). `database.types.ts` bleibt unverändert.
12. Gaby-Finding F11 aus WP1 (solange die DB noch nicht eingespielt ist, direkt in `0002` statt neuer Migration): `stamp_actor()` bzw. ein `before update`-Trigger auf `players` und `entries` hält `created_by` unveränderlich (`new.created_by := old.created_by`), damit der Erfasser nicht per Update auf einen fremden Nutzer gesetzt werden kann. Gabys Test `tests/gaby/wp1-schema.gaby.test.ts` darf dabei nur um Trigger-Zählwerte angepasst werden, und nur mit Kommentar.
13. Commit `WP2: google auth, role plumbing, app shell`.

**DoD**

- Ohne Login landet jeder Pfad auf `/login`.
- Nach Login (Planer prüft live, sobald Provider aktiv): `app_users`-Zeile existiert, Rolle laut Whitelist, Name und Avatar sichtbar, Abmelden funktioniert.
- `npm run check` grün.

**Testauftrag Gaby**

- Middleware-Matcher: sind `/_next/*`, `/favicon.ico`, `/manifest.webmanifest`, `/icons/*` ausgenommen? Wird `next` gegen Open-Redirect geschützt (nur `/`-relative Pfade)?
- `getCurrentUser` gecacht (kein doppelter DB-Zugriff pro Request)?
- Rollen-Helfer unit-getestet (`tests/gaby/roles.gaby.test.ts` ergänzen, falls fehlend).
- Code-Review: kein Service-Role-Key, keine Secrets, keine Client-seitigen Schreibzugriffe.

---

## WP3 – Abrechnungs-Algorithmus (reine Bibliothek)

**Ziel**: `computeSettlement(input)` exakt nach `docs/SETTLEMENT.md`, vollständig getestet, ohne Abhängigkeit zu Supabase oder React.

**Abhängigkeiten**: WP0. Parallel zu WP1/WP2.

**Implementation Plan**

1. `src/lib/settlement/types.ts`: `SettlementInput`, `SettlementParticipant`, `SettlementResult`, `SettlementLine`, `Transfer` exakt wie in `docs/SETTLEMENT.md`.
2. `src/lib/settlement/errors.ts`: `class SettlementError extends Error { code: 'NO_PARTICIPANTS' | 'PAYOUT_EXCEEDS_STACK' | 'PAYOUT_EXCEEDS_CASHBOX' | 'NEGATIVE_AMOUNT' | 'NON_INTEGER_AMOUNT' | 'DUPLICATE_PLAYER'; playerId?: string }`.
3. `src/lib/settlement/distribute.ts`: `distribute(box: number, wants: number[]): number[]` mit Largest-Remainder-Methode in **BigInt** (keine Floats). Reihenfolge-Tie-Break wie spezifiziert.
4. `src/lib/settlement/transfers.ts`: `computeTransfers(residuals: {playerId, residual}[]): { transfers, uncoveredClaims, uncoveredDebts }` greedy wie spezifiziert.
5. `src/lib/settlement/index.ts`: `computeSettlement(participants: SettlementParticipant[]): SettlementResult` – Validierung, Sortierung (Eingabe kommt bereits nach `position` sortiert; die Funktion sortiert zusätzlich stabil nach `position`, dann `name`, dann `playerId`), Stufen 1–3, Residuen, Transfers. `algorithmVersion = 1`.
6. `src/lib/settlement/format.ts`: `describeTransfer(t, names)` → „Can schuldet Ali 40,00 €“ (nutzt `formatCents`).
7. Tests `src/lib/settlement/settlement.test.ts`: **alle** TV1–TV12 aus `docs/SETTLEMENT.md` als Tabellen-Tests mit exakten Erwartungswerten (Cent) für `cashTier1/2/3`, `cashFromBox`, `residual`, `transfers`, `unallocatedCash`, `uncoveredClaims`, `discrepancy`.
8. Tests `src/lib/settlement/distribute.test.ts`: Grenzfälle (leer, alle wants 0, box 0, box ≥ Σ, Rest-Verteilung mit Gleichstand).
9. Property-Tests `src/lib/settlement/settlement.property.test.ts` mit `fast-check`: zufällige Teilnehmer (2–10, Beträge 0–100.000 Cent in 50-Cent-Schritten, Stacks so gewählt, dass `discrepancy = 0`, payouts ≤ stack und ≤ Kasse) → alle Invarianten 1–9 aus `docs/SETTLEMENT.md`. Mindestens 500 Läufe.
10. `README`-Abschnitt in `src/lib/settlement/README.md`: 10 Zeilen, wie man die Funktion nutzt, Verweis auf `docs/SETTLEMENT.md`.
11. Commit `WP3: settlement algorithm with tests`.

**DoD**

- Alle TV1–TV12 grün mit exakten Zahlen. Property-Tests grün.
- Coverage für `src/lib/settlement/**` ≥ 95 % Zeilen.
- Keine Float-Arithmetik in `distribute` (Grep nach `/`-Division auf `number` in der Datei liefert nichts außerhalb von BigInt).

**Testauftrag Gaby**

- Jeden TV aus `docs/SETTLEMENT.md` von Hand nachrechnen und mit den Erwartungswerten **im Test** vergleichen (nicht nur mit dem Code!). Abweichung zwischen Test und Dokument = Blocker.
- Eigene Gegenbeispiele in `tests/gaby/settlement.gaby.test.ts`: (a) drei Bar-Zahler mit unterschiedlichen Einsätzen 50/100/200; (b) Frühgeher-Payout kleiner als sein Anspruch; (c) alle auf Liste, kein Bargeld (box 0, nur Transfers); (d) 9 Spieler mit ungeraden Cent-Beträgen (Rundung); (e) Permutations-Test: gleiche Teilnehmer in anderer Reihenfolge → nach Sortierung identisches Ergebnis.
- Invariante 6 explizit angreifen: gibt es eine Eingabe, bei der ein Listen-Spieler Bargeld bekommt, obwohl ein Bar-Zahler noch offen ist?
- Determinismus: Test zweimal laufen lassen, Ergebnis identisch.

---

## WP4 – Spieler-Verwaltung, Session-Liste, Session anlegen

**Ziel**: Erste echte Screens: Sessions sehen und anlegen, Spieler anlegen und umbenennen.

**Abhängigkeiten**: WP2.

**Implementation Plan**

1. `src/actions/sessions.ts`: `createSession({ playedOn, name })` (zod-validiert, `requireEditor`), `updateSessionMeta({ id, playedOn, name })`, `deleteOpenSession(id)` (`requireAdmin`). Alle mit `revalidatePath`.
2. `src/actions/players.ts`: `createPlayer({ name })` (Duplikat → Fehler `PLAYER_EXISTS` mit Text „Diesen Spieler gibt es schon“), `renamePlayer({ id, name })`.
3. `src/lib/queries/sessions.ts` (Server): `listSessions()` liefert je Session: `id, playedOn, name, status, participantCount, totalBuyInCents` (View oder Aggregat-Query; bei Bedarf DB-View `session_overview` in `supabase/migrations/0005_views.sql` mit RLS-freundlichem `security_invoker = true`).
4. `src/app/(app)/page.tsx` = Session-Liste: Karten, neueste oben, Datum (`Fr, 12.09.2026`), Name, „5 Spieler · 800,00 € Buy-ins“, Status-Badge (Offen grün / Abgeschlossen grau). Sticky-Button „Neue Session“ unten (nur Editor+). Leerzustand: „Noch keine Session. Leg die erste an.“
5. `src/app/(app)/sessions/new/page.tsx`: Formular Datum (Default heute, Europe/Berlin), Name optional. Nach Anlegen Redirect auf `/sessions/[id]`.
6. `src/app/(app)/players/page.tsx` (vorläufige Version, WP7 erweitert): Liste aller Spieler alphabetisch, „Spieler anlegen“ (Editor+), Umbenennen inline (Editor+).
7. UI-Bausteine in `src/components/ui/`: `Button` (Größen `md`/`lg`, Varianten primary/secondary/danger, min. 44 px Höhe), `Card`, `Badge`, `Input`, `Sheet` (Bottom-Sheet für Mobile-Dialoge), `EmptyState`, `Toast` (einfacher Kontext für Erfolg/Fehler).
8. `src/app/(app)/sessions/[id]/page.tsx`: vorläufig nur Kopfzeile (Datum, Name, Status) – WP5 füllt.
9. Commit `WP4: sessions list, create session, players admin`.

**DoD**

- Editor kann Session anlegen und landet auf der Detailseite; Liste zeigt sie oben.
- Viewer sieht keine Anlege-/Bearbeiten-Buttons; ein direkter Aufruf der Server Action als Viewer liefert `FORBIDDEN` (und RLS würde ohnehin blocken).
- Duplikat-Spielername wird abgefangen (auch „ ali “ vs „Ali“).
- Mobile-Layout 375 px Breite ohne horizontales Scrollen.

**Testauftrag Gaby**

- Server Actions: zod-Schemas prüfen (Datum nicht in ferner Zukunft? Regel: max. heute + 1 Tag; Name getrimmt, ≤ 60 Zeichen).
- Rollenprüfung in jeder Action vorhanden (`requireEditor`/`requireAdmin`)? Tabelle aller Actions × Prüfung im Report.
- `listSessions` macht keine N+1-Abfragen (eine Query oder View).
- Build und `check` grün; Lint-Regeln nicht deaktiviert.

---

## WP5 – Session-Detail: Teilnehmer, Buy-ins, Cash-out, Auszahlung, Verlauf, Realtime

**Ziel**: Der Screen, der am Tisch benutzt wird. Alles in wenigen Tipps, live synchron.

**Abhängigkeiten**: WP4, WP3 (für Live-Vorschau der Kassenverteilung).

**Implementation Plan**

1. `src/actions/entries.ts`: `addParticipant({ sessionId, playerId })`, `addParticipantByNewPlayer({ sessionId, name })`, `removeParticipant`, `addBuyIn({ sessionId, playerId, amountCents, payment })`, `addCashOut({ sessionId, playerId, amountCents })`, `updateCashOut`, `deleteEntry({ id })`, `addPayout({ sessionId, playerId, amountCents })`. Alle zod + `requireEditor`. DB-Trigger-Fehlercodes (`SESSION_CLOSED`, `PLAYER_ALREADY_CASHED_OUT`, `PAYOUT_EXCEEDS_STACK`, …) werden in deutsche Meldungen übersetzt (`src/lib/errors/de.ts`).
2. `src/lib/queries/sessionDetail.ts`: lädt Session, Teilnehmer (mit Spielername, `position`), alle Entries (mit Erfasser-Name/E-Mail), Settlement falls vorhanden, Settings (Schnellbeträge).
3. `src/lib/session/derive.ts` (reine Funktionen, getestet): aus Entries je Teilnehmer `cashIn`, `creditIn`, `stack | null`, `payout`, `net` (falls Stack vorhanden), Session-Summen (`totalBuyIn`, `totalCash`, `totalCredit`, `totalStack`, `cashBox = totalCash − Σ payout`, `openParticipants`), `canClose` (alle haben Stack), `discrepancy`.
4. `src/app/(app)/sessions/[id]/page.tsx` (Server) + `SessionDetailClient.tsx` (Client, hält State, abonniert Realtime):
   - **Kopf**: Datum, Name, Status-Badge; Kennzahlen als 2×2-Kacheln: Buy-ins gesamt, davon bar / Liste, Kasse aktuell, Stacks gezählt (x von n).
   - **Teilnehmer-Karten** (Beitrittsreihenfolge): Name, Buy-ins „100 € bar + 100 € Liste“, Stack oder „spielt noch“, Auszahlung falls vorhanden, Plus/Minus farbig sobald Stack da. Tippen öffnet Bottom-Sheet mit Aktionen: „Buy-in“, „Aussteigen (Stack eintragen)“, „Bar-Auszahlung“ (nur wenn Stack vorhanden), „Stack ändern“, „Teilnehmer entfernen“ (nur ohne Einträge).
   - **Buy-in-Sheet**: Schnellbeträge aus Settings als große Buttons, freies Feld, Umschalter „Bar / Liste“ (zuletzt gewählte Zahlungsart je Spieler vorbelegt), Button „Eintragen“. Nach Erfolg Toast „100,00 € bar für Ali eingetragen“.
   - **Cash-out-Sheet**: Betrag frei (0 erlaubt), Hinweis „Danach keine Buy-ins mehr für diesen Spieler“.
   - **Auszahlungs-Sheet**: Betrag, darunter Info „Kasse: 250,00 €“ und „Nach Bar-zuerst-Regel stünden Ali aktuell ca. 180,00 € zu“ (Vorschau über `computeSettlement` mit aktuellen Daten; Teilnehmer ohne Stack werden für die Vorschau mit ihrem aktuellen Buy-in als Stack angenommen, das wird als „vorläufig“ gekennzeichnet).
   - **Teilnehmer hinzufügen**: Sheet mit Suchfeld, bestehende Spieler (die noch nicht drin sind), „Neuen Spieler ‚Xyz‘ anlegen“.
   - **Verlauf**: chronologische Liste aller Entries: `21:14 · Ali · Buy-in 100,00 € bar · von sirat@…`, Cash-outs und Auszahlungen ebenso, gelöschte Einträge erscheinen hier nicht (die stehen im Audit-Log). Editor+ kann Einträge löschen (Bestätigung).
   - **Realtime**: Supabase-Channel auf `entries`, `session_players`, `sessions` gefiltert nach `session_id`; bei Event Daten neu laden (`router.refresh()` oder gezielter Refetch). Reconnect-Handling: bei `CHANNEL_ERROR` einmal neu abonnieren, Hinweis „Verbindung getrennt“ nach 10 s.
   - **Rollen**: Viewer sieht alles, aber keine Aktions-Buttons. Bei `closed` sind alle Aktionen aus, stattdessen Abrechnung (WP6).
5. Optimistic UI nur für Buy-in (häufigste Aktion); bei Fehler zurückrollen und Toast.
6. Tests: `derive.test.ts` (Summen, `canClose`, Kasse nach Payout, Spieler ohne Stack).
7. Commit `WP5: session detail with live entries`.

**DoD**

- Buy-in in drei Tipps (Spieler → Betrag → Bar/Liste ist der Bestätigungsbutton, wenn ein Schnellbetrag gewählt wurde).
- Zweites Gerät/Tab sieht neue Einträge innerhalb von 2 s ohne Neuladen.
- Trigger-Fehler erscheinen als verständliche deutsche Toasts, nie als rohe Postgres-Meldung.
- Mobile 375 px: keine horizontalen Scrollbalken, alle Tipp-Ziele ≥ 44 px.

**Testauftrag Gaby**

- `derive.ts` gegen Handrechnung testen; Grenzfälle (Stack 0, mehrere Payouts, Spieler ohne Buy-in aber mit Stack 0).
- Fehlercode-Mapping vollständig: jeder Code aus WP1-Triggern hat eine deutsche Meldung (Tabelle im Report).
- Code-Review Realtime: Channel wird bei Unmount entfernt? Kein doppeltes Abonnement bei Re-Render?
- Alle Actions `requireEditor`? Zod-Schemas: Betrag Integer > 0 (Cash-out ≥ 0), Obergrenze 1.000.000 Cent (Tippfehler-Schutz) mit Meldung.
- Der Planer übernimmt die manuelle Browser-Prüfung (zwei Tabs, Realtime, Mobile-Viewport) und dokumentiert sie im Report-Anhang.

---

## WP6 – Session abschließen, wieder öffnen, Abrechnung anzeigen

**Ziel**: Abschluss mit Differenzprüfung, eingefrorene Abrechnung, verständliche Anzeige „wer bekommt was aus der Kasse“ und „wer schuldet wem“.

**Abhängigkeiten**: WP5, WP3.

**Implementation Plan**

1. `src/actions/close.ts`: `previewSettlement(sessionId)` (liest `settlement_input`, ruft `computeSettlement`, gibt Ergebnis + `canClose`, `missingCashOuts[]`), `closeSession({ sessionId, note })`: berechnet serverseitig neu, ruft RPC `close_session(p_session_id, p_settlement, p_note)`; Fehlercodes übersetzen (`MISSING_CASH_OUT`, `DISCREPANCY_REQUIRES_ADMIN_NOTE`, `SETTLEMENT_MISMATCH` → „Daten haben sich geändert, bitte erneut prüfen“). `reopenSession({ sessionId, reason })` → RPC, `requireAdmin`.
2. Abschluss-Bereich am Ende der Detailseite (nur `open`, Editor+):
   - Checkliste: „Alle Spieler haben einen Stack (5/5)“, „Buy-ins 800,00 € = Stacks 800,00 €“ grün, oder rot „Differenz −20,00 €: 20,00 € weniger gezählt als eingekauft“.
   - Vorschau der Abrechnung (gleiche Komponente wie die finale Anzeige, mit Wasserzeichen „Vorschau“).
   - Button „Session abschließen“. Bei Differenz: für Editor deaktiviert mit Hinweis „Nur ein Admin kann mit Differenz abschließen“; für Admin Pflichtfeld „Kommentar zur Differenz“.
   - Bestätigungs-Sheet: „Danach kann nichts mehr geändert werden. Nur ein Admin kann wieder öffnen.“
3. `src/components/settlement/SettlementView.tsx`:
   - **Block 1 „Aus der Kasse“**: je Spieler Zeile „Ali bekommt 250,00 € bar“ (nur `cashFromBox > 0`), Summe = Kasse. Bei `unallocatedCash > 0`: „Bleibt in der Kasse: 10,00 € (Differenz)“.
   - **Block 2 „Überweisungen“**: „Can → Ali 40,00 €“ groß und klar, Summe. Falls leer: „Keine Schulden, alles bar erledigt.“ Bei `uncoveredClaims > 0`: Warnung „10,00 € Anspruch ohne Deckung (Differenz)“.
   - **Block 3 „Ergebnis des Abends“**: Tabelle je Spieler: Buy-in bar / Liste, Stack, Auszahlung, Plus/Minus (farbig), sortiert nach Plus/Minus absteigend.
   - Aufklappbar „Rechenweg“: Stufe 1/2/3 je Spieler (für Diskussionen am Tisch).
4. Abgeschlossene Session: Kopf zeigt „Abgeschlossen am … von …“, Differenz + Kommentar falls vorhanden, dann `SettlementView` mit gespeicherten Daten (nicht neu berechnet!), darunter Verlauf read-only. Admin: Button „Wieder öffnen“ mit Pflichtgrund.
5. Teilen: Button „Abrechnung kopieren“ erzeugt Klartext (für WhatsApp): Datum, „Aus der Kasse: …“, „Überweisungen: …“. `navigator.clipboard`, Fallback Textarea.
6. Tests: `src/lib/settlement/toPersist.test.ts` (Mapping Result → RPC-JSON und zurück ist verlustfrei), `shareText.test.ts`.
7. Commit `WP6: close/reopen session, settlement view`.

**DoD**

- Session mit Differenz: Editor kann nicht abschließen, Admin nur mit Kommentar; gespeicherte `discrepancy_cents` und `close_note` sichtbar.
- Nach Abschluss ist jede Schreibaktion in der UI weg und serverseitig blockiert (Toast „Session ist abgeschlossen“ bei Race).
- Gespeicherte Abrechnung entspricht exakt der Vorschau vor dem Klick (gleiche Eingabe).
- Wieder öffnen löscht die Abrechnung, Log zeigt Grund; erneutes Abschließen erzeugt neue Abrechnung.

**Testauftrag Gaby**

- Vergleich: Anzeige nutzt gespeicherte Werte, nicht Neuberechnung? (Code-Review + Test mit manipuliertem Fixture.)
- Race: Zwei Abschlüsse gleichzeitig → zweiter bekommt `SESSION_CLOSED`/`SETTLEMENT_MISMATCH`, kein Duplikat (PK auf `settlements.session_id`).
- Share-Text gegen TV2 und TV4: exakt lesbar, Beträge korrekt formatiert.
- `SettlementView` mit TV8 (Cent-Rundung) und TV9/TV9b/TV10 (Differenz-Hinweise; bei TV9b müssen `unallocatedCash` und `uncoveredDebts` beide sichtbar sein) als Snapshot-/Text-Test in `tests/gaby/`.
- Server Action `closeSession` gegen manipulierte Eingaben: Die DB-Funktion prüft nur Plausibilität (siehe `tests/gaby/wp1-close-session.gaby.test.ts`). Die Action muss die Abrechnung **immer selbst** aus `settlement_input` berechnen und darf nie ein vom Client geliefertes Ergebnis durchreichen. Zusätzlich prüfen: Stufe-1-Kürzung (Invariante 5) und Deckung je Schuldner in den Transfers werden von der DB nicht geprüft; die Action ist hier die einzige Verteidigung.

---

## WP7 – Spieler-Übersicht und Spieler-Detail

**Ziel**: Bilanz über alle Abende.

**Abhängigkeiten**: WP6 (Ergebnisse kommen aus `settlement_lines` abgeschlossener Sessions).

**Implementation Plan**

1. DB-View `player_stats` (Migration `0006_player_stats.sql`, `security_invoker = true`): je Spieler `sessions_played` (abgeschlossene), `total_buy_in_cents`, `total_stack_cents`, `net_cents`, `last_played_on`, `open_sessions` (Anzahl offener Sessions mit Teilnahme).
2. `src/app/(app)/players/page.tsx`: Tabelle/Karten: Name, Sessions, Buy-ins, Stacks, Bilanz (farbig), Sortierung per Tap auf Spaltenkopf (Default Bilanz absteigend), Suchfeld. Anlegen/Umbenennen aus WP4 bleibt.
3. `src/app/(app)/players/[id]/page.tsx`: Kopf mit Gesamtbilanz; Liste je Session (neueste oben): Datum, Buy-ins bar/Liste, Stack, Ergebnis, Link zur Session. Offene Sessions als „läuft“ markiert ohne Ergebnis.
4. Aus der Session-Detail-Karte auf den Spieler verlinken.
5. Commit `WP7: player overview and detail`.

**DoD**

- Zahlen der Übersicht stimmen mit der Summe der Session-Ergebnisse überein (Gaby prüft mit Fixture).
- Sortierung und Suche funktionieren, mobil lesbar (Zahlen rechtsbündig, tabellarisch).

**Testauftrag Gaby**

- View-SQL: nur `closed`-Sessions zählen? Spieler ohne Sessions erscheinen mit 0?
- Konsistenzprüfung: Summe aller `net_cents` über alle Spieler = Summe aller `discrepancy_cents` (bei sauberen Sessions 0).

---

## WP8 – Admin-Bereich und Audit-Log-Ansicht

**Ziel**: Rollen pflegen, Schnellbeträge pflegen, Log lesen.

**Abhängigkeiten**: WP6.

**Implementation Plan**

1. `src/actions/admin.ts`: `setUserRole({ userId, role })` (`requireAdmin`; `LAST_ADMIN` → „Der letzte Admin kann nicht degradiert werden“), `setQuickAmounts({ cents: number[] })` (1–6 Werte, je > 0, eindeutig, sortiert speichern), `upsertWhitelist({ email, role })` und `removeWhitelist(email)`.
2. `src/app/(app)/admin/page.tsx` (nur Admin, sonst 404-ähnliche Seite „Kein Zugriff“): 
   - Nutzerliste: Avatar, Name, E-Mail, Rolle als Dropdown, „zuletzt gesehen“ (aus `auth.users.last_sign_in_at` nicht zugänglich → weglassen), Anzahl Einträge im Log.
   - Whitelist: Adressen mit Rolle, hinzufügen/entfernen (für Personen, die sich noch nie eingeloggt haben).
   - Schnellbeträge: Chips editierbar, Vorschau wie im Buy-in-Sheet.
3. `src/app/(app)/log/page.tsx`: Liste aus `audit_log`, neueste oben, 50 pro Seite („Mehr laden“), je Zeile: Zeit, Nutzer, lesbare Beschreibung („hat Buy-in 100,00 € bar für Ali eingetragen“, „hat Session vom 12.09. abgeschlossen“, „hat Rolle von X auf Bearbeiter gesetzt“), aufklappbar Rohdaten (alt/neu als JSON). Filter: Session, Nutzer, Tabelle. Beschreibungs-Mapping in `src/lib/audit/describe.ts` (getestet).
4. In der Session-Detailseite Link „Log dieser Session“ (vorgefiltert).
5. Commit `WP8: admin area and audit log`.

**DoD**

- Rolle ändern wirkt sofort (neue Serveranfrage des Betroffenen zeigt neue Rechte).
- Letzter Admin kann sich nicht degradieren (Meldung).
- Log zeigt jede Aktion aus WP4–WP6 lesbar; gelöschte Einträge sind mit alten Werten sichtbar.

**Testauftrag Gaby**

- `describe.ts` für jeden Tabellen×Aktion-Fall getestet (Tabelle im Report; unbekannte Fälle liefern generischen Text, nie Absturz).
- Admin-Seite serverseitig geschützt (nicht nur Tab ausgeblendet)?
- Pagination korrekt (kein Überspringen bei gleichem Zeitstempel → Sortierung `at desc, id desc`, Cursor auf `id`).

---

## WP9 – PWA, Mobile-Polish, Fehlerzustände

**Ziel**: Fühlt sich am Handy wie eine App an, verzeiht schlechte Verbindung.

**Abhängigkeiten**: WP8.

**Implementation Plan**

1. `src/app/manifest.ts` (Name „Poker-Kasse“, `display: standalone`, Theme-Farbe, Icons 192/512 als PNG in `public/icons/`, generiert aus einem einfachen SVG-Chip-Motiv), Apple-Meta-Tags, `theme-color`.
2. Kein Offline-Caching von Daten (Geldbeträge dürfen nicht veralten); nur App-Shell-Caching optional weglassen, wenn es Komplexität bringt. Stattdessen: Offline-Banner „Keine Verbindung“ via `navigator.onLine` + Realtime-Status; Aktionen währenddessen deaktiviert.
3. Ladezustände: `loading.tsx` je Route mit Skeletons; `error.tsx` mit „Erneut versuchen“.
4. Dark Mode über `prefers-color-scheme` (Tailwind `dark:`), Kontrast prüfen.
5. Safe-Area-Insets (iPhone-Notch) für untere Tab-Leiste.
6. Zahlenformatierung final: tabellarische Ziffern (`tabular-nums`), Minus mit echtem Minuszeichen.
7. Bestätigung vor destruktiven Aktionen einheitlich (Sheet mit rotem Button).
8. Lighthouse (mobil) ≥ 90 in Performance, Accessibility, Best Practices, PWA installierbar.
9. Commit `WP9: PWA and mobile polish`.

**DoD**

- Auf Android Chrome und iOS Safari „Zum Home-Bildschirm“ möglich, startet ohne Browser-Leiste.
- Alle Seiten haben Lade- und Fehlerzustand.
- Lighthouse-Werte dokumentiert (Screenshot/JSON in `qa/reports/WP9-lighthouse.json`).

**Testauftrag Gaby**

- Manifest-Validität (Pflichtfelder, Icon-Größen, `start_url` mit Login-Redirect kompatibel).
- Kontrast-Check der Plus/Minus-Farben in Light und Dark (WCAG AA).
- Fokus-Reihenfolge und Labels der Sheets (Screenreader-Basis).

---

## WP10 – Deployment

**Ziel**: Live unter einer Vercel-URL, Google-Login funktioniert dort, automatische Deploys.

**Abhängigkeiten**: WP9; GitHub-Repo und Vercel-Konto des Auftraggebers.

**Implementation Plan**

1. GitHub-Repo (privat) anlegen – macht der Auftraggeber oder der Planer nach Freigabe; `git remote add origin`, Push `main`.
2. Vercel-Projekt aus dem Repo, Framework Next.js, Env-Variablen `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Production + Preview).
3. Supabase Auth: „Site URL“ auf die Vercel-Produktions-URL; „Redirect URLs“: `https://<prod>/auth/callback`, `https://*-<team>.vercel.app/auth/callback` (Previews), `http://localhost:3000/auth/callback`.
4. Google Cloud Console: autorisierte JavaScript-Ursprünge um die Vercel-URL ergänzen (Redirect-URI bleibt die Supabase-Callback-URL).
5. `vercel.json` nur falls nötig (Region `fra1`).
6. Smoke-Test in Produktion: Login, Session anlegen, Buy-in, Cash-out, Abschluss, Log. Ergebnis in `qa/reports/WP10-smoke.md`.
7. Schutz: Vercel „Deployment Protection“ für Previews an (nur Team), Production öffentlich (Login schützt).
8. `docs/BETRIEB.md`: Wie man Rollen pflegt, wie man eine Migration nachzieht, wo Logs liegen, was bei „Provider nicht konfiguriert“ zu tun ist.
9. Commit `WP10: deployment config and ops docs`.

**DoD**

- Produktions-URL funktioniert auf dem Handy des Auftraggebers mit dessen Google-Konto (Rolle Admin).
- Jeder Push auf `main` deployt automatisch; Preview-Deploys für Branches.

**Testauftrag Gaby**

- `docs/BETRIEB.md` auf Vollständigkeit: kann eine fremde Person damit einen neuen Editor freischalten und eine Migration einspielen?
- Keine Secrets im Repo (`git log -p | grep -i secret` etc.), `.env.example` aktuell.

---

## WP11 – Manuelle Übersteuerung der Abrechnung in der Vorschau

**Ziel**: In der Live-Vorschau einer offenen Session kann ein Admin die vom Algorithmus vorgeschlagenen „Aus der Kasse“-Auszahlungen **und** die „Überweisungen“ (Spieler→Spieler) frei überschreiben – beliebige Beträge und Paarungen, ohne Stimmigkeitsprüfung gegen Buy-ins/Stacks. Beim Abschluss wird die **manuell bearbeitete** Abrechnung eingefroren gespeichert. Abgeschlossene Sessions bleiben unveränderlich; nur der Vorschau-Zustand ist editierbar.

**Planer-Entscheidung (Grundlage)**: Dieses Paket durchbricht bewusst die Kern-Garantie aus `docs/SETTLEMENT.md` („Abrechnung ist deterministisch reproduzierbar und serverseitig verifiziert“). Der Bruch ist **ausdrücklich und auditierbar**, nie heimlich. Freiheitsgrad: frei wählbare Beträge/Paarungen, aber Grundintegrität bleibt (Überweisungsbetrag > 0, keine Selbst-Überweisung, nur real teilnehmende Spieler, Integer-Cent). Die DB-Check-Constraints auf `settlement_transfers` bleiben unangetastet.

**Abhängigkeiten**: WP6.

**Implementation Plan**

1. **Doc (Planer)**: `docs/SPEC.md` und `docs/SETTLEMENT.md` um den Abschnitt „Manuelle Übersteuerung in der Vorschau“ ergänzen: wann erlaubt (nur offene Session, nur Admin), was frei ist, was invariant bleibt (Grundintegrität), und dass die gespeicherte Abrechnung dann als `is_manual` markiert und nicht mehr aus den Entries reproduzierbar ist. TV1–TV12 bleiben unverändert und gelten weiter für den **Automatik**-Pfad.
2. **DB-Migration `supabase/migrations/0008_manual_settlement.sql`**:
   - Spalte `settlements.is_manual boolean not null default false`.
   - Neuer, expliziter Schreibpfad im Abschluss: entweder `close_session` um `p_manual boolean` erweitern **oder** eine getrennte RPC `close_session_manual(p_session_id, p_settlement, p_note)`. Im Manual-Pfad entfällt der Zeilen-für-Zeilen-Neurechen-Abgleich aus den Entries (`0002:790-837`) und die algorithmischen Invarianten (Stufen/Deckung, `0002:839-931`); es bleiben: Referenz-Integrität (Spieler nehmen an der Session teil, `0002:987-996`), `amount_cents > 0`, `from != to`, Integer, und die Session-Status-/Existenz-Guards. Header-`*_cents` in `settlements` werden aus dem übergebenen `p_settlement` übernommen, nicht neu gerechnet.
   - Audit-Trigger auf `settlement_lines` und `settlement_transfers` ergänzen (heute nicht auditiert), damit die manuellen Werte im Log erscheinen; alternativ die Overrides kompakt in `settlements` (JSONB) mitschreiben, das `audit_settlements` bereits erfasst. Entscheidung im Handoff begründen.
   - Manual-Abschluss nur für Admin (SECURITY DEFINER prüft Rolle wie `close_session`); `p_note` Pflicht (Begründung der Übersteuerung).
3. **`src/actions/close.ts`**: neue Action `closeSessionManual({ sessionId, settlement, note })` (oder `closeSession` um `manual`-Flag erweitern). `requireAdmin`. Die manuell edierte Abrechnung wird durchgereicht (**nicht** neu gerechnet). `verifySettlement` wird im Manual-Modus durch eine schlanke Prüfung ersetzt (nur Grundintegrität, s. o.). Fehlercodes deutsch übersetzen.
4. **`src/lib/settlement/verify.ts`** (oder neues `verifyManual.ts`): laxe Validierung für den Override – Integer-Cent, alle Transfer-Beträge > 0, `from != to`, alle Spieler-IDs sind Teilnehmer, cash-payouts ≥ 0. Keine Prüfung gegen Buy-ins/Stacks/Netto.
5. **`src/lib/settlement/toPersist.ts`**: `SettlementPayload` um `isManual` erweitern; Round-Trip (`fromStoredRows`) muss das Flag mitführen.
6. **UI – Editor in der Vorschau** (`src/components/sessions/CloseSessionPanel.tsx` + neue `src/components/settlement/SettlementEditor.tsx`, nur `open` + Admin):
   - Umschalter „Automatisch / Manuell bearbeiten“. Standard bleibt Automatik.
   - Manuell: editierbare „Aus der Kasse“-Liste (Betrag je Spieler) und editierbare Überweisungsliste (Zeile hinzufügen/entfernen, Von/An per Auswahl aus den Teilnehmern, Betrag). Betragseingabe über das bestehende Muster `AmountField` / `parseEuroInput` (Integer-Cent).
   - Live-Summen anzeigen (Kasse-Summe, Überweisungs-Summe), aber **nicht** blockieren. Neutraler Hinweis, wenn Summen nicht zum Ergebnis passen („frei bearbeitet – nicht geprüft“), kein Fehler.
   - Bestätigungs-Sheet beim Abschluss: „Manuell bearbeitete Abrechnung. Wird unverändert gespeichert und kann nur von einem Admin durch Wiederöffnen zurückgesetzt werden.“ Pflichtfeld Begründung.
7. **Anzeige** (`src/components/settlement/SettlementView.tsx`): bei `is_manual` ein deutlicher, ruhiger Hinweis „Manuell bearbeitet“ in der eingefrorenen Ansicht (und im Kopf der abgeschlossenen Session). `SettlementView` bleibt read-only für `final`.
8. **Share-Text** (`src/lib/settlement/shareText.ts`): unverändertes Format, aber Zeile „(manuell bearbeitet)“ ergänzen, wenn `isManual`.
9. **Tests**: `src/actions/close.test.ts` (Manual-Pfad reicht Zahlen durch, Automatik unverändert), `verifyManual.test.ts` (Grundintegrität greift, Reconciliation nicht), `toPersist.test.ts` (Flag verlustfrei). TV1–TV12 in `settlement.test.ts` bleiben grün und unangetastet.
10. Commit `WP11: manual settlement override in preview`.

**DoD**

- Automatik-Pfad verhält sich exakt wie in WP6 (TV1–TV12 grün); Manual ist ein bewusst gewählter Nebenweg, kein Ersatz.
- Als Admin lassen sich in der offenen Vorschau Kasse-Beträge und Überweisungen (Beträge + Paarungen) frei setzen; der Abschluss speichert genau diese Werte.
- Abgeschlossene Session zeigt die manuell gesetzten Werte aus der DB (nie neu berechnet) mit „Manuell bearbeitet“-Hinweis und Pflicht-Begründung.
- Manuelle Werte erscheinen im Audit-Log; `is_manual` ist gesetzt.
- Grundintegrität serverseitig erzwungen (Betrag > 0, kein Selbst-Transfer, echte Teilnehmer, Integer-Cent); keine Reconciliation-Prüfung.
- Wieder öffnen löscht die (manuelle) Abrechnung wie gehabt.
- `npm run check` + `npm run build` grün; Übergabe in `qa/handoffs/WP11-siri.md`.

**Testauftrag Gaby**

- Nachweis, dass der **Automatik**-Pfad unverändert ist (TV1–TV12, `verifySettlement`, RPC-Neurechen weiterhin scharf für den Nicht-Manual-Fall).
- Manual-Abschluss mit absichtlich „unstimmigen“ Zahlen (Kasse ≠ Auszahlungen, Transfer-Summe ≠ Residuen) wird gespeichert und exakt so wieder angezeigt – aus der DB, nicht neu gerechnet (Test mit Fixture).
- Grundintegrität greift: Transfer mit Betrag 0/negativ, Selbst-Transfer, Nicht-Teilnehmer, Nicht-Integer → serverseitig abgelehnt (RPC/Action, nicht nur UI).
- Rolle: Editor kann **nicht** manuell übersteuern (nur Admin); UI-Ausblendung + serverseitige Sperre getrennt geprüft.
- Audit: manuelle Werte und `is_manual` sind im Log nachvollziehbar; `reopen` entfernt die Abrechnung.
- Race/Immutabilität: kein Schreibpfad auf eine abgeschlossene Session; `settlement_lines`/`settlement_transfers` bleiben ohne RPC unbeschreibbar (RLS).
