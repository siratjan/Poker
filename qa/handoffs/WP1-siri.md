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
- **`scripts/rls-smoke.ts`** – prüft ohne Login jede Tabelle (select + insert) und alle sieben
  aufrufbaren Funktionen (Runde 2, F7). „Geblockt“ ist ein Fehler (permission denied / RLS);
  „Leck“ ist jede zurückgelieferte Zeile und jeder erfolgreiche Schreibzugriff. Ein leeres
  Ergebnis **ohne** Fehler ist seit Runde 2 ein eigenes Urteil `UNKLAR` (vermutlich geblockt,
  aber nicht beweiskräftig – eine ungeschützte Tabelle in einer leeren Datenbank antwortet
  genauso). Ausnahme `settings`: dort legt `0001` `quick_amounts_cents` an, die Tabelle ist also
  nie leer, und 0 Zeilen sind dort ein echter Beweis.
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
| 24 | Differenz wird serverseitig nachgerechnet, nicht geglaubt (WP1) | `close_session` aggregiert `entries` neu und vergleicht die fünf Kopfzahlen sowie je Zeile alle **aus der Aggregation ableitbaren** Werte (`cashIn`, `creditIn`, `stack`, `payout`, `isCashPlayer`, `claim`, `netResult`, `residual`, `cashFromBox = t1+t2+t3`, `cashFromBox ≤ claim`). Die Aufteilung auf die Stufen 1/2/3 wird **nicht** in SQL nachgerechnet; sie ist über die Invarianten in Zeile 25–26 und 41–43 abgesichert | `SETTLEMENT_MISMATCH` |
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
| 38 | Teilnehmer **hinzufügen** nur in offener Session (SPEC 5.6) | Policy `session_players_insert` mit `public.session_is_open(session_id)` (`0003`) | RLS (42501) |
| 39 | Ein Konto, das etwas angelegt hat, ist nicht löschbar (SPEC 3) | die `created_by`/`added_by`/`computed_by`/`updated_by`-FKs auf `app_users` haben **bewusst keine** `on delete`-Regel und blocken damit die Kaskade aus `auth.users` | 23503 |
| 40 | „Bar-Zahler“ = mindestens ein `cash`-Buy-in (SPEC 6, SETTLEMENT „Ausgabe“) | `close_session`: `l."isCashPlayer" is distinct from (agg.cash_in > 0)` | `SETTLEMENT_MISMATCH` |
| 41 | „Bargeld zuerst an Bar-Zahler“ (SETTLEMENT Inv. 6) | `close_session`: sobald `Σ cashTier3 > 0` ist, muss jeder Bar-Zahler `cashFromBox = claim` haben (Runde 2, F2) | `SETTLEMENT_INVARIANT` |
| 42 | Überweisungen laufen vom Schuldner (`residual < 0`) zum Gläubiger (`residual > 0`), Summe = `min(Σ pos. Residual, Σ neg. Residual)` (SETTLEMENT Schritt 5, Inv. 9) | `close_session` (Runde 2, F2) | `SETTLEMENT_INVARIANT` |
| 43 | Die Differenz zeigt sich in `unallocatedCash`/`uncoveredClaims`/`uncoveredDebts` (SETTLEMENT Schritt 5) | `close_session` prüft die drei Gleichungen je nach Vorzeichen der Differenz (Runde 2, F1) | `SETTLEMENT_INVARIANT` |
| 44 | Erfassender Nutzer kommt aus dem Token, nicht vom Client (SPEC 4) | `default auth.uid()` (`0001`) + Trigger `stamp_actor` bei `insert` (Runde 2, F4) | – |
| 45 | Ein Eintrag wechselt nie Session, Spieler oder Typ (WP1 Runde 2) | `validate_entry` Regel (f) | `ENTRY_IMMUTABLE_KEYS` |
| 46 | Eine neue Session trägt keine Abschlussdaten (SPEC 5) | Policy `sessions_insert` verlangt zusätzlich `closed_at/closed_by/discrepancy_cents/close_note/reopened_at/reopened_by is null` (Runde 2, F6) | RLS (42501) |

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
5. Seed prüfen: `grep -i "@" supabase/seed.sql` **liefert keine Treffer** – die Datei enthält
   überhaupt kein `@`; die Platzhalter heißen `ADMIN_EMAIL_1/2/3` und `EDITOR_EMAIL_1`, ganz ohne
   Klammeraffe. Eine leere Ausgabe ist hier also das erwartete Ergebnis und kein Fehler.
   (`example.invalid` steht in `scripts/rls-smoke.ts`, nicht im Seed.)
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
- **Fehlercode-Katalog**: Die 22 Codes dieses Pakets gehören in WP5 vollständig nach
  `src/lib/errors/de.ts`. Liste: `SESSION_CLOSED`, `SESSION_NOT_FOUND`, `SESSION_NOT_CLOSED`,
  `ENTRY_IMMUTABLE_KEYS`, `PLAYER_ALREADY_CASHED_OUT`, `PAYOUT_REQUIRES_CASH_OUT`,
  `PAYOUT_EXCEEDS_STACK`,
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

## Runde 2 – Nacharbeit zu `qa/reports/WP1-gaby.md`

Alle zehn Findings umgesetzt, nach den Planer-Entscheidungen vom 2026-09-08. Die Datenbank ist
weiterhin **nicht eingespielt**, deshalb wurde – wie vom Planer entschieden – direkt in `0001` und
`0002` geändert statt eine Migration `0005` nachzuschieben. Wer die Migrationen schon einmal
eingespielt hätte, müsste die Datenbank einmal neu aufsetzen.

| Finding | Was geändert |
|---|---|
| **F1** (Major) | `0001`: Spalte `uncovered_debts_cents integer not null` in `settlements`. `0002` → `close_session`: `uncoveredDebts` wird aus `p_settlement` gelesen, muss vorhanden und `>= 0` sein (sonst `SETTLEMENT_MISMATCH`), wird gegen die Gleichungen aus `docs/SETTLEMENT.md` Schritt 5 geprüft und gespeichert. `src/lib/database.types.ts`: Spalte in `Row`/`Insert`/`Update` nachgezogen. Der Round-Trip `SettlementResult → RPC-JSON → DB` ist damit verlustfrei. |
| **F2** | `close_session` prüft zusätzlich: (a) jede Transfer-Zeile geht von `residual < 0` an `residual > 0` und beide sind Zeilen dieser Abrechnung; (b) `Σ transfers = min(Σ positives Residual, Σ negatives Residual)` sowie `Σ transfers + uncoveredDebts = Σ negatives Residual`; (c) „Bar zuerst“ – sobald irgendein `cashTier3 > 0` ist, muss für jeden `isCashPlayer` gelten `cashFromBox = claim`. (d) `cashFromBox ≤ claim` und die `residual`-Formel waren bereits vorhanden (gegen die **serverseitige** Aggregation, also strenger als gegen die Client-Zeile) und blieben unverändert. Alle neuen Verstöße werfen `SETTLEMENT_INVARIANT` mit sprechendem `detail`; die schon vorhandenen Invarianten haben jetzt ebenfalls ein `detail`. |
| **F3** | `validate_entry`, neue Regel (f): bei `UPDATE` dürfen `session_id`, `player_id` und `type` nicht wechseln → **neuer Fehlercode `ENTRY_IMMUTABLE_KEYS`**. Die Prüfung steht hinter der Session-Prüfung, damit `SESSION_CLOSED` Vorrang behält. Damit ist der Weg zu, einen Bar-Buy-in in eine andere Session umzuhängen (die Kassenprüfung sah nur die Zielseite) oder einen `cash_out` auf einen anderen Spieler zu schieben. |
| **F4** | `0001`: `default auth.uid()` auf `players.created_by`, `sessions.created_by`, `session_players.added_by`, `entries.created_by`, `settlements.computed_by`, `settings.updated_by`. `0002`: neue Trigger-Funktion `stamp_actor()` (kein `security definer`, sie braucht keine erhöhten Rechte) plus fünf `before insert`-Trigger `stamp_players`, `stamp_sessions`, `stamp_session_players`, `stamp_entries` und `stamp_settings` (dieser auch `before update`, weil `updated_by` „wer zuletzt geändert hat“ bedeutet). Ein vom Client mitgeschickter Wert wird überschrieben; bei `UPDATE` bleibt `created_by` unangetastet. Wie bei `protect_app_user_columns` steigt die Funktion aus, wenn `auth.uid()` null ist – das ist ausschließlich der SQL-Editor-/Seed-Pfad, den der Planer zum Bootstrappen braucht. |
| **F5** | `reopen_session` setzt zusätzlich `closed_at = null`, `closed_by = null`, `discrepancy_cents = null`. `close_note` bleibt erhalten und bekommt den Grund angehängt; die alten Werte stehen vollständig in `audit_log.old_data` (SPEC 4). Damit kann WP6/WP7 `sessions.discrepancy_cents` lesen, ohne vorher auf den Status zu schauen. |
| **F6** | Policy `sessions_insert` verlangt jetzt zusätzlich `closed_at`, `closed_by`, `discrepancy_cents`, `close_note`, `reopened_at`, `reopened_by` = `null`. Eine „geborene“ Session mit erfundener Differenz ist damit nicht mehr anlegbar. |
| **F7** | `scripts/rls-smoke.ts`: neues Urteil `UNKLAR` für „0 Zeilen ohne Fehler“ – das wird nicht mehr als `OK` verbucht, sondern am Ende ausdrücklich als „vermutlich geblockt, nicht beweiskräftig (die Datenbank kann leer sein)“ benannt. `settings` ist als beweiskräftiger Fall markiert (`0001` legt dort `quick_amounts_cents` an, die Tabelle ist also nie leer – 0 Zeilen bedeuten dort wirklich „weggefiltert“). Die zwei fehlenden Funktionen `current_app_role` und `session_is_open` sind ergänzt (jetzt 29 statt 27 Prüfungen). Die Schlusszeile unterscheidet „OK“ von „OK mit Einschränkung“. Der Exit-Code bleibt 0, solange es kein Leck und nichts Fehlendes gibt. |
| **F8** | Die Mapping-Tabelle oben hat die drei fehlenden Regeln bekommen (Zeilen 38 Teilnehmer-Hinzufügen, 39 Konto nicht löschbar, 40 Definition „Bar-Zahler“) plus die in Runde 2 dazugekommenen Regeln 41–46. Zeile 24 ist umformuliert: nachgerechnet werden die *aus der Aggregation ableitbaren* Werte, nicht die Stufenverteilung. |
| **F9** | `revoke all on function … from public, anon, authenticated` für alle neun reinen Trigger-Funktionen am Dateiende von `0002`. Die Trigger selbst laufen weiter: das Ausführungsrecht wird bei `create trigger` geprüft, nicht beim Feuern. |
| **F10** | „So prüft man es“, Punkt 5 korrigiert: `grep -i "@" supabase/seed.sql` liefert **keine** Treffer, weil die Datei gar kein `@` enthält. Die leere Ausgabe ist das erwartete Ergebnis. |

### Abweichung: Gabys Test musste an drei Stellen nachgezogen werden

`tests/gaby/wp1-schema.gaby.test.ts` friert unter anderem drei Zahlen ein, die durch F3 und F4
zwangsläufig stale werden. Ich habe **nur diese drei Literale** geändert, keine einzige Zusicherung
abgeschwächt oder entfernt:

| Stelle | vorher | nachher | Grund |
|---|---|---|---|
| `expect(created).toBe(…)` (Trigger) | 15 | 20 | F4 bringt fünf `stamp_*`-Trigger mit |
| `expect(functionHeaders.length).toBe(…)` | 15 | 16 | F4 bringt `stamp_actor()` mit |
| `KNOWN_ERROR_CODES` | 21 Codes | 22 Codes (`ENTRY_IMMUTABLE_KEYS` ergänzt) | F3, Fehlercode vom Planer so vorgegeben |

Der Test ist genau dafür gebaut – sein eigener Kopfkommentar sagt, ein neuer Fehlercode solle
fehlschlagen „und daran erinnern, dass WP5 eine deutsche Meldung braucht“. Diese Erinnerung ist
oben unter „Vorschläge“ eingelöst: die Liste für `src/lib/errors/de.ts` hat jetzt 22 Einträge.
Zwei weitere Fehlschläge (die beiden Invarianten-Regexe in `close_session`) habe ich **nicht** im
Test, sondern in meinem SQL geheilt: die zwei bestehenden Vergleiche stehen weiter wortgleich in
der von Gaby eingefrorenen Form da, die neuen Prüfungen kommen daneben. **Bitte Gaby diese drei
Zeilen gegenlesen lassen.**

### Prüfung Runde 2

- `npm run check`: **grün** – typecheck ok, ESLint ohne Ausgabe, 217 Tests in 9 Dateien
  (darunter Gabys 56 WP1-Tests, alle grün; die übrigen kommen aus WP0 und der parallel laufenden
  WP3-Runde-2).
- `npm run build`: **grün** – `/` und `/_not-found` statisch, `Proxy (Middleware)` aktiv;
  weiterhin nur die bekannte `middleware`-Deprecation aus WP0.
- `npm run rls:smoke`: unverändertes Verhalten gegen die **nicht** eingespielte Datenbank –
  jetzt 29 statt 27 Prüfungen, alle `FEHLT`, dieselbe Klartextmeldung, Exit-Code 1, kein
  Stacktrace. Der neue `UNKLAR`-Pfad ist damit **nicht** live durchlaufen (er greift erst gegen
  eine eingespielte Datenbank).
- **Weiterhin nicht verifiziert: die SQL-Syntax.** Es gibt auf dieser Maschine nach wie vor weder
  `psql` noch Docker; kein einziges Statement ist gelaufen. Neu hinzugekommen und deshalb beim
  ersten Einspielen besonders zu beachten:
  `default auth.uid()` auf sechs Spalten (Default-Ausdrücke dürfen Funktionen aufrufen, `auth.uid()`
  ist `stable` – zulässig), die Zeilenvergleiche `(new.session_id, new.player_id, new.type) is
  distinct from (…)`, `least(…)` über zwei `bigint`, die beiden `left join
  jsonb_to_recordset(…)` auf dieselbe `lines`-Liste in der Transfer-Richtungsprüfung, sowie
  `raise exception … using errcode = …, detail = …` mit zusammengesetztem Text.

### Was der Planer nach dem Einspielen zusätzlich prüfen sollte

1. `select column_name from information_schema.columns where table_name = 'settlements';` –
   `uncovered_debts_cents` muss dabei sein.
2. Einen Spieler anlegen und `select created_by from public.players;` – dort muss die eigene
   Nutzer-ID stehen, auch wenn der Client etwas anderes schickt (F4).
3. Eine Session schließen und wieder öffnen: danach `closed_at`, `closed_by`,
   `discrepancy_cents` = `null`, `close_note` mit angehängtem Grund, und im `audit_log` die
   alten Werte in `old_data` (F5).
4. `npm run rls:smoke` – erst wenn Daten in der Datenbank liegen (nach WP2/WP4), ist das
   Ergebnis vollständig beweiskräftig; bis dahin auf die `UNKLAR`-Zeilen achten (F7).

### Offene Punkte aus Gabys F2, die bewusst offen bleiben

Der Planer hat für F2 vier Prüfungen (a)–(d) entschieden; die restlichen Vorschläge aus Gabys
Bericht sind **nicht** umgesetzt und damit weiterhin nur durch `computeSettlement` gedeckt:
`cashTier3 = 0` für Bar-Zahler und `cashTier1 = cashTier2 = 0` für Listen-Spieler, sowie die
volle Bedienung der Stufe 1, wenn die Kasse reicht (Invariante 5). Ein manipulierter Client
könnte einem Bar-Zahler seinen Anspruch über `cashTier3` statt über `cashTier1/2` zuteilen –
die Summen und alle jetzt geprüften Invarianten blieben dabei heil. Gehört nach WP6, wenn es
gewollt ist.
