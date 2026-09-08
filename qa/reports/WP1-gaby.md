# WP1 – Prüfbericht Gaby

**Urteil: NACHARBEIT** (1 Major, 9 Minor, 0 Blocker)

Geprüfter Stand: `bc7aa02` „WP1: database schema, RLS, triggers“ (Arbeitsbaum auf `main`,
HEAD zum Prüfzeitpunkt `8202d89`; die WP3-Commits dazwischen betreffen `src/lib/settlement/**`
und `docs/SETTLEMENT.md`).

Das Paket ist handwerklich sehr gut: alle elf Tabellen, 28 Policies, 15 Trigger und drei RPCs
sind vollständig, sauber kommentiert und in sich konsistent; alle vierzehn Funktionen setzen
`search_path`, `anon` bekommt auf keiner Tabelle irgendein Recht, `audit_log` ist nur lesbar,
`close_session` rechnet Summen **und** jede Zeile serverseitig nach und sperrt die Session-Zeile
gegen Doppelabschluss. Die vierzehn durchgespielten Angriffsszenarien werden bis auf eines
vollständig geblockt.

Zur Nacharbeit führt genau ein Punkt: `docs/SETTLEMENT.md` hat nach Siris Commit das Ausgabefeld
`uncoveredDebts` bekommen (Commit `83d157a`), und dafür gibt es in `settlements` keine Spalte.
Die eingefrorene Abrechnung wäre damit unvollständig. Das ist **kein Fehler Siris**, aber es
gehört jetzt behoben, solange die Datenbank noch nicht eingespielt ist – später kostet es eine
zusätzliche Migration auf einer Tabelle, die per Definition nie geändert werden darf.

> **Wichtig für die Einordnung des Urteils:** Es wurde **kein einziger SQL-Befehl ausgeführt.**
> Es gibt auf dieser Maschine weder `psql` noch Docker, und die Datenbank ist nicht eingespielt.
> Alles unten ist ein Review plus statische Checks. Der komplette Abschnitt
> „Nicht verifiziert“ am Ende gilt ausdrücklich **nicht** als bestanden.

---

## Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `npm run check` (vor eigenen Tests) | **grün** – typecheck ok, ESLint ohne Ausgabe, 67 Tests in 4 Dateien, 163 ms |
| `npm run build` | **grün** – `/` und `/_not-found` statisch, `Proxy (Middleware)` aktiv; einzige Ausgabe die bekannte `middleware`-Deprecation aus WP0 (Umbau in WP2) |
| `npm run rls:smoke` | **wie erwartet rot**: 27 Prüfungen, alle `FEHLT`, Klartextmeldung „Tabellen/Funktionen existieren nicht → die Migrationen sind noch nicht eingespielt“ inkl. Verweis auf die Anleitung, **Exit-Code 1**, kein Stacktrace. Verhalten bei nicht eingespielter DB ist damit bestätigt. |
| `npm run check` (nach eigenen Tests) | **grün** – 123 Tests in 5 Dateien, 174 ms |
| `grep -i "@" supabase/seed.sql` | keine Treffer (die Datei enthält gar kein `@`) |
| `git log -p -- supabase \| grep -i @gmail` | nur die Git-Autorzeile des Commits, **kein Dateiinhalt**; präziser: `git log -p -- supabase \| grep -E "^[+-]" \| grep -iE "@[a-z0-9.-]+\.[a-z]{2,}"` → **leer** |
| `git check-ignore -v supabase/seed.local.sql` | Treffer `.gitignore:48` |
| `git ls-files \| grep -i env` | nur `.env.example` |

**Eigene Tests: `tests/gaby/wp1-schema.gaby.test.ts` – 56 Tests, alle grün.**

Die Datenbank lässt sich nicht ausführen, also friert die Datei die sicherheitsrelevanten
Eigenschaften der Migrationsdateien statisch ein, damit spätere Pakete (0005 in WP2, Views in
WP4/WP7) sie nicht unbemerkt aufweichen. Geprüft wird unter anderem:

- RLS ist auf allen elf Tabellen an; alle 28 Policies gelten nur `to authenticated`, keine für
  `anon`/`public`; jede Schreib-Policy enthält `is_editor()`/`is_admin()`;
- `entries`/`session_players` schreiben nur mit `session_is_open()` (5 Policies);
- `audit_log` hat genau eine Policy (`select`), keinen Insert-Grant und keine Sequenz-Rechte;
- `settlements`/`_lines`/`_transfers` haben nur Lese-Policies;
- alle 15 Funktionen setzen `search_path`; keine `security definer`-Funktion ohne;
- `revoke … from public, anon` + `grant execute … to authenticated` für alle sieben aufrufbaren
  Funktionen;
- Idempotenz: jede Tabelle/jeder Index mit `if not exists`, 15 Trigger mit `drop … if exists` und
  `execute function`, jede Policy mit vorherigem `drop policy if exists`, jedes `create type` im
  `do`-Block mit `duplicate_object`, ausbalancierte `$$`-Quotes;
- Geld: jede `*_cents`-Spalte ist `integer`, kein `numeric`/`decimal`/`real`/`money` im Schema;
- **die 21 Fehlercodes sind eingefroren** – taucht in einer späteren Migration ein neuer auf,
  schlägt der Test fehl und erinnert daran, dass WP5 (`src/lib/errors/de.ts`) eine deutsche
  Meldung braucht;
- `validate_entry` fasst `new.`/`old.` nirgends im `declare`-Block an (der Postgres-Fallstrick
  „record new is not assigned yet“);
- `close_session` enthält Rollen-, Status- und Vollständigkeitsprüfung, `for update`,
  serverseitige Aggregation aus `entries`, den Zeilenvergleich, beide Invarianten und die
  Differenz-Regel – und kein `commit`/`rollback` (eine Funktion = eine Transaktion);
- `database.types.ts` deckt genau die elf Tabellen, die vier Enums und die drei RPC-Signaturen ab;
- `seed.sql` enthält keine E-Mail-Adresse (Regex auf `…@….tld`).

---

## DoD-Abgleich

| DoD-Punkt | Status | Anmerkung |
|---|---|---|
| Alle vier Migrationen laufen fehlerfrei in leerer Datenbank durch (0001–0004) | **nicht verifiziert** | Kein Server verfügbar. Zeilenweises Review hat keinen Syntaxfehler gefunden (Details unten), aber niemand hat sie laufen sehen. |
| Idempotent genug für ein zweites `db push` | **erfüllt** (statisch) | `create … if not exists`, `drop policy/trigger/function if exists`, `do`-Block mit `duplicate_object`, Realtime nur bei Bedarf. Durch eigene Tests abgesichert. Einschränkung: `create table if not exists` überspringt eine bereits existierende Tabelle stillschweigend – eine nachträglich hinzugefügte Spalte bräuchte eine eigene Migration (normal für diesen Stil, kein Finding). |
| `npm run rls:smoke` grün gegen das Cloud-Projekt | **offen** (laut DoD zulässig) | DB nicht eingespielt; Script meldet das korrekt und bricht mit Exit 1 ab. |
| `database.types.ts` vorhanden, `npm run check` grün | **erfüllt** | Typen decken alle Tabellen/Enums/Funktionen ab und stimmen mit dem SQL überein (inkl. Nullability der generierten Spalte `name_normalized`). |
| Übergabe dokumentiert (eingespielt ja/nein, Weg, Smoke-Ergebnis) | **erfüllt** | `qa/handoffs/WP1-siri.md` ist ausführlich und ehrlich; die Einspiel-Anleitung ist Schritt für Schritt nachvollziehbar. |
| Commit `WP1: …` auf `main` | **erfüllt** | `bc7aa02`. |
| Keine neuen Abhängigkeiten ohne Nennung | **erfüllt** | `tsx@^4` als devDependency genannt und begründet. |
| Keine Secrets im Repo | **erfüllt** | Siehe Tabelle oben. |

---

## Angriffsszenarien

| # | Szenario | Verhindert durch (Datei:Zeile) | Status |
|---|---|---|---|
| a | Editor ändert einen Entry in einer geschlossenen Session | `0003_rls.sql:168-177` (`entries_update`/`entries_delete` mit `public.session_is_open(session_id)` in `using` **und** `with check`) + `0002_functions_triggers.sql:330-342` (`SESSION_CLOSED`) | **verhindert** (doppelt) |
| b | Editor setzt `sessions.status` direkt per Update | `0002:440-451` – `validate_session_update` wirft `USE_RPC`, solange `app.session_transition` nicht `on` ist; gilt ebenso für `closed_at/by`, `discrepancy_cents`, `close_note`, `reopened_at/by` | **verhindert** |
| c | Viewer legt einen Spieler an | `0003:99-101` – `players_insert with check (public.is_editor())`; RLS-Verstoß 42501. Gleiches Muster für alle Schreib-Policies (`0003:41-51` Grants + `is_editor()`/`is_admin()`) | **verhindert** |
| d | `anon` liest `sessions` / `entries` / `audit_log` | `0003:29-33` `revoke all … from anon` auf allen elf Tabellen + keine einzige Policy `to anon` (`0003:12-22` RLS an) | **verhindert** (statisch; live nicht messbar, siehe „Nicht verifiziert“) |
| e | Irgendjemand schreibt oder löscht `audit_log` | `0003:51` nur `grant select`; `0003:54` `revoke all on sequence audit_log_id_seq`; `0003:218-220` einzige Policy ist `for select`; geschrieben wird nur vom `security definer`-Trigger `0002:206-259` | **verhindert** |
| f | Admin degradiert sich als letzter Admin | `0002:112-122` – `protect_last_admin` (`before update or delete`) wirft `LAST_ADMIN`, wenn danach kein Admin mehr existiert; greift auch beim Kaskadenlöschen aus `auth.users` | **verhindert** |
| g | Editor ruft `close_session` bei Differenz ≠ 0 auf | `0002:731-736` – `is_admin()` **und** `length(trim(note)) >= 3`, sonst `DISCREPANCY_REQUIRES_ADMIN_NOTE`; zusätzlich `0002:597-599` `is_editor()` als Grundvoraussetzung | **verhindert** |
| h | Client schickt manipuliertes `p_settlement` mit falschen Summen | `0002:628-654` (Summen neu aus `entries`), `0002:656-662` (genau eine Zeile je Teilnehmer, keine Duplikate), `0002:665-711` (jede Zeile gegen die Aggregation: `cashIn`, `creditIn`, `stack`, `payout`, `isCashPlayer`, `claim`, `netResult`, `residual`, `cashFromBox = t1+t2+t3`, `cashFromBox ≤ claim`), `0002:713-729` (beide Invarianten), `0002:786-795` (Transfer-Spieler müssen Teilnehmer sein) | **teilweise** – siehe **F2**: die Stufen-Verteilung und die Richtung der Transfers werden nicht geprüft |
| i | `buy_in` nach `cash_out` | `0002:363-370` – `PLAYER_ALREADY_CASHED_OUT`; zusätzlich Partial-Unique-Index `0001:149-150` für „genau ein cash_out“ | **verhindert** |
| j | `payout` größer als Stack oder größer als die Kasse | `0002:383-399` (`PAYOUT_REQUIRES_CASH_OUT`, `PAYOUT_EXCEEDS_STACK`) und `0002:402-416` (`PAYOUT_EXCEEDS_CASHBOX`, bei **jeder** Operation gerechnet, also auch beim Löschen/Umbuchen eines Bar-Buy-ins) | **verhindert** |
| k | Löschen eines `cash_out`, obwohl ein `payout` existiert | `0002:354-361` – `CASH_OUT_HAS_PAYOUT`; Gegenrichtung (`cash_out` kleiner als Σ payout) `0002:372-380` `STACK_BELOW_PAYOUT` | **verhindert** |
| l | `session_players` löschen mit vorhandenen Entries | `0002:499-502` – `PLAYER_HAS_ENTRIES`; zusätzlich `0002:495-497` nur bei offener Session, Policy `0003:150-153` | **verhindert** |
| m | Session löschen, die eine Abrechnung hat | `0003:128-134` – `sessions_delete using (is_admin() and status = 'open' and not exists(settlements))` | **verhindert** |
| n | Editor ändert seine eigene Rolle über ein `app_users`-Update | `0003:87-89` – `app_users_update` nur `is_admin()`; zweite Schranke `0002:155-165` (`FORBIDDEN`, `ONLY_ROLE_EDITABLE`); kein Insert-/Delete-Grant auf `app_users` (`0003:42`) | **verhindert** (doppelt) |

Zusätzlich selbst durchgespielt:

| Szenario | Verhindert durch | Status |
|---|---|---|
| Editor legt eine Session direkt als `closed` an (wäre danach unveränderlich) | `0003:120-122` `sessions_insert with check (… and status = 'open')` | verhindert |
| Zwei Abschlüsse gleichzeitig | `0002:601-602` `select … for update` auf der Session-Zeile + PK `settlements.session_id` (`0001:164`); der zweite Aufruf sieht `closed` → `SESSION_CLOSED` | verhindert |
| Editor ändert Name/Datum einer abgeschlossenen Session | `0002:454-457` `SESSION_CLOSED` | verhindert |
| Editor manipuliert `id`/`created_at`/`created_by` einer Session | `0002:459-463` `IMMUTABLE_FIELD` | verhindert |
| Viewer ruft `close_session`/`reopen_session` auf | `0002:597`/`0002:831` (`is_editor()`/`is_admin()` → `FORBIDDEN`) trotz `grant execute to authenticated` | verhindert |
| Nicht-Admin ändert Whitelist oder Schnellbeträge | `0003:60-74`, `0003:205-211` (alle `is_admin()`) | verhindert |
| `app.session_transition` von außen setzen | `set_config` liegt in `pg_catalog` und ist über PostgREST nicht aufrufbar; die Flagge wird nur in den beiden `security definer`-RPCs gesetzt (`0002:797`, `807`, `851`, `862`) und ist transaktionslokal (`is_local = true`) | statisch verhindert, siehe „Nicht verifiziert“ |

---

## SPEC-Regel → Trigger/Policy/Check: Abgleich mit Siris Tabelle

Siris 37-zeilige Tabelle wurde Zeile für Zeile gegen `docs/SPEC.md` §3–§5 (inkl. der vier neuen
Planer-Entscheidungen) geprüft. **Jede Zeile hat eine echte Fundstelle**, keine ist erfunden oder
falsch zugeordnet. Vier Anmerkungen (→ F8):

| Regel aus SPEC | In Siris Tabelle | Tatsächlich durchgesetzt durch |
|---|---|---|
| Teilnehmer **hinzufügen** nur in offener Session (SPEC §5.6) | fehlt (Zeile 19 nennt nur das Entfernen) | `0003:145-148` `session_players_insert … session_is_open()` – vorhanden, nur nicht dokumentiert |
| Konto, das etwas angelegt hat, ist nicht löschbar (SPEC §3, neu) | fehlt | `created_by`-FKs ohne `on delete`-Regel (`0001:78, 94, 115, 135, 167, 203, 222`) blocken die Kaskade aus `auth.users` – gewollt, gehört als Zeile in die Tabelle |
| „Bar-Zahler = mindestens ein `cash`-Buy-in“ (SPEC §6) | fehlt | `0002:700` `l."isCashPlayer" is distinct from (agg.cash_in > 0)` in `close_session` |
| Zeile 24: „vergleicht Summen **und jede einzelne Zeile**“ | zu stark formuliert | Stimmt für alle *abgeleiteten* Werte, **nicht** für die Aufteilung auf Stufe 1/2/3 und nicht für die Richtung der Transfers → F2 |

Nicht als Finding gewertet (Planer-Entscheidungen vom 2026-09-08): Whitelist wirkt nur beim ersten
Login (Zeile 2), Name/Avatar-Sync kommt in WP2 (dort fehlt in Siris Tabelle bewusst eine Zeile),
Konto-Löschung ist absichtlich blockiert, kein `session_events` in v1 (Zeile 30 deckt das ab).

---

## `close_session` im Detail (Testauftrag Punkt 4)

| Frage | Antwort | Fundstelle |
|---|---|---|
| Rechnet sie `total_buy_in`, `total_stack`, `discrepancy` selbst aus `entries` nach? | **Ja.** Eine Aggregation über `entries` der Session, `v_discrepancy := v_stack - v_buy_in`; jede der fünf Kopfzahlen wird gegen `p_settlement` verglichen, Abweichung → `SETTLEMENT_MISMATCH`. Gespeichert werden die **serverseitigen** Werte, nicht die des Clients. | `0002:628-654`, `0002:748-749` |
| Prüft sie die Invariante `Σ cash_from_box + unallocated = Σ cash − Σ payout`? | **Ja**, gegen die serverseitigen `v_cash`/`v_payout`; zusätzlich (nicht verlangt) `Σ transfers + uncoveredClaims = Σ positive residual`. | `0002:713-729` |
| Atomar (eine Funktion = eine Transaktion)? | **Ja.** plpgsql ohne `commit`/`rollback`; PostgREST fährt jeden Request in einer Transaktion. Jede `raise exception` rollt alles zurück, auch die schon geschriebenen `settlement_transfers`. Die Session-Zeile wird zu Beginn mit `for update` gesperrt → kein Doppelabschluss. | `0002:601-602`, `0002:738-807` |
| Setzt sie `app.session_transition`, sodass der Schutz-Trigger sie durchlässt? | **Ja**, unmittelbar vor dem Update und danach wieder auf `off`, beide Male transaktionslokal (`is_local = true`). | `0002:797`, `0002:807` |
| Ist dieser Pfad von außen setzbar? | **Nein** (statisch): `set_config`/`SET` sind über PostgREST nicht erreichbar; die Funktion ist `security definer` mit `set search_path = public` – ein untergeschobenes `set_config` aus einem anderen Schema ist damit ausgeschlossen. Der Trigger selbst (`validate_session_update`) ist bewusst **nicht** `security definer` und braucht es auch nicht. | `0002:437`, `0002:579`, `0002:825` |
| Prüft sie die Vollständigkeit? | **Ja**: Aufrufer `is_editor()`, Session existiert und ist `open`, mindestens ein Teilnehmer, jeder Teilnehmer hat einen `cash_out` (`MISSING_CASH_OUT`), Transfer-Spieler sind Teilnehmer dieser Session. | `0002:597-625`, `0002:786-795` |

**`security definer` + `search_path` (Testauftrag Punkt 5):** alle 15 Funktionen in `0002` tragen
`set search_path = public`; alle elf `security definer`-Funktionen ebenfalls. `revoke … from
public, anon` + `grant execute … to authenticated` liegen für alle sieben aufrufbaren Funktionen
vor (`0002:870-884`). Einzige Lücke: die acht reinen Trigger-Funktionen sind nicht revoked → F9
(ungefährlich, Rückgabetyp `trigger`).

**JSON-Vertrag:** die camelCase-Schlüssel in `close_session` (`playerId`, `cashIn`, `creditIn`,
`stack`, `payout`, `isCashPlayer`, `claim`, `cashTier1/2/3`, `cashFromBox`, `netResult`,
`residual`, `fromPlayerId`, `toPlayerId`, `amount`, `algorithmVersion`, `totalBuyIn`,
`totalStack`, `discrepancy`, `cashBoxStart`, `cashBoxAfterPayouts`, `unallocatedCash`,
`uncoveredClaims`) stimmen **exakt** mit `SettlementResult`/`SettlementLine`/`Transfer` aus
`docs/SETTLEMENT.md` überein und sind in `jsonb_to_recordset` korrekt gequotet. Einziges fehlendes
Feld: `uncoveredDebts` → F1.

**Passend dazu (positiv):** `settlement_input` liefert `position` je Teilnehmer und sortiert
danach (`0002:526-557`). WP3 hat `SettlementParticipant.position` in Runde 2 zur Pflicht gemacht
(`INVALID_POSITION`, kein Fallback auf den Array-Index) – die RPC erfüllt diesen Vertrag bereits,
und `session_players` garantiert die Eindeutigkeit über `unique (session_id, position)`
(`0001:118`). Hier passt WP1 zu WP3, ohne dass etwas zu ändern wäre.

**`reopen_session` (Testauftrag WP1):** Der alte `close_note` bleibt nachvollziehbar – der
Audit-Trigger auf `sessions` (`0002:261-264`) schreibt `old_data` mit dem vollständigen alten Wert,
bevor der Grund angehängt wird (`0002:857-859`). Das Löschen der `settlements` wird ebenfalls
auditiert (`0002:291-294`, `old_data` mit allen Summen). Damit ist die Historie mehrfacher
Abschlüsse vollständig im Log, wie SPEC §4 es nach der Planer-Entscheidung vorsieht.

---

## SQL-Syntax-Plausibilität (Testauftrag Punkt 10)

Schwerpunkt, weil nie ein Server über die Dateien gelaufen ist. Geprüft und **kein Fehler
gefunden**:

- `NEW`/`OLD` werden nirgends im `declare`-Block angefasst; `validate_entry` und
  `audit_row_change` verzweigen sauber über `tg_op`, bevor sie auf `new.`/`old.` zugreifen
  (`0002:222-229`, `0002:318-328`, `0002:344-352`) – genau der Fallstrick
  „record new is not assigned yet“. Als Test eingefroren.
- `tg_nargs`/`tg_argv` im `declare`-Block (`0002:216`): zulässig, die TG-Variablen sind beim
  Betreten des Blocks bereits gesetzt; `array['id']` und `tg_argv` sind beide `text[]`, der
  `case`-Ausdruck ist typkonsistent.
- Alle 15 `create trigger` enden auf `for each row execute function …` (nicht `execute procedure`).
- `generated always as (lower(trim(name))) stored` (`0001:77`): `lower(text)` und `btrim(text)`
  sind beide `IMMUTABLE`, damit für eine generierte Spalte zulässig. Ebenso `email = lower(email)`
  und `length(name) <= 60` als Check-Constraints.
- `alter table public.entries replica identity full` (`0004:32`) steht **nach** dem
  Publication-Block; `alter publication … add table` läuft transaktional und ist deshalb im
  `do`-Block über `execute format(…, %I)` zulässig. `return;` im `do`-Block (`0004:18`) ist in
  plpgsql erlaubt (anonymer Block = Prozedurkontext).
- Partial-Unique-Index mit `where` (`0001:149-150`), `filter (where …)` in Aggregaten
  (`0002:546-550`, `629-632`, `685-688`), `unnest(…) with ordinality` (`0002:240`),
  `jsonb_array_elements(…) with ordinality` (`0002:783`), `select … into … for update`
  (`0002:601`) – alles gültige Syntax.
- `jsonb_to_recordset` mit gequoteten camelCase-Spalten in `from`/`left join` (`0002:665-694`):
  korrekt, ohne Quotes würden die Schlüssel nicht matchen.
- Der jsonb-Existenzoperator `?` in plpgsql (`0002:242`): kein Platzhalter-Problem, weil der
  Funktionsrumpf serverseitig geparst wird.
- Ausbalancierte `$$`-Quotes in allen vier Dateien; keine verschachtelten Dollar-Blöcke.
- Alle Dateien sind UTF-8; die Umlaute in `'[wieder geöffnet: '` (`0002:859`) und in den
  Kommentaren sind unkritisch, solange der SQL-Editor UTF-8 überträgt (tut er).
- `E'\n'` innerhalb eines `$$`-Rumpfes (`0002:858`) ist gültig.
- Keine fehlenden Semikolons gefunden; keine `create policy` ohne vorheriges `drop policy if
  exists`; keine Anweisung ohne Abschluss.

Verbleibende Syntax-/Rechte-Risiken, die nur der erste Lauf zeigen kann, stehen unten unter
„Nicht verifiziert“.

---

## Findings

### F1 – [Major] `settlements` kann `uncoveredDebts` nicht speichern; `close_session` prüft es nicht

- **Wo**: `supabase/migrations/0001_schema.sql:163-175` (Tabelle `settlements`),
  `supabase/migrations/0002_functions_triggers.sql:639-654` und `713-752` (`close_session`),
  `src/lib/database.types.ts:464-503`
- **Beobachtet**: `docs/SETTLEMENT.md` (Abschnitt „Ausgabe“, Zeile 42) führt in `SettlementResult`
  das Feld `uncoveredDebts` („Schulden ohne Gläubiger, nur bei `discrepancy < 0` möglich“), und
  Schritt 5 verlangt, es getrennt zu melden; TV9b hat es als Pflicht-Erwartungswert
  (`unallocatedCash = 0, uncoveredDebts = 100`). In `settlements` gibt es dafür keine Spalte,
  `close_session` liest den Schlüssel nicht, prüft ihn nicht und speichert ihn nicht. Ein
  Round-Trip `SettlementResult → RPC-JSON → DB → SettlementResult` ist damit verlustbehaftet.
- **Erwartet**: Spalte `uncovered_debts_cents integer not null` in `settlements`, Übernahme aus
  `p_settlement ->> 'uncoveredDebts'` mit denselben Plausibilitätsprüfungen wie
  `unallocatedCash`/`uncoveredClaims` (`>= 0`), und sinnvollerweise die Invariante aus
  `docs/SETTLEMENT.md` Schritt 5: bei `discrepancy < 0` gilt
  `unallocatedCash + uncoveredDebts = −discrepancy`, bei `discrepancy >= 0` ist `uncoveredDebts = 0`.
  Dazu die Spalte in `src/lib/database.types.ts`.
  (Quelle: `docs/SETTLEMENT.md` „Ausgabe“ + „Schritt 5“ + TV9b; CLAUDE.md „Abrechnung wird
  eingefroren gespeichert und aus der DB angezeigt, nie neu berechnet“; WP6-Testauftrag
  „Mapping Result → RPC-JSON und zurück ist verlustfrei“.)
- **Reproduktion**: `sed -n '30,45p' docs/SETTLEMENT.md` zeigt `uncoveredDebts` im Ergebnistyp;
  `grep -n "uncovered" supabase/migrations/*.sql src/lib/database.types.ts` liefert ausschließlich
  `uncovered_claims_cents`/`uncoveredClaims`.
- **Einordnung**: `docs/SETTLEMENT.md` wurde in `83d157a` geändert, also **nach** Siris Commit
  `bc7aa02`. Kein Versäumnis Siris – aber `docs/SETTLEMENT.md` steht in der Wahrheitsreihenfolge
  über `docs/ARBEITSPAKETE.md`, und der Zeitpunkt ist ideal: die Datenbank ist noch nicht
  eingespielt, die Änderung kostet drei Zeilen statt einer Migration auf einer eingefrorenen
  Tabelle. Der Wert wäre zwar als `−discrepancy − unallocatedCash` rechnerisch rekonstruierbar,
  aber genau das ist die „nie neu berechnen“-Regel, die dieses Projekt sich gegeben hat.
  **Stand während dieser Prüfung:** `src/lib/settlement/types.ts` hat `uncoveredDebts` in der
  laufenden WP3-Runde-2 bereits bekommen (`SettlementResult.uncoveredDebts`, Kommentar
  „`unallocatedCash + uncoveredDebts === -discrepancy`“). Damit erzeugt der Algorithmus das Feld,
  und WP1 wirft es beim Speichern weg – die Lücke ist real, nicht theoretisch.

### F2 – [Minor] `close_session` prüft die Stufen-Verteilung und die Transfer-Richtung nicht

- **Wo**: `supabase/migrations/0002_functions_triggers.sql:665-729`
- **Beobachtet**: Geprüft werden alle *abgeleiteten* Größen (`claim`, `netResult`, `residual`,
  `cashFromBox = t1+t2+t3`, `cashFromBox ≤ claim`) und die beiden Summen-Invarianten. **Nicht**
  geprüft wird, wie die Kasse auf die Spieler verteilt wurde. Konkret bleiben durchsetzbar:
  1. Kernregel „Bargeld zuerst an Bar-Zahler“ (SETTLEMENT-Invariante 6): ein Aufruf kann einem
     Listen-Spieler `cashTier3 > 0` geben, während ein Bar-Zahler noch offenen Anspruch hat –
     die Summen stimmen weiterhin, `residual` wird passend mitgeliefert, nichts schlägt an.
  2. Invariante 5 (Stufe 1 wird voll bedient, wenn die Kasse reicht) wird nicht geprüft.
  3. Transfers: nur Summe (`Σ transfers + uncoveredClaims = Σ positive residual`) und
     Session-Zugehörigkeit. Richtung und Deckung fehlen – `fromPlayerId` muss kein Schuldner sein,
     und niemand prüft `Σ ausgehende Transfers je Spieler ≤ |negatives residual|`
     (SETTLEMENT-Invariante 9, Schuldnerseite).
  Da die Abrechnung eingefroren gespeichert und später nie neu gerechnet wird, ist die gespeicherte
  Zeile die Zahlungsanweisung an den Tisch.
- **Erwartet**: Das ist **plan-konform** – WP1 Schritt 2 verlangt für `close_session` nur den
  Summen-Vergleich und die Kasseninvariante, und die Stufen-Arithmetik (Largest Remainder) in SQL
  nachzubauen wäre unverhältnismäßig. Der Restweg ist aber billig zu schließen und sollte
  spätestens mit WP6 ergänzt werden:
  - Invariante 6: `if (Σ cashTier3) > 0 then` muss für jeden Spieler mit `isCashPlayer` gelten
    `cashTier1 + cashTier2 = claim`;
  - Invariante 5: wenn `Σ want1 ≤ box` (mit `want1 = max(0, min(cashIn, stack) − payout)`), dann
    `cashTier1 = want1` für jeden Bar-Zahler; sonst `cashTier1 ≤ want1`;
  - `cashTier3 = 0` für Bar-Zahler und `cashTier1 = cashTier2 = 0` für Listen-Spieler;
  - je Spieler `Σ transfers.amount as from ≤ greatest(−residual, 0)` und
    `Σ transfers.amount as to ≤ greatest(residual, 0)`;
  - `unallocatedCash > 0` nur bei `discrepancy < 0`, `uncoveredClaims > 0` nur bei `discrepancy > 0`.
- **Reproduktion**: Gedankenexperiment an TV2 (Ali cash 100/Stack 200, Ben cash 100/Stack 40,
  Can credit 100/Stack 60): ein Aufruf mit `cashFromBox` Ali 100, Ben 40, **Can 60** und
  passend gesetzten `residual` (Ali +100, Ben 0, Can −100) sowie einem Transfer `Can → Ali 100`
  erfüllt alle heutigen Prüfungen – gespeichert würde eine Abrechnung, die der Kernregel des
  Auftraggebers widerspricht. Nur ein manipulierter Client kommt dorthin; die App selbst rechnet
  mit `computeSettlement`.

### F3 – [Minor] Ein Entry-Update kann Session oder Spieler wechseln; die Kassenprüfung sieht nur die Zielseite

- **Wo**: `supabase/migrations/0002_functions_triggers.sql:320-328` und `402-416`,
  `supabase/migrations/0003_rls.sql:168-172`
- **Beobachtet**: `entries_update` erlaubt jede Spalte, solange alte und neue Session offen sind.
  `validate_entry` bestimmt `v_session`/`v_player` bei `UPDATE` ausschließlich aus `NEW`. Folgen:
  1. Ein Bar-`buy_in` lässt sich von Session A nach B verschieben. Für B wird die
     Kasseninvariante geprüft, für A nicht – A kann dadurch `Σ payout > Σ cash buy_in` bekommen,
     also genau die Vorbedingung verletzen, die `docs/SETTLEMENT.md` („Eingabe“) fordert und die
     `computeSettlement` mit `PAYOUT_EXCEEDS_CASHBOX` quittieren würde.
  2. Ein `cash_out` lässt sich auf einen anderen Spieler umhängen; der alte Spieler behält dann
     `payout`-Zeilen ohne `cash_out` (`PAYOUT_REQUIRES_CASH_OUT` wäre verletzt).
  Der direkte Weg – ein Bar-Buy-in löschen oder auf „Liste“ umstellen – ist dank der `c2`-Prüfung
  korrekt abgedeckt; nur der Wechsel des Bezugs ist offen.
- **Erwartet**: Bei `UPDATE` zusätzlich die alte Seite prüfen, am einfachsten, indem
  `session_id`/`player_id` (und `type`) unveränderlich gemacht werden – die App braucht diesen
  Fall nicht: WP5 kennt nur `updateCashOut` und `deleteEntry`. Ein Zweizeiler in `validate_entry`
  (`if tg_op = 'UPDATE' and (new.session_id, new.player_id) is distinct from (old.session_id,
  old.player_id) then raise exception 'IMMUTABLE_FIELD'`).
- **Reproduktion**: Nur per handgebautem PostgREST-`PATCH` durch einen Editor; über die geplante
  UI nicht erreichbar. Ohne eingespielte DB nicht ausführbar.

### F4 – [Minor] `created_by` / `added_by` / `updated_by` haben keinen Default und werden nicht erzwungen

- **Wo**: `supabase/migrations/0001_schema.sql:78, 94, 115, 135, 222`
- **Beobachtet**: Alle Erfasser-Spalten sind nullable, ohne `default auth.uid()` und ohne Trigger,
  der sie setzt oder gegen `auth.uid()` prüft. Ein Editor kann beim Insert einen beliebigen
  fremden Nutzer als Erfasser eintragen (oder das Feld leer lassen) – der Verlauf in WP5
  („`21:14 · Ali · Buy-in 100,00 € bar · von sirat@…`“) zeigt dann eine falsche Person.
  Das Audit-Log bleibt korrekt, weil `audit_row_change` `auth.uid()` selbst liest
  (`0002:217`), die Fälschung ist also nachweisbar – aber sichtbar ist sie zuerst in der UI.
- **Erwartet**: `default auth.uid()` auf `players.created_by`, `sessions.created_by`,
  `session_players.added_by`, `entries.created_by`, `settings.updated_by`, idealerweise plus
  `before insert`-Trigger `new.created_by := auth.uid()`. Der Plan schreibt zwar nur
  `created_by uuid references app_users(id)` (WP1 Schritt 1, also plan-konform), SPEC §4 verlangt
  aber „immer mit Zeitstempel und erfassendem Nutzer“.
- **Reproduktion**: Statisch: `grep -n "created_by\|added_by\|updated_by" supabase/migrations/0001_schema.sql`
  – kein `default` in Sicht.

### F5 – [Minor] Nach `reopen_session` bleiben `closed_at`, `closed_by` und `discrepancy_cents` stehen

- **Wo**: `supabase/migrations/0002_functions_triggers.sql:853-860`
- **Beobachtet**: Das Update setzt `status`, `reopened_at`, `reopened_by` und `close_note`, lässt
  `closed_at`, `closed_by` und `discrepancy_cents` aber unverändert. Eine wieder geöffnete Session
  ist damit `open` und trägt gleichzeitig die Abschlussdaten des vorigen Durchlaufs.
- **Erwartet**: Entweder mit zurücksetzen (`closed_at = null, closed_by = null,
  discrepancy_cents = null`) – dann bleibt die Historie ohnehin im Audit-Log – oder ausdrücklich
  dokumentieren, dass WP6/WP7 diese Felder nur bei `status = 'closed'` lesen dürfen. So oder so
  gehört es festgelegt, bevor WP6 darauf baut: `sessions.discrepancy_cents` einer offenen Session
  ist heute ein stiller Stolperstein für die Session-Liste und `player_stats`.
- **Reproduktion**: Code-Review; ohne DB nicht ausführbar.

### F6 – [Minor] `sessions_insert` erlaubt Abschlussfelder beim Anlegen

- **Wo**: `supabase/migrations/0003_rls.sql:120-122`
- **Beobachtet**: Die Insert-Policy erzwingt korrekt `status = 'open'` (gut – so entsteht keine
  unlöschbare „geborene“ Abschluss-Session), lässt aber `closed_at`, `closed_by`,
  `discrepancy_cents`, `close_note`, `reopened_at`, `reopened_by` frei. `validate_session_update`
  greift erst beim Update.
- **Erwartet**: Die Policy um `and closed_at is null and closed_by is null and discrepancy_cents
  is null and close_note is null and reopened_at is null and reopened_by is null` ergänzen (oder
  einen `before insert`-Zweig im vorhandenen Trigger). Sonst kann ein Editor eine offene Session
  mit erfundener Differenz und erfundenem Abschluss-Kommentar anlegen.
- **Reproduktion**: Nur per handgebautem Insert; ohne DB nicht ausführbar.

### F7 – [Minor] `rls-smoke` wertet „0 Zeilen ohne Fehler“ als „geblockt“ und lässt zwei Funktionen aus

- **Wo**: `scripts/rls-smoke.ts:102-106` und `195-211`
- **Beobachtet**: (a) `record()` bewertet eine erfolgreiche, leere Antwort als `blocked`. Gegen die
  frische Datenbank – und die ist beim ersten `rls:smoke` genau das: leer – liefert auch eine
  **ungeschützte** Tabelle 0 Zeilen. Das Script würde „OK: Ohne Login ist nichts lesbar“ melden,
  obwohl es nichts bewiesen hat. Da `0003` `anon` jedes Recht entzieht, ist der einzig korrekte
  Ausgang ein Fehler (42501); ein stiller Erfolg ist bereits verdächtig.
  (b) Von den sieben `grant`baren Funktionen testet das Script fünf; `current_app_role` und
  `session_is_open` fehlen.
- **Erwartet**: „0 Zeilen ohne Fehler“ als eigenes Ergebnis (`WARN`/`UNKLAR`) führen und im
  Schlusstext benennen, statt es unter `OK` zu verbuchen; die beiden fehlenden Funktionen
  ergänzen. (WP1 Schritt 8 verlangt „`select` liefert 0 Zeilen und `insert` schlägt fehl“ – der
  Buchstabe ist erfüllt, die Beweiskraft nicht.)
- **Reproduktion**: `npm run rls:smoke` gegen eine eingespielte, aber leere Datenbank, in der man
  probeweise eine Policy `for select to anon using (true)` setzt – das Script bliebe grün.

### F8 – [Minor] Drei Regeln fehlen in Siris SPEC-Mapping-Tabelle, eine Zeile ist zu stark formuliert

- **Wo**: `qa/handoffs/WP1-siri.md`, Abschnitt „SPEC-Regel → Trigger / Policy / Check“
- **Beobachtet/Erwartet**: siehe die Tabelle oben im Abschnitt „SPEC-Regel → …“. Ergänzen:
  Teilnehmer-**Hinzufügen** nur bei offener Session (`0003:145-148`), Konto-Löschung durch die
  `created_by`-FKs blockiert (SPEC §3, Planer-Entscheidung), Definition „Bar-Zahler“
  (`0002:700`). Zeile 24 präzisieren: die *abgeleiteten* Werte jeder Zeile werden nachgerechnet,
  die Stufen-Verteilung nicht (F2). Reine Dokumentation, kein Code-Problem – aber die Tabelle ist
  laut Handoff „als Checkliste gedacht“, und dann muss sie stimmen.

### F9 – [Minor] Trigger-Funktionen behalten das Default-`execute` für `public`

- **Wo**: `supabase/migrations/0002_functions_triggers.sql:870-876`
- **Beobachtet**: `revoke` steht für die sieben aufrufbaren Funktionen; die acht reinen
  Trigger-Funktionen (`handle_new_auth_user`, `protect_last_admin`, `protect_app_user_columns`,
  `touch_updated_at`, `audit_row_change`, `validate_entry`, `validate_session_update`,
  `validate_session_player_delete`) behalten das Postgres-Default `execute` für `public`.
- **Erwartet**: Praktisch ungefährlich – Funktionen mit Rückgabetyp `trigger` lassen sich weder
  über PostgREST noch per `select` aufrufen („trigger functions can only be called as triggers“).
  Trotzdem inkonsistent zur sonst konsequenten Least-Privilege-Linie der Datei; ein
  `revoke all on function … from public` je Trigger-Funktion kostet acht Zeilen und macht die
  Absicht eindeutig. Besonders relevant für die vier `security definer`-Trigger.

### F10 – [Minor] Prüfschritt 5 der Übergabe stimmt nicht

- **Wo**: `qa/handoffs/WP1-siri.md`, „So prüft man es“, Punkt 5
- **Beobachtet**: Dort steht, `grep -i "@" supabase/seed.sql` zeige „nur `ADMIN_EMAIL_*`,
  `EDITOR_EMAIL_1` und `example.invalid` im Kommentar“. Tatsächlich enthält `supabase/seed.sql`
  überhaupt kein `@`, der Befehl liefert **keine Ausgabe**; `example.invalid` steht in
  `scripts/rls-smoke.ts`, nicht im Seed.
- **Erwartet**: Formulierung korrigieren („liefert keine Treffer“). Kosmetik – aber der Planer
  führt diesen Befehl aus und soll das leere Ergebnis nicht für einen Fehler halten.

---

## Nicht verifiziert

Das ist der wichtigste Abschnitt dieses Berichts. **Nichts davon gilt als bestanden.**

1. **Kein einziger SQL-Befehl wurde ausgeführt.** Kein `psql`, kein Docker, keine lokale
   Postgres-Installation, und die Cloud-Datenbank ist bewusst leer geblieben. Syntax,
   Trigger-Reihenfolge, Constraint-Wirkung, Kaskadenverhalten, Policy-Auswertung und
   Fehlermeldungen sind ausschließlich gelesen, nicht gemessen. Der erste Lauf im SQL-Editor
   bleibt der eigentliche Test.
2. **Das RLS-Urteil selbst steht aus.** `npm run rls:smoke` konnte nur belegen, dass die
   Migrationen fehlen. Ob `anon` wirklich nichts liest und nichts schreibt, ob ein Viewer wirklich
   nirgends schreiben kann, ob ein Editor in einer geschlossenen Session wirklich scheitert – all
   das ist Papier. Nach dem Einspielen: `npm run rls:smoke` erneut, keine Zeile darf `LECK` sagen,
   und keine darf mehr `FEHLT` sagen.
3. **Trigger auf `auth.users`.** Ob das ausführende Rollen-Konto im SQL-Editor bzw. bei
   `supabase db push` `drop trigger`/`create trigger` auf `auth.users` darf, hängt vom
   Projekt-Setup ab. Siri hat den Fall im Handoff beschrieben; bestätigt ist er nicht.
   Schlägt es fehl, bekommt niemand eine `app_users`-Zeile und WP2 steht.
4. **Publication `supabase_realtime`.** `0004` überspringt sich selbst mit einer `notice`, wenn
   die Publication fehlt. Ob sie im Projekt existiert, ist ungeprüft. Beim Einspielen auf die
   Ausgabe achten – kommt die Notice, ist Realtime (WP5) tot, ohne dass etwas rot wird.
5. **`app.session_transition` nicht von außen setzbar.** Statisch sauber begründet (`set_config`
   liegt in `pg_catalog`, PostgREST exponiert nur `public`), aber nicht gemessen. Sollte ein
   späteres Paket eine `security definer`-Funktion in `public` anlegen, die `set_config` mit
   Client-Argumenten aufruft, fällt dieser Schutz – das ist eine Regel für WP2 ff.
6. **Idempotenz.** Nur statisch geprüft. Ein zweites echtes `db push` hat niemand laufen lassen.
7. **`generated always as (lower(trim(name))) stored`.** Die Immutabilität von `lower`/`btrim`
   stammt aus der Postgres-Doku, nicht aus einem Lauf.
8. **Supabase-Default-Privilegien.** Geprüft sind die expliziten `revoke`/`grant` in `0003`. Was
   Supabase beim Anlegen der Tabellen sonst noch an `anon` vergibt (Default-Privilegien,
   Schema-`usage`, künftige Objekte), ist ungeprüft. Nach dem Einspielen bitte einmal:
   `select grantee, table_name, privilege_type from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon';` → **muss leer sein.**
9. **Fehlermeldungen im Client.** Ob die 21 Codes als `message` bei PostgREST ankommen (und nicht
   als `details`), entscheidet über das Mapping in WP5. Nicht prüfbar ohne Server.
10. **Der `LAST_ADMIN`-Pfad beim Kaskadenlöschen aus `auth.users`** und das Zusammenspiel der drei
    `app_users`-Trigger (Reihenfolge alphabetisch: `protect_app_user_columns_trg` →
    `protect_last_admin_trg` → `touch_app_users`) sind nur gelesen. Die Reihenfolge passt, weil
    `updated_at` nicht in der Spaltenprüfung steht – aber gemessen ist auch das nicht.

### Konkret nachzuholen, direkt nach dem ersten Einspielen (Planer)

1. Die Ausgaben von 0001–0004 einzeln lesen; jede `notice` ernst nehmen (besonders bei 0004).
2. Siris Sichtprüfung (Handoff Schritt 8): 11 Tabellen mit `relrowsecurity = true`, 28 Policies.
3. Zusätzlich die `anon`-Grant-Abfrage aus Punkt 8 oben – Ergebnis muss leer sein.
4. `npm run rls:smoke` – jede Zeile `OK`, Exit-Code 0.
5. Kurzer Live-Gegentest mit zwei Konten, sobald WP2 steht: Viewer versucht einen Buy-in
   (muss 42501 geben), Editor versucht `update sessions set status='closed'` (muss `USE_RPC`
   geben). Erst dann sind die Zeilen a–n der Angriffstabelle wirklich belegt.

---

## Runde 2

Offen – noch keine Nacharbeit geprüft.

Zur Freigabe reicht F1 (drei Zeilen: Spalte, `close_session`, `database.types.ts`). Die neun
Minor-Findings sind Verbesserungen; F2, F3 und F5 sollten vor WP6 entschieden werden, F4 und F6
vor WP4/WP5, F7 vor dem ersten echten `rls:smoke`-Lauf.
