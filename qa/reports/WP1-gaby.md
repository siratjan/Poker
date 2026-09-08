# WP1 – Prüfbericht Gaby

**Urteil nach Runde 2: FREIGEGEBEN mit Hinweisen** (0 Blocker, 0 Major, 1 neuer Minor)

Alle zehn Findings aus Runde 1 sind abgearbeitet, der Major **F1 ist behoben**. Details,
Befehle und die Bewertung der drei geänderten Test-Literale stehen unten im Abschnitt
**„Runde 2“**; die Freigabe steht weiterhin unter dem Vorbehalt des Abschnitts
**„Nicht verifiziert“** – es ist nach wie vor kein einziger SQL-Befehl gelaufen.

*Urteil Runde 1 (historisch): NACHARBEIT (1 Major, 9 Minor, 0 Blocker).*

Geprüfter Stand Runde 1: `bc7aa02` „WP1: database schema, RLS, triggers“ (Arbeitsbaum auf `main`,
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

*Stand nach Runde 2 – die Punkte 6–9 sind wegen der Nacharbeit dazugekommen.*

1. Die Ausgaben von 0001–0004 einzeln lesen; jede `notice` ernst nehmen (besonders bei 0004).
   Neu in Runde 2 und deshalb besonders zu beobachten: die sechs `default auth.uid()` in 0001,
   die fünf `stamp_*`-Trigger und die neun `revoke all on function` am Ende von 0002.
2. Siris Sichtprüfung (Handoff Schritt 8): 11 Tabellen mit `relrowsecurity = true`, 28 Policies.
   Ergänzt: **20** Trigger und **16** Funktionen (Runde 2), nicht mehr 15/15.
3. Zusätzlich die `anon`-Grant-Abfrage aus Punkt 8 oben – Ergebnis muss leer sein.
4. `npm run rls:smoke` – **29** Prüfungen (nicht mehr 27), keine Zeile `LECK`, keine `FEHLT`,
   Exit-Code 0. `UNKLAR`-Zeilen sind kein Beweis: sie verschwinden erst, wenn Daten in der
   Datenbank liegen (nach WP2/WP4) oder wenn `anon` einen echten Fehler bekommt.
5. Kurzer Live-Gegentest mit zwei Konten, sobald WP2 steht: Viewer versucht einen Buy-in
   (muss 42501 geben), Editor versucht `update sessions set status='closed'` (muss `USE_RPC`
   geben). Erst dann sind die Zeilen a–n der Angriffstabelle wirklich belegt.
6. **F1:** `select column_name from information_schema.columns where table_name = 'settlements';`
   → `uncovered_debts_cents` muss dabei sein. Danach einmal eine Session mit Differenz
   abschließen (TV9b-Muster: nur Listen-Spieler, Chips fehlen) und prüfen, dass der Wert
   gespeichert ankommt.
7. **F4:** Als Editor einen Spieler anlegen und dabei absichtlich ein fremdes `created_by`
   mitschicken → `select created_by from public.players;` muss die **eigene** Nutzer-ID zeigen.
   Zusätzlich im SQL-Editor (ohne Login, `auth.uid()` ist null) eine Zeile einfügen: sie muss
   durchgehen, `created_by` bleibt dabei leer.
8. **F5:** Eine Session schließen und wieder öffnen: danach `closed_at`, `closed_by`,
   `discrepancy_cents` = `null`, `close_note` mit angehängtem Grund, und im `audit_log` die
   alten Werte in `old_data`.
9. **F3/F6:** Als Editor per PostgREST einen Eintrag auf eine andere Session umhängen
   (muss `ENTRY_IMMUTABLE_KEYS` geben) und eine Session mit gesetztem `discrepancy_cents`
   anlegen (muss 42501 geben).

---

## Runde 2

**Urteil: FREIGEGEBEN mit Hinweisen.** Geprüfter Stand: `05d4197` „WP1: address review findings
(round 2)“ (HEAD, Arbeitsbaum sauber bis auf meine neue Testdatei). Alle zehn Findings sind
abgearbeitet, keines ist nur behauptet. Ein neuer Minor (**F11**) ist beim Nachprüfen von F4
aufgefallen. Der Vorbehalt aus „Nicht verifiziert“ gilt unverändert: es ist immer noch kein
einziger SQL-Befehl gelaufen.

### Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `git show 05d4197 --stat` | 8 Dateien, +1493/−42; keine Datei außerhalb von `supabase/`, `scripts/`, `src/lib/database.types.ts`, `qa/`, `tests/gaby/` |
| `npm run check` (vor meiner neuen Testdatei) | **grün** – typecheck ok, ESLint ohne Ausgabe, 217 Tests in 9 Dateien, 846 ms |
| `npm run build` | **grün** – `/` und `/_not-found` statisch, `Proxy (Middleware)` aktiv; einzige Ausgabe weiterhin die bekannte `middleware`-Deprecation aus WP0 |
| `npm run rls:smoke` | **wie erwartet rot**: „29 Prüfungen · 0 beweisbar geblockt · 0 unklar · 0 Leck(s) · 29 nicht vorhanden“, danach die Klartextmeldung „ABBRUCH: Tabellen/Funktionen existieren nicht → die Migrationen sind noch nicht eingespielt“ mit Verweis auf die Anleitung, **Exit-Code 1**, kein Stacktrace |
| `grep -c "create trigger"` / `^create … function public\.` / `raise exception '[A-Z_]*'` in `0002` | **20** / **16** / **22** – die drei geänderten Literale stimmen mit der Datei überein |
| `grep -i "@" supabase/seed.sql` | keine Treffer (Exit 1) – genau das, was Siris korrigierter Prüfschritt 5 jetzt ankündigt |
| `npm run check` (nach meiner neuen Testdatei) | **grün** – 251 Tests in 10 Dateien, 908 ms |

**Neue eigene Tests: `tests/gaby/wp1-close-session.gaby.test.ts` – 34 Tests, alle grün.**

Die Datei bildet die **Annahmebedingung von `close_session` Zeile für Zeile in TypeScript nach**
(Kopfzahlen, Zeilenvergleich gegen die serverseitige Aggregation, alle sechs Invarianten aus
Runde 2) und beantwortet damit die zwei Fragen, die ohne Server sonst offen bleiben:

1. **Weist die RPC eine gültige Abrechnung fälschlich ab?** Das wäre der teure Fehler – der Tisch
   könnte nicht abrechnen, und die neuen Prüfungen wären ein Blocker statt eines Schutzes.
   Geprüft gegen alle Pflicht-Testfälle TV1–TV11 aus `docs/SETTLEMENT.md` **und** gegen 3000
   zufällig erzeugte Sessions (fast-check, Vorbedingungen `payout ≤ stack` und
   `Σ payout ≤ Σ cashIn`, alle drei Vorzeichen der Differenz). Ergebnis: **kein einziger
   Fehlalarm.** `computeSettlement` erzeugt nie eine Abrechnung, die `close_session` ablehnen
   würde. Das ist der wichtigste Befund dieser Runde.
2. **Fangen die neuen Prüfungen die Angriffe aus F2?** Ja – nachgestellt und abgewiesen werden:
   die Kernregel-Verletzung aus meiner F2-Reproduktion (Ali 100/Ben 40/**Can 60**) → genau
   `SETTLEMENT_INVARIANT` „Bar zuerst“; umgedrehte Transfer-Richtung; Empfänger, der gar keine
   Zeile der Abrechnung ist (die `left join`-Falle); Betrag 0 oder negativ; unterschlagene
   Überweisungen; verschwiegenes `uncoveredDebts` (TV9b); `uncoveredClaims` als
   `unallocatedCash` getarnt (TV10); Restbeträge bei sauberer Differenz 0.

Der letzte Abschnitt der Datei friert die Nacharbeit **namentlich** im SQL ein (Spalte,
`stamp_*`-Trigger, `stamp_actor`-Rumpf, Policy-Zusätze, die neun Revokes, die Regel (f) in
`validate_entry`). Das ist bewusst die Ergänzung zu den drei hochgezählten Literalen: die
Zählwerte sagen nur noch *wie viele*, meine neue Datei sagt *welche*.

### Findings aus Runde 1

| # | Grad | Status | Nachgeprüft an |
|---|---|---|---|
| **F1** | Major | **✔ behoben** | `0001:175` Spalte `uncovered_debts_cents integer not null`; `close_session` liest `uncoveredDebts` (`0002:737`), verlangt es (`coalesce(…, -1) < 0` → `SETTLEMENT_MISMATCH`, ein **fehlender** Schlüssel fällt dadurch ebenfalls auf), prüft alle drei Gleichungen (`0002:870-888`) und speichert es (`0002:902`); `database.types.ts:477/491/505` in `Row`/`Insert`/`Update`. Round-Trip ist verlustfrei. |
| **F2** | Minor | **✔ im entschiedenen Umfang (a)–(d)** | Richtung `0002:837-855`, Summe/`min()` `0002:820-836`, „Bar zuerst“ `0002:856-866`. Rest bewusst offen, Bewertung unten. |
| **F3** | Minor | **✔ behoben** | `0002:409-415` Regel (f), Zeilenvergleich über `(new.session_id, new.player_id, new.type)`; steht **hinter** der Statusprüfung, `SESSION_CLOSED` behält also Vorrang. Der Weg „aus einer geschlossenen Session heraus“ war ohnehin schon durch `entries_update … using session_is_open` (RLS wertet `using` gegen die **alte** Zeile aus) gedeckt – jetzt doppelt. |
| **F4** | Minor | **✔ behoben, wie beauftragt** | `0001:78/94/115/135/167/223` sechs `default auth.uid()`; `0002:186` `stamp_actor()` + fünf `before insert`-Trigger. Siehe die Detailprüfung unten – und **F11** für den Rest, den F4 nicht adressiert hat. |
| **F5** | Minor | **✔ behoben** | `0002:1018-1020` setzt `closed_at`, `closed_by`, `discrepancy_cents` auf `null`; `close_note` bleibt und bekommt den Grund angehängt, die alten Werte stehen im `audit_log` (`old_data`). WP6/WP7 dürfen `sessions.discrepancy_cents` jetzt ohne Statusblick lesen. |
| **F6** | Minor | **✔ behoben** | `0003:120-134`: `sessions_insert` verlangt zusätzlich `closed_at/closed_by/discrepancy_cents/close_note/reopened_at/reopened_by is null`. |
| **F7** | Minor | **✔ behoben** | `scripts/rls-smoke.ts`: neues Urteil `UNKLAR`, `settings` als beweiskräftiger Fall (0001 legt dort `quick_amounts_cents` an), `current_app_role` und `session_is_open` ergänzt → 29 Prüfungen, ausgeführt und gesehen. Schlusszeile unterscheidet „OK“ von „OK mit Einschränkung“. |
| **F8** | Minor | **✔ behoben** | Handoff-Tabelle hat die drei fehlenden Regeln als Zeilen 38–40 und die Runde-2-Regeln 41–46; Zeile 24 ist auf „die aus der Aggregation ableitbaren Werte“ präzisiert. Stichprobe auf die Fundstellen der neuen Zeilen: alle sechs stimmen. |
| **F9** | Minor | **✔ behoben** | `0002:1055-1063`: `revoke all on function … from public, anon, authenticated` für **neun** Trigger-Funktionen (acht plus das neue `stamp_actor`). Die Trigger feuern weiter – das Ausführungsrecht wird bei `create trigger` geprüft, nicht beim Feuern. |
| **F10** | Minor | **✔ behoben** | Prüfschritt 5 sagt jetzt „liefert keine Treffer“ und nennt den Grund; nachgestellt: `grep -i "@" supabase/seed.sql` ist leer. |

### Bewertung der drei Literale in `tests/gaby/wp1-schema.gaby.test.ts`

Siri hat in meiner Testdatei genau drei Zahlen/Listeneinträge geändert und das im Commit und im
Handoff offengelegt. Ich habe jede Änderung gegen die Datei nachgezählt und gegen die Frage
geprüft, ob sie eine Zusicherung schwächt:

| Änderung | zwingende Folge? | schwächt sie etwas ab? | Urteil |
|---|---|---|---|
| Trigger `15 → 20` (`expect(created).toBe(20)`) | **Ja.** F4 verlangte laut meinem eigenen „Erwartet“ ausdrücklich `before insert`-Trigger; es sind exakt die fünf `stamp_*`. `grep -c "create trigger"` = 20. | **Nein.** Die eigentlichen Zusicherungen des Tests sind `dropped === created` und `executed === created` (Idempotenz + `execute function`), und die gelten unverändert für alle 20. Die Zahl ist der Wecker, nicht der Schutz. | **akzeptiert** |
| Funktionen `15 → 16` (`expect(functionHeaders.length).toBe(16)`) | **Ja.** `stamp_actor()` ist die Trigger-Funktion zu F4. `grep -c` = 16. | **Nein.** Die Schleife darunter prüft *jede* der 16 Funktionen auf `set search_path`; `stamp_actor` trägt `set search_path = public` und ist zu Recht **nicht** `security definer` (sie schreibt nur in `NEW`). Der zweite Test „keine security-definer-Funktion ohne search_path“ ist ebenfalls unverändert. | **akzeptiert** |
| `KNOWN_ERROR_CODES` 21 → 22 (`ENTRY_IMMUTABLE_KEYS`) | **Ja.** F3 brauchte einen neuen Code, der Name kam vom Planer. | **Nein** – im Gegenteil. Die Zusicherung ist eine **Mengengleichheit** gegen alle `raise exception`-Codes im SQL (`toEqual`), kein „mindestens“: ein Code mehr *oder weniger* lässt den Test fallen. Die Liste ist alphabetisch sortiert, der neue Eintrag steht an der richtigen Stelle und ist kommentiert. Genau der Zweck des Tests – „ein neuer Code erinnert daran, dass WP5 eine deutsche Meldung braucht“ – ist eingelöst: der Fehlercode-Katalog im Handoff steht jetzt auf 22 Einträgen. | **akzeptiert** |

**Zusammengefasst: alle drei Änderungen sind zwingende Folgen der Nacharbeit, keine schwächt eine
Zusicherung ab, und keine ist heimlich passiert.** Kein Major. Was die Zählwerte an Aussagekraft
verlieren (sie sagen nicht, *welche* fünf Trigger dazugekommen sind), holt meine neue Datei
`tests/gaby/wp1-close-session.gaby.test.ts` namentlich nach.

### Detailprüfung der heiklen Stellen

**Die drei Gleichungen aus `docs/SETTLEMENT.md` Schritt 5** (`0002:869-888`) stimmen wortgetreu
mit dem Dokument überein und sind mit TV9 (−10 → `unallocated 10`, `uncoveredDebts 0`),
TV9b (−100 → `unallocated 0`, `uncoveredDebts 100`) und TV10 (+10 → `uncoveredClaims 10`) von
Hand nachgerechnet. `discrepancy = 0` verlangt alle drei auf 0 – das folgt aus
`Σ residual == 0` (Invariante 3) und ist keine Übererfüllung.

**`Σ transfers = min(Σ pos, Σ neg)`** ist strenger als Invariante 9 (`≤`) – und trotzdem korrekt:
die Greedy-Schleife in Schritt 5 läuft, bis eine der beiden Listen leer ist, verschiebt also
exakt das Minimum. Die 3000 Zufallsläufe bestätigen es; ein zu strenger Vergleich wäre hier der
gefährlichere Fehler gewesen (gültige Abrechnung nicht speicherbar).

**`jsonb_to_recordset` + `left join` (Testauftrag 3):** Die Typen der Spaltenlisten passen zum
JSON-Vertrag (`"playerId" uuid`, `"residual"/"amount"/"cashTier3"/"claim"/"cashFromBox" integer`,
`"isCashPlayer" boolean`), alle camelCase-Schlüssel sind gequotet. Die entscheidende Frage – darf
eine **fehlende** Zeile stillschweigend durchgehen? – ist mit **Nein** beantwortet: die
`where`-Klausel enthält ausdrücklich `lf."playerId" is null or lt."playerId" is null`
(`0002:848`), ein Transfer auf einen Nicht-Teilnehmer fliegt also auf, statt per `left join`
unbemerkt zu verschwinden. Nachgestellt in meinem Test („Empfänger ist gar kein Spieler dieser
Abrechnung“). Duplikate in `lines` – die den Join vervielfachen würden – sind schon vorher
ausgeschlossen (`count(distinct) = count(*) = Teilnehmerzahl`, `0002:739-745`). Die beiden
`left join` auf dieselbe Liste sind unkorreliert, brauchen also kein `lateral`.

**`isCashPlayer`/`claim`/`cashFromBox` in der „Bar zuerst“-Prüfung** stammen aus der
Client-Zeile, nicht aus der Aggregation – das ist unbedenklich, weil genau diese drei Werte
zwanzig Zeilen weiter oben gegen die serverseitige Aggregation geprüft wurden. Ein `null` in
`isCashPlayer` (Schlüssel fehlt) fällt dort ebenfalls auf und nicht erst hier.

**`stamp_actor()` (Testauftrag 4):** Wird `created_by` auch dann gesetzt, wenn der Client einen
fremden Wert schickt? **Ja** – der Trigger weist `new.created_by := auth.uid()` **unbedingt** zu,
es ist kein `coalesce` und kein „nur wenn leer“ (im Test festgenagelt). Bleibt der
SQL-Editor-Pfad heil? **Ja**: bei `auth.uid() is null` gibt die Funktion `NEW` unverändert
zurück, und **keine** der gestempelten Spalten ist `not null` (`created_by`, `added_by`,
`computed_by`, `updated_by` sind alle nullable, ebenfalls im Test festgenagelt) – der Planer kann
also weiter von Hand bootstrappen, ohne dass ein Constraint bricht. `stamp_actor` ist zu Recht
**kein** `security definer`; das wäre hier eine unnötige Rechteerhöhung gewesen.
`settings` bekommt den Trigger zusätzlich auf `update`, was zu „`updated_by` = wer zuletzt
geändert hat“ passt. Trigger-Reihenfolge unkritisch: `stamp_*` sortiert alphabetisch vor
`validate_*` und `touch_*`, und keine dieser Funktionen liest die gestempelten Spalten.

**SQL-Syntax-Plausibilität der neuen Konstrukte (Testauftrag 8)** – gelesen, kein Fehler
gefunden, aber wie gehabt nicht ausgeführt:

- `default auth.uid()` in `create table`: zulässig, Default-Ausdrücke dürfen Funktionen
  aufrufen; `auth.uid()` ist in Supabase `stable` und liefert bei fehlendem JWT `null`
  (`current_setting(…, true)`), wirft also nicht. Voraussetzung ist, dass das `auth`-Schema beim
  Lauf von `0001` schon existiert – in einem Supabase-Projekt ist das der Fall.
- `raise exception 'CODE' using errcode = 'P0001', detail = 'a' || 'b';` – die `using`-Liste ist
  eine Komma-Folge von `option = expression`, ein zusammengesetzter Text ist damit erlaubt.
  Wichtig für WP5: der Code bleibt in `message`, der neue Text landet in `detail` – am Mapping
  in `src/lib/errors/de.ts` ändert sich dadurch nichts.
- Zeilenvergleich `(a, b, c) is distinct from (d, e, f)` in `validate_entry`: gültige
  Row-Konstruktor-Syntax, `NULL`-sicher, und `OLD` ist im `tg_op = 'UPDATE'`-Zweig garantiert
  belegt.
- `least(v_pos_residual, v_neg_residual)` über zwei `bigint`: typkonsistent.
- `revoke all on function public.f() from public, anon, authenticated;` – gültig; die Trigger
  laufen weiter, weil das Ausführungsrecht bei `create trigger` geprüft wird.
- Unverändert gilt: die `$$`-Quotes sind in allen vier Dateien ausbalanciert (Test), und die
  neuen Umlaute in den `detail`-Texten sind unkritisch, solange der SQL-Editor UTF-8 überträgt.

### Siris „bewusst offen“ zu F2 – reicht das für die Freigabe?

**Ja, es reicht** – mit einer Präzisierung, die im Bericht stehen soll, damit sie in WP6 nicht
verloren geht. Begründung:

- Die Quelle der Wahrheit ist der TypeScript-Algorithmus (`computeSettlement`, WP3, in Runde 2
  freigegeben, mit Property-Tests auf genau diese Invarianten). `close_session` ist die
  Plausibilitätsschranke gegen einen manipulierten Client, nicht die zweite Implementierung.
  Die Stufen-Arithmetik (Largest Remainder) in SQL nachzubauen wäre eine zweite Quelle der
  Wahrheit – das ist teurer und riskanter als die Lücke.
- Erreichbar ist die Lücke nur für ein Konto mit **Editor-Rechten**, das die RPC von Hand mit
  einem selbstgebauten JSON aufruft. Die App schickt immer das Ergebnis von `computeSettlement`.
- Der Rest ist klein geworden: mit (a)–(d) fällt jede Verteilung durch, bei der ein Bar-Zahler
  Bargeld verliert, *sobald ein Listen-Spieler welches bekommt* – das ist die Kernregel des
  Auftraggebers und der Fall, den ich in F2 reproduziert hatte.

Präzisierung – die drei Reste sind nicht gleich harmlos:

1. **Harmlos (reine Beschriftung):** `cashTier3 > 0` für einen Bar-Zahler. Da `cashFromBox ≤ claim`
   erzwungen ist und die „Bar zuerst“-Prüfung `cashFromBox = claim` verlangt, verschiebt das
   kein Geld – es benennt nur die Stufe falsch, aus der er bedient wurde. In meinem Test belegt.
2. **Nicht harmlos:** Invariante 5 (Stufe 1 anteilig kürzen, wenn die Kasse nicht reicht).
   Reicht die Kasse für zwei Bar-Zahler nicht, kann ein manipulierter Aufruf dem einen alles bar
   geben und den anderen mit einem Schuldschein nach Hause schicken – `Σ cashTier3` bleibt 0, die
   „Bar zuerst“-Prüfung greift also gar nicht. Das verschiebt echtes Ausfallrisiko zwischen zwei
   Spielern. Als Test festgehalten („Stufe 1 darf einseitig statt anteilig bedient werden“).
3. **Nicht harmlos, in F2 genannt, nicht im entschiedenen Umfang (a)–(d) enthalten:** die
   **Deckung je Spieler** bei Transfers. Richtung und Gesamtsumme stimmen jetzt, aber niemand
   prüft `Σ ausgehende Transfers je Spieler ≤ |negatives residual|`. Zwei Schuldner à 100 und
   zwei Gläubiger à 100 lassen sich als „A zahlt 200, B zahlt nichts“ speichern. Ebenfalls als
   Test festgehalten.

Empfehlung an den Planer: Punkte 2 und 3 als eine Zeile in den WP6-Testauftrag aufnehmen
(zwei `exists`-Prüfungen, je drei Zeilen SQL). Sie blockieren WP1 nicht.

### F11 – [Minor, neu] `created_by` ist nur beim `insert` geschützt, nicht beim `update`

- **Wo**: `supabase/migrations/0002_functions_triggers.sql:212-231` (`stamp_players`,
  `stamp_entries` sind `before insert`), `supabase/migrations/0003_rls.sql:103-105`
  (`players_update`), `0003:180-184` (`entries_update`)
- **Beobachtet**: F4 ist genau so umgesetzt, wie ich es beauftragt hatte (Default + `before
  insert`) – und deckt damit den Insert-Weg vollständig ab. Offen bleibt der Update-Weg: ein
  Editor kann per PostgREST-`PATCH` `players.created_by` bzw. `entries.created_by` einer
  bestehenden Zeile auf einen **fremden** Nutzer setzen. `validate_entry` prüft seit F3 zwar
  `session_id`, `player_id` und `type`, aber nicht `created_by`/`created_at`; auf `players` gibt
  es überhaupt keinen Validierungs-Trigger. Bei `sessions` ist der Fall dagegen sauber gedeckt
  (`0002:532-536`, `IMMUTABLE_FIELD` für `id`, `created_at`, `created_by`), bei
  `session_players` gibt es gar keine Update-Policy, und `settings.updated_by` wird auch bei
  `update` gestempelt. Es fehlen also genau zwei Tabellen.
- **Erwartet**: Dieselbe Linie wie bei `sessions`. Entweder `stamp_actor` um einen
  `before update`-Zweig erweitern (`new.created_by := old.created_by; new.created_at :=
  old.created_at;`) und die Trigger auf `before insert or update` ziehen, oder in `validate_entry`
  eine Regel (g) mit `IMMUTABLE_FIELD` ergänzen und `players` einen entsprechenden Trigger geben.
  (Quelle: SPEC §4 „immer mit Zeitstempel und erfassendem Nutzer“; Zeile 44 der Mapping-Tabelle im
  Handoff sagt „Erfassender Nutzer kommt aus dem Token, nicht vom Client“ – für den Update-Weg
  ist das heute noch zu stark formuliert.)
- **Einordnung**: Minor, nicht Blocker. Die Fälschung ist im `audit_log` nachweisbar, weil
  `audit_row_change` `auth.uid()` selbst liest und die alte Zeile in `old_data` sichert; sichtbar
  falsch ist zuerst der Verlauf in WP5. Über die geplante UI ist der Fall nicht erreichbar
  (WP5 kennt nur `updateCashOut` und `deleteEntry`).
- **Reproduktion**: Statisch: `grep -n "before insert on public.players\|before insert on
  public.entries" supabase/migrations/0002_functions_triggers.sql` – kein `or update`;
  `grep -n "created_by" supabase/migrations/0002_functions_triggers.sql` zeigt die
  `IMMUTABLE_FIELD`-Prüfung nur in `validate_session_update`. Live erst nach dem Einspielen.

### Was für die Freigabe offen bleibt

Nichts, was WP1 aufhält. Zur Erinnerung für spätere Pakete:

- **F11** (oben) – zusammen mit F4 zu Ende bringen, am besten vor WP5 (der Verlauf zeigt den
  Erfasser).
- **F2, Reste 2 und 3** – in den WP6-Testauftrag.
- Der komplette Abschnitt **„Nicht verifiziert“** gilt unverändert; die Checkliste „Konkret
  nachzuholen, direkt nach dem ersten Einspielen“ ist auf den Stand von Runde 2 gebracht
  (Punkte 6–9 sind neu).
