# WP1 – Übergabe Siri

**Einspielen: nein.** Die Supabase-CLI ist in diesem Paket nicht verlinkt, deshalb wurde nichts
in das Cloud-Projekt geschrieben. Alle vier Migrationen sind so geschrieben, dass sie sowohl per
`npx supabase db push` als auch per Copy-Paste in den SQL-Editor laufen. `npm run rls:smoke` ist
damit **nicht verifiziert** (Details unter „Prüfung“).

## Umgesetzt

### Migrationen (`supabase/migrations/`, Reihenfolge 0001 → 0004, jede Datei eigenständig)

- **`0001_schema.sql`** – Enums `app_role`, `session_status`, `entry_type`, `payment_method`
  (per `do $$ … exception when duplicate_object $$`, weil `create type` kein `if not exists` kennt).
  Tabellen `role_whitelist`, `app_users`, `players`, `sessions`, `session_players`, `entries`,
  `settlements`, `settlement_lines`, `settlement_transfers`, `settings`, `audit_log` – alle mit
  `create table if not exists`, alle Indizes mit `create index if not exists`.
  Enthält den Partial-Unique-Index `entries_one_cash_out_per_player`
  (`(session_id, player_id) where type = 'cash_out'`), die Check-Constraints für
  `payment` ⇔ `buy_in` und für die Betragsvorzeichen, sowie das Settings-Seed
  `quick_amounts_cents = [5000,10000,20000]` (`on conflict do nothing`).
- **`0002_functions_triggers.sql`** – Rollen-Helfer `current_app_role()`, `is_admin()`,
  `is_editor()`, `session_is_open()`; Trigger `handle_new_auth_user`, `protect_last_admin`,
  `protect_app_user_columns`, `touch_updated_at`, `audit_row_change` (7 Tabellen),
  `validate_entry`, `validate_session_update`, `validate_session_player_delete`;
  RPCs `settlement_input`, `close_session`, `reopen_session` inkl. `grant`/`revoke`.
- **`0003_rls.sql`** – `enable row level security` für alle elf Tabellen, 28 Policies (alle
  `to authenticated`, jede vorher `drop policy if exists`), dazu explizite Grants: `anon` bekommt
  auf keiner Tabelle irgendein Recht, `authenticated` genau die Rechte aus der Plan-Matrix.
- **`0004_realtime.sql`** – fügt `sessions`, `session_players`, `entries`, `players`, `settings`
  zur Publication `supabase_realtime` hinzu (nur, wenn sie fehlen; Publication fehlt → `notice`
  statt Fehler) und setzt `replica identity full` auf `entries`.

### Weitere Dateien

- **`supabase/seed.sql`** – Rollen-Whitelist mit den Platzhaltern `ADMIN_EMAIL_1/2/3` plus
  Kommentarblock zum Ersetzen, auskommentierte Editor-Zeile, Settings-Seed und ein
  Nachtrags-`update` für Konten, die sich schon vor dem Seed eingeloggt hatten.
- **`supabase/config.toml`** – `project_id = "vcyqzqgybjggoreffwjc"`, damit `link` und `db push`
  funktionieren, sobald die CLI verlinkt ist.
- **`src/lib/database.types.ts`** – von Hand geschrieben, aber exakt in der Struktur von
  `supabase gen types typescript` (`Database → public → Tables/Views/Functions/Enums`, je Tabelle
  `Row`/`Insert`/`Update`/`Relationships`), dazu die üblichen Helfer `Tables<>`, `TablesInsert<>`,
  `TablesUpdate<>`, `Enums<>` sowie die Konstante `TABLE_NAMES` (die das Smoke-Script nutzt).
- **`scripts/rls-smoke.ts`** – prüft ohne Login jede Tabelle (select + insert) und die fünf
  aufrufbaren Funktionen. „Geblockt“ ist sowohl ein Fehler (permission denied / RLS) als auch ein
  leeres Ergebnis; „Leck“ ist jede zurückgelieferte Zeile und jeder erfolgreiche Schreibzugriff.
- **`package.json`** – neue Scripts `rls:smoke` (`tsx scripts/rls-smoke.ts`) und `types:gen`.
- **`.gitignore`** – `/supabase/seed.local.sql` (Datei selbst bewusst **nicht** angelegt),
  dazu `/supabase/.temp` und `/supabase/.branches` (CLI-Arbeitsdateien).

## SPEC-Regel → Trigger / Policy / Check

| # | Regel (Quelle) | Durchgesetzt durch | Fehlercode |
|---|---|---|---|
| 1 | Jedes Google-Konto wird beim ersten Login `viewer` (SPEC 3) | Trigger `handle_new_auth_user` auf `auth.users`, `coalesce(whitelist.role, 'viewer')` | – |
| 2 | Whitelist-Rolle greift beim ersten Login (SPEC 3) | derselbe Trigger, `select role from role_whitelist where email = lower(new.email)` | – |
| 3 | Der letzte Admin kann sich nicht degradieren (SPEC 3) | Trigger `protect_last_admin` (`before update or delete on app_users`) | `LAST_ADMIN` |
| 4 | Rollen ändert nur ein Admin, und nur die Rolle (SPEC 3) | Policy `app_users_update` (`is_admin()`) + Trigger `protect_app_user_columns` | `FORBIDDEN`, `ONLY_ROLE_EDITABLE` |
| 5 | `viewer` darf nichts schreiben (SPEC 3) | keine Insert/Update/Delete-Policy ohne `is_editor()`/`is_admin()`; Grants zusätzlich | RLS (42501) |
| 6 | Ohne Login sieht man nichts (SPEC 3) | `revoke all … from anon` (0003) + keine einzige Policy `to anon` | 42501 / leer |
| 7 | Spielername 1–40 Zeichen, eindeutig auch bei „ ali “ vs „Ali“ (SPEC 4, WP4 DoD) | `check (length(trim(name)) between 1 and 40)` + generierte Spalte `name_normalized` + Unique-Index | 23514 / 23505 |
| 8 | Teilnehmer-Reihenfolge = Beitrittsreihenfolge (SPEC 4, SETTLEMENT „Eingabe“) | `session_players.position` + `unique (session_id, position)`; `settlement_input` sortiert danach | 23505 |
| 9 | `buy_in` hat Zahlungsart, `cash_out`/`payout` nicht (SPEC 4) | Check `entries_payment_only_for_buy_in` | 23514 |
| 10 | `cash_out` darf 0 sein, `buy_in`/`payout` müssen > 0 sein (SPEC 4) | Check `entries_amount_sign` | 23514 |
| 11 | Genau ein `cash_out` pro Spieler und Session (SPEC 4) | Partial-Unique-Index `entries_one_cash_out_per_player` | 23505 |
| 12 | Nach dem `cash_out` kein weiterer `buy_in` (SPEC 4) | `validate_entry` (b) | `PLAYER_ALREADY_CASHED_OUT` |
| 13 | …außer der `cash_out` wird gelöscht (SPEC 4) | Löschen erlaubt, solange kein `payout` existiert – `validate_entry` (e) | `CASH_OUT_HAS_PAYOUT` |
| 14 | `payout` setzt einen `cash_out` voraus (SPEC 4) | `validate_entry` (c) | `PAYOUT_REQUIRES_CASH_OUT` |
| 15 | `payout` ≤ Stack (SPEC 4, SETTLEMENT Vorbedingung) | `validate_entry` (c) | `PAYOUT_EXCEEDS_STACK` |
| 16 | Σ `payout` ≤ Kassenstand (SPEC 4, SETTLEMENT Vorbedingung) | `validate_entry` (c2) – bei **jeder** Operation, auch beim Löschen/Umbuchen eines Bar-Buy-ins | `PAYOUT_EXCEEDS_CASHBOX` |
| 17 | Stack darf nicht unter die schon ausgezahlte Summe sinken | `validate_entry` (d) | `STACK_BELOW_PAYOUT` |
| 18 | Erfassen nur in offenen Sessions (SPEC 5.6) | `validate_entry` (a) + Policies `entries_*` mit `session_is_open()` | `SESSION_CLOSED` |
| 19 | Teilnehmer nur ohne Einträge und nur bei offener Session entfernen | Trigger `validate_session_player_delete` + Policy `session_players_delete` | `PLAYER_HAS_ENTRIES`, `SESSION_CLOSED` |
| 20 | Status/Abschlussfelder nur über die RPCs (SPEC 5) | Trigger `validate_session_update`, Freigabe nur über `app.session_transition` | `USE_RPC` |
| 21 | Name/Datum nur änderbar, solange `open` (SPEC 5.6) | derselbe Trigger | `SESSION_CLOSED` |
| 22 | Abschluss erst, wenn alle Teilnehmer einen Stack haben (SPEC 5.4) | `close_session`, Zählung über `session_players` × `entries` | `MISSING_CASH_OUT` |
| 23 | Differenz ≠ 0 → nur Admin, Kommentar Pflicht (SPEC 5.5) | `close_session`, `is_admin()` **und** `length(trim(note)) >= 3` | `DISCREPANCY_REQUIRES_ADMIN_NOTE` |
| 24 | Differenz wird serverseitig nachgerechnet, nicht geglaubt (WP1) | `close_session` aggregiert `entries` neu und vergleicht Summen **und jede einzelne Zeile** | `SETTLEMENT_MISMATCH` |
| 25 | Kasseninvariante `Σ cashFromBox + unallocated = Σ cash − Σ payout` (SETTLEMENT Inv. 2) | `close_session` | `SETTLEMENT_INVARIANT` |
| 26 | `Σ transfers + uncoveredClaims = Σ positive residual` (SETTLEMENT Schritt 5) | `close_session` | `SETTLEMENT_INVARIANT` |
| 27 | Abrechnung wird eingefroren, nie neu berechnet (SPEC 4) | `settlements` PK auf `session_id`, keine Insert/Update/Delete-Policy – nur die RPCs schreiben | RLS |
| 28 | Wieder öffnen nur Admin, Grund Pflicht (SPEC 4/5.6) | `reopen_session` | `FORBIDDEN`, `REASON_REQUIRED`, `SESSION_NOT_CLOSED` |
| 29 | Wieder öffnen löscht die Abrechnung (SPEC 4) | `delete from settlements` (kaskadiert auf `_lines`/`_transfers`) | – |
| 30 | Alter `close_note` bleibt nachvollziehbar (WP1 Testauftrag) | Audit-Trigger auf `sessions` schreibt `old_data` mit dem alten Wert; der neue Wert hängt den Grund an | – |
| 31 | Audit-Log über jede schreibende Aktion (SPEC 4) | `audit_row_change` auf `sessions`, `session_players`, `entries`, `players`, `app_users`, `settings`, `settlements` | – |
| 32 | Audit-Log für alle lesbar, für niemanden änderbar (SPEC 4) | nur `audit_log_select`; kein Insert/Update/Delete-Grant, keine Policy; Trigger schreibt als Owner | RLS / 42501 |
| 33 | Session löschen nur Admin, nur `open`, nur ohne Abrechnung | Policy `sessions_delete` | RLS |
| 34 | Schnellauswahl-Beträge pflegt nur der Admin (SPEC 3) | Policies `settings_insert` / `settings_update` mit `is_admin()`, kein Delete | RLS |
| 35 | Whitelist pflegt nur der Admin | vier Policies auf `role_whitelist`, alle `is_admin()` | RLS |
| 36 | Geld ist Integer-Cent (CLAUDE.md) | alle Beträge `integer` (`*_cents`), kein `numeric`, kein `float` | – |
| 37 | Live-Update im Session-Detail (SPEC 7) | `0004_realtime.sql`: Publication + `replica identity full` auf `entries` | – |

## So spielt der Planer die Migrationen per SQL-Editor ein

Voraussetzung: Zugang zu <https://supabase.com/dashboard/project/vcyqzqgybjggoreffwjc>.
Dauer ca. 5 Minuten. Nichts davon ist rückgängig zu machen – aber die Datenbank ist leer,
im Zweifel also einfach neu einspielen.

1. **Adressen vorbereiten.** Kopiere `supabase/seed.sql` in einen Editor und ersetze
   `ADMIN_EMAIL_1`, `ADMIN_EMAIL_2`, `ADMIN_EMAIL_3` durch die echten Gmail-Adressen. Nicht
   benötigte Zeilen löschen. Die bearbeitete Fassung **nicht** in Git speichern – entweder nur im
   Browser einfügen oder als `supabase/seed.local.sql` ablegen (steht in `.gitignore`).
   Groß-/Kleinschreibung ist egal, das `lower(...)` im Seed normalisiert.
2. **SQL-Editor öffnen**: linke Seitenleiste → *SQL Editor* → *New query*.
3. **`supabase/migrations/0001_schema.sql`** vollständig hineinkopieren → *Run*.
   Erwartet: `Success. No rows returned`.
4. **`0002_functions_triggers.sql`** in ein **neues** Query-Fenster → *Run*. Erwartet: dasselbe.
   Falls hier `permission denied for table users` erscheint: der Trigger auf `auth.users` braucht
   die Rolle `postgres`; im SQL-Editor des Dashboards ist das der Standard. Dann bitte melden.
5. **`0003_rls.sql`** → *Run*. Erwartet: dasselbe.
6. **`0004_realtime.sql`** → *Run*. Erwartet: `Success`, ggf. mit der Notice
   „Publication supabase_realtime does not exist“ – die darf **nicht** kommen; kommt sie doch,
   ist Realtime im Projekt nie aktiviert worden (Dashboard → *Database* → *Replication*).
7. **Seed** (die in Schritt 1 bearbeitete Fassung) → *Run*.
8. **Sichtprüfung** im selben Editor:
   ```sql
   -- 11 Tabellen, alle mit rowsecurity = true
   select relname, relrowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by relname;
   select count(*) from pg_policies where schemaname = 'public';   -- erwartet 28
   select email, role from public.role_whitelist order by email;    -- die echten Adressen
   select key, value from public.settings;                          -- quick_amounts_cents
   ```
9. **Google-Provider aktivieren** (falls noch offen): *Authentication* → *Providers* → Google,
   Redirect-URI `https://vcyqzqgybjggoreffwjc.supabase.co/auth/v1/callback`.
10. **Gegenprobe von außen**: im Projektordner `npm run rls:smoke`. Erwartet: jede Zeile `OK`,
    Schlusszeile „Ohne Login ist nichts lesbar und nichts schreibbar.“, Exit-Code 0.
    Erscheint stattdessen `FEHLT` in jeder Zeile, ist mindestens eine Migration nicht gelaufen.
11. **Ersten Admin prüfen**: nach dem ersten Login (WP2)
    `select email, role from public.app_users;` – dort muss `admin` stehen. Falls jemand sich
    eingeloggt hat, **bevor** seine Adresse in der Whitelist stand, hilft das `update` am Ende
    von `seed.sql`.

Alternative mit CLI (sobald verlinkt): `npx supabase login`,
`npx supabase link --project-ref vcyqzqgybjggoreffwjc`, dann `npx supabase db push`.
Der Seed läuft dabei **nicht** automatisch mit (`db push` spielt nur `migrations/` ein) – Schritt 7
bleibt also nötig, oder `npx supabase db push --include-seed`.

## Abweichungen vom Plan

1. **`created_at`/`added_at`/`updated_at`/`at` sind `not null`.** Der Plan schreibt nur
   `timestamptz default now()`. Ein nullbarer Zeitstempel würde die chronologische Sortierung
   von Verlauf und Audit-Log unterlaufen. Fachlich ändert sich nichts.
2. **Zusätzlicher Check in `validate_entry` (Zeile „c2“).** Der Plan verlangt die Prüfung
   `Σ payout ≤ Σ cash buy_in` nur beim Einfügen eines `payout`. Sie wird hier bei **jeder**
   Operation auf `entries` gerechnet. Sonst könnte man einen Bar-Buy-in nachträglich löschen oder
   auf „Liste“ umstellen und die Kasse damit rückwirkend ins Minus ziehen – die Vorbedingung aus
   `docs/SETTLEMENT.md` („Σ payout ≤ Σ cashIn“) wäre verletzt und `computeSettlement` würde werfen.
   Fehlercode bleibt `PAYOUT_EXCEEDS_CASHBOX`.
3. **`validate_entry` lässt Löschen zu, wenn die Session-Zeile schon weg ist.** Beim
   `delete from sessions` (Admin, offene Session ohne Abrechnung) kaskadiert Postgres nach
   `session_players` → `entries`; zu diesem Zeitpunkt ist die Session nicht mehr sichtbar. Ohne
   diese Ausnahme wäre `deleteOpenSession` aus WP4 nicht ausführbar. Gleiches in
   `validate_session_player_delete`.
4. **`protect_app_user_columns` greift nicht, wenn `auth.uid()` null ist.** Das ist genau der Fall
   „SQL-Editor / Trigger“, nie eine PostgREST-Anfrage der Rolle `authenticated` (dort steckt immer
   ein JWT mit `sub`). Damit kann der Planer den ersten Admin von Hand setzen, ohne dass die
   Rechteprüfung für die App gelockert wird.
5. **`handle_new_auth_user` benutzt `on conflict (id) do nothing`** statt eines Upserts. Ein Upsert
   würde bei jedem Login `email`/`display_name` überschreiben und mit Punkt 4 kollidieren.
   Konsequenz: ändert jemand seinen Google-Namen, bleibt der alte Anzeigename stehen – bewusst,
   siehe „Offene Fragen“.
6. **`session_players` hat keine Update-Policy.** Der Plan lässt die Spalte in der Matrix leer
   („–“). Das ist so umgesetzt: Position ändern ist in v1 kein Anwendungsfall.
7. **Zusätzlicher Immutabilitäts-Check auf `sessions`** (`id`, `created_at`, `created_by`,
   Fehlercode `IMMUTABLE_FIELD`), weil die Update-Policy für Editoren sonst auch diese Spalten
   freigäbe.
8. **RPCs werden vor dem Anlegen gedroppt** (`drop function if exists`). `create or replace` kann
   die Signatur einer `returns table`-Funktion nicht ändern; ohne den Drop scheitert ein zweites
   `db push` nach einer Signaturänderung. Die Grants stehen deshalb am Dateiende.
9. **`create extension pgcrypto` weggelassen.** `gen_random_uuid()` gehört seit Postgres 13 zum
   Kern; die Extension-Zeile wäre nur ein zusätzlicher Fehlerpfad.
10. **`settlement_input` liefert zusätzlich `player_name`** – so im Plan vorgesehen; erwähnt, weil
    die Funktion damit `security invoker` bleiben muss (sie liest `players`, RLS des Aufrufers).
11. **`role_whitelist` bekommt keinen Audit-Trigger.** Der Plan zählt die sieben Tabellen
    ausdrücklich auf und `role_whitelist` ist nicht dabei. Siehe „Vorschläge“.

## Offene Fragen an den Planer

1. **Anzeigename bleibt beim ersten Login stehen** (Abweichung 5). Soll ein späterer Login den
   Google-Namen/Avatar aktualisieren? Dann bräuchte `handle_new_auth_user` einen Upsert, und
   `protect_app_user_columns` müsste diesen Pfad ausnehmen. Konservativ ist die jetzige Fassung.
2. **`app_users.role` vs. `role_whitelist`**: Ändert ein Admin die Whitelist, wirkt das nur auf
   Konten, die sich noch **nie** eingeloggt haben. Für alle anderen ändert man die Rolle direkt
   (WP8). SPEC 3 sagt es so, ich habe es nur nirgends explizit gefunden – bitte bestätigen.
3. **Google-Konto löschen** ist aktuell nicht möglich, sobald der Nutzer irgendetwas angelegt hat:
   `players.created_by`, `sessions.created_by`, `entries.created_by` usw. zeigen ohne
   `on delete`-Regel auf `app_users` und blocken die Kaskade aus `auth.users`. Für ein
   lückenloses Audit-Log ist das eher Feature als Bug – aber es ist eine bewusste Entscheidung,
   die in SPEC 4 nicht steht.
4. **`close_note` beim Wiederöffnen**: Der Grund wird laut Plan an den bestehenden `close_note`
   angehängt. Nach mehrfachem Öffnen/Schließen wird das Feld lang und der Abschluss-Kommentar
   der aktuellen Runde überschreibt es beim nächsten `close_session` komplett. Der alte Stand
   bleibt im Audit-Log. Reicht das, oder soll es eine eigene `session_events`-Tabelle geben?
5. **Admin-Adressen** fehlen weiterhin (SPEC 9). `seed.sql` enthält nur Platzhalter.

## Neue Abhängigkeiten

- **`tsx@^4`** (devDependency) – führt `scripts/rls-smoke.ts` ohne Build-Schritt aus
  (`npm run rls:smoke`). Keine Laufzeit-Abhängigkeit, landet nicht im Bundle.
  Keine weiteren Pakete; `supabase` (CLI) wird bewusst **nicht** installiert, `types:gen` ruft es
  über `npx` bzw. eine globale Installation auf.

## Prüfung

- `npm run check`: **grün** (2026-09-08, 17:12) – typecheck ok, ESLint ohne Ausgabe,
  67 Tests in 4 Dateien (unverändert zum WP0-Stand, WP1 bringt keine neuen Tests mit:
  das Paket besteht aus SQL, das ohne eingespielte Datenbank nicht ausführbar ist).
- `npm run build`: **grün** – `/` und `/_not-found` statisch, `Proxy (Middleware)` aktiv.
  Einzige Ausgabe bleibt die bekannte `middleware`-Deprecation-Warnung aus WP0 (Umbau in WP2).
- `npm run rls:smoke`: **einmal ausgeführt**, ausschließlich um das Fehlverhalten bei nicht
  eingespielter Datenbank zu prüfen. Ergebnis wie beabsichtigt: 27 Prüfungen, alle `FEHLT`,
  danach die Klartextmeldung „Tabellen/Funktionen existieren nicht → die Migrationen sind noch
  nicht eingespielt“ und Exit-Code 1. Kein Stacktrace, kein Absturz. Die Verbindung zum
  Cloud-Projekt stand dabei (die Fehler kommen von PostgREST, nicht vom Netzwerk).
  **Das eigentliche RLS-Urteil ist damit `nicht verifiziert`** – es braucht eine eingespielte
  Datenbank.
- **Nicht verifiziert: die SQL-Syntax selbst.** Auf dieser Maschine gibt es weder `psql` noch
  Docker noch eine lokale Postgres-Installation, und in das Cloud-Projekt sollte nichts
  geschrieben werden. Die vier Dateien sind zeilenweise gegen die Postgres-Doku geprüft
  (u. a.: `NEW`/`OLD` werden nirgends außerhalb ihrer Operation angefasst – ein `case`-Ausdruck
  im `declare`-Block hätte bei `DELETE` „record new is not assigned yet“ geworfen; die
  camelCase-Schlüssel in `jsonb_to_recordset` sind gequotet, sonst würden sie nicht matchen),
  aber niemand hat sie laufen sehen. Der erste Lauf im SQL-Editor ist der eigentliche Test.

## So prüft man es

1. `npm run check` und `npm run build` → beide grün.
2. `npm run rls:smoke` **ohne** eingespielte Datenbank → 27 × `FEHLT`, verständliche Meldung,
   Exit-Code 1 (`npm run rls:smoke; echo $LASTEXITCODE`).
3. SQL-Review gegen den Implementation Plan, Datei für Datei. Die Tabelle
   „SPEC-Regel → Trigger/Policy/Check“ oben ist als Checkliste gedacht: jede Zeile hat eine
   Fundstelle in `supabase/migrations/`.
4. Gezielt gegenlesen (das sind die Stellen, an denen Geld verloren gehen kann):
   - `0002` → `close_session`: die Zeilen ab `-- per player: recompute and compare`. Jede
     Spalte einer `settlement_lines`-Zeile wird gegen die Aggregation aus `entries` geprüft,
     nicht nur die Summen. Ein manipuliertes `cashFromBox` fällt über
     `cashFromBox = tier1+tier2+tier3` **und** `cashFromBox ≤ claim` auf.
   - `0002` → `validate_entry` (c2): der Kassen-Check läuft bei Insert, Update **und** Delete.
   - `0003` → `sessions_delete`: `is_admin() and status = 'open' and not exists(settlements)`.
   - `0003` → `audit_log`: nur `select`, kein Grant für irgendetwas anderes.
5. Seed prüfen: `grep -i "@" supabase/seed.sql` darf keine echte Adresse zeigen; enthalten sind
   nur `ADMIN_EMAIL_*`, `EDITOR_EMAIL_1` und `example.invalid` im Kommentar.
6. `git check-ignore -v supabase/seed.local.sql` → Treffer in `.gitignore`.
7. Nach dem Einspielen (Planer): Schritt 8 und 10 der Anleitung oben, dann `npm run rls:smoke`
   erneut – dann darf keine Zeile `LECK` sagen.

## Vorschläge (außerhalb des Pakets)

- **Audit-Trigger auf `role_whitelist`.** Die Tabelle vergibt Rollen und steht damit
  sicherheitstechnisch auf einer Stufe mit `app_users.role`, ist im Plan aber nicht in der
  Audit-Liste. Ein Zweizeiler, gehört fachlich in WP8.
- **`session_players.position` automatisch vergeben** (Trigger `before insert`:
  `coalesce(new.position, max(position)+1)`). Aktuell muss WP5 die Position selbst berechnen,
  was bei zwei gleichzeitigen „Spieler hinzufügen“ in einen Unique-Konflikt laufen kann.
- **View `session_overview`** (WP4 Schritt 3 nennt sie schon) und `player_stats` (WP7) als
  `security_invoker = true`-Views – dann bleibt `listSessions` eine einzige Query.
- **Fehlercode-Katalog**: Die 21 Codes dieses Pakets gehören in WP5 vollständig nach
  `src/lib/errors/de.ts`. Liste: `SESSION_CLOSED`, `SESSION_NOT_FOUND`, `SESSION_NOT_CLOSED`,
  `PLAYER_ALREADY_CASHED_OUT`, `PAYOUT_REQUIRES_CASH_OUT`, `PAYOUT_EXCEEDS_STACK`,
  `PAYOUT_EXCEEDS_CASHBOX`, `STACK_BELOW_PAYOUT`, `CASH_OUT_HAS_PAYOUT`, `PLAYER_HAS_ENTRIES`,
  `USE_RPC`, `IMMUTABLE_FIELD`, `LAST_ADMIN`, `ONLY_ROLE_EDITABLE`, `FORBIDDEN`,
  `NO_PARTICIPANTS`, `MISSING_CASH_OUT`, `DISCREPANCY_REQUIRES_ADMIN_NOTE`,
  `SETTLEMENT_MISMATCH`, `SETTLEMENT_INVARIANT`, `REASON_REQUIRED`.
- **`src/lib/env.ts`** (aus WP0 verschoben nach WP2): `scripts/rls-smoke.ts` parst `.env.local`
  aktuell selbst, weil es keinen gemeinsamen Env-Zugriff gibt.
- Sobald die CLI verlinkt ist: `npm run types:gen` laufen lassen und das Ergebnis mit
  `src/lib/database.types.ts` vergleichen. Abweichungen sind entweder Tippfehler von mir oder
  echte Schema-Überraschungen – beides will man wissen. Achtung: `types:gen` überschreibt die
  Datei inklusive `TABLE_NAMES`; die Konstante müsste dann in eine eigene Datei wandern.
