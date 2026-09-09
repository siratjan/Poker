# WP8 – Prüfbericht Gaby

**Urteil: NACHARBEIT**

Geprüfter Stand: `1dfaea1` „WP8: admin area and audit log" (Merge `7139a56`) auf `main`.
Diff-Basis: `f508297` (WP6-Abnahme), WP7-Anteile (`642446e`) ausgeklammert. Datum: 2026-09-09.

Kein Blocker. **Ein Major (F1)**, drei Minor (F2–F4). Der sicherheitsrelevante Kern hält:
alle vier Admin-Actions prüfen `requireAdmin()` vor dem ersten DB-Zugriff, die Admin-Seite
lädt für Nicht-Admins **nichts**, `describe.ts` stürzt auch bei mutwillig kaputtem JSON nicht
ab, Geld läuft ausschließlich über `formatCents`, und die Pagination ist echtes Keyset.
Was fehlt, ist eine Zeile: der Log-Filter wechselt die URL, aber die Liste bleibt auf dem
Client-State der ersten Seite stehen.

---

## Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `npm run check` (typecheck + lint + test) | **grün** – 44 Dateien, 917 Tests (Stand vor meinen Tests) |
| `npm run build` | **grün** – `/admin` und `/log` sind dynamisch (ƒ) |
| `npm test` nach meinen Tests | **grün** – 45 Dateien, **972 Tests** (55 davon neu von mir) |
| `npm run rls:smoke` (live gegen `vcyqzqgybjggoreffwjc`) | **grün** – 29 Prüfungen, 29 beweisbar geblockt, 0 Lecks; u. a. `select audit_log`, `select settings`, `rpc is_admin` je `42501` |
| `npx vitest run src/lib/audit src/actions/admin.test.ts` | grün (Siris 71 neue Tests) |
| `npx vitest run tests/gaby/wp6-close.gaby.test.ts` | **grün** – WP6-Regression nach der F3-Änderung unverändert (Teil des Gesamtlaufs) |

Eigene Tests: **`tests/gaby/wp8-admin-audit.gaby.test.ts` – 55 Tests, grün.**
Inhalt: Tabelle×Aktion-Matrix, Geld-Formatierung, gelöschte Zeilen aus `old_data`,
Robustheit (feste kaputte Payloads + 500 fast-check-Läufe mit beliebigem JSON),
nachgebaute Keyset-Pagination über eine Seitengrenze mit identischen `at`-Werten,
Filter-Einschleusversuche, Zod-Grenzen, und statische Zusagen (Rollenwächter-Reihenfolge,
kein Supabase in Client-Komponenten, `React.cache` bei `getCurrentUser`,
`AUDITED_TABLES` = Trigger in 0002).

`git diff f508297..1dfaea1 -- tests/gaby` ist leer: **Siri hat `tests/gaby/**` nicht angefasst.**
(`tests/gaby/wp7-players.gaby.test.ts` der parallelen WP7-Prüfung habe ich nicht berührt.)

---

## DoD-Abgleich

| DoD-Punkt (ARBEITSPAKETE.md WP8) | Status | Anmerkung |
|---|---|---|
| Rolle ändern wirkt sofort | ✅ (statisch) | `getCurrentUser` ist `React.cache(...)` — Cache lebt genau einen Request (`getCurrentUser.ts:23`), kein `unstable_cache`, kein Modul-Cache. Die nächste Serveranfrage des Betroffenen liest `app_users.role` neu. Browser-Gegenprobe siehe unten. |
| Letzter Admin kann nicht degradiert werden | ✅ | DB-Trigger `protect_last_admin` (0002:103-134) wirft `LAST_ADMIN`; `translateDbError` → „Der letzte Admin kann nicht degradiert werden. Mach zuerst jemand anderen zum Admin." (`de.ts:20`, Plan-Wortlaut). Dropdown springt zurück (`UserRoleList.tsx:51-54`). Mein WP5-Mapping-Test prüft **Vollständigkeit und Deutschsein**, nicht den Wortlaut → bleibt grün, kein Konflikt. |
| Log zeigt jede Aktion aus WP4–WP6 lesbar | ✅ | Matrix unten: alle 7 auditierten Tabellen × 3 Aktionen liefern einen deutschen Satz ohne rohe UUID. |
| Gelöschte Einträge mit alten Werten sichtbar | ✅ | `payloadOf` fällt auf `old_data` zurück (`describe.ts:387`); „hat Buy-in 100,00 € bar für Ali gelöscht", „hat Stack 250,00 € für Ali gelöscht" (mein Test). |
| Admin-Seite serverseitig geschützt | ✅ | `admin/page.tsx:20-33`: erst `getCurrentUser`, dann `isAdmin`, **danach erst** `getAdminData()`. Ohne Session Redirect auf `/login`. Für Nicht-Admins wird keine einzige Admin-Abfrage abgesetzt (statisch geprüft, Test „prüft die Rolle vor jeder Datenabfrage"). Zusätzlich RLS: `role_whitelist` ist admin-only in jeder Richtung (0003:57-74). |
| Alle vier Actions mit `requireAdmin` | ✅ | Tabelle unten. |
| Pagination Keyset `at desc, id desc`, Cursor auf `id` | ✅ | `auditLog.ts:39-47`, `cursor.ts:21`; kein `.range()`, kein Offset. Simulation mit 12 Zeilen / 3 Zeitstempeln über jede Seitengröße: exakt einmal jede Zeile, richtige Reihenfolge; eine zwischen zwei Seiten eingefügte neuere Zeile verschiebt nichts. |
| „Mehr laden" über Server Action, nur eingeloggt | ✅ | `audit.ts:22` `requireUser()` vor `getAuditPage`; keine Schreiboperation in der Datei; RLS greift, weil `createClient()` die Request-Cookies benutzt. |
| Filter Session/Nutzer/Tabelle als URL-Parameter | ⚠️ | Parsen und Validierung sind sauber (F-Test: 10 Einschleusversuche, alle verworfen). **Aber:** der Wechsel eines Filters aktualisiert die Liste nicht — F1. |
| Link „Log dieser Session" vorgefiltert | ✅ | `sessions/[id]/page.tsx:52-57` → `sessionLogHref(id)` = `/log?session=<uuid>`; `parseAuditFilters` liest ihn zurück. |
| Geld = Integer-Cent, keine `any`, Lint sauber, UI Deutsch | ✅ | Kein `any`, kein `eslint-disable`, kein `@ts-`-Kommentar im WP8-Diff. Beträge nur über `formatCents`/`formatSignedCents`; ein Float in `amount_cents` wird **weggelassen** statt gerundet. |
| Kein `.from(` in Client-Komponenten | ✅ | `AuditLogList`, `UserRoleList`, `WhitelistManager`, `QuickAmountsEditor` importieren nichts aus `@/lib/supabase`. |
| `npm run check` + `npm run build` grün | ✅ | Auch `npm run lint` ist jetzt insgesamt grün (WP6-F1 an der Werkzeugkette ist erledigt). |
| Keine neuen Abhängigkeiten | ✅ | `package.json` im WP8-Diff unverändert. |
| WP6-F2 (veralteter Kommentar) | ✅ | `SessionDetailClient.tsx:495` beschreibt den Ist-Zustand. |
| WP6-F3 („Summe" = Kasse) | ✅ | `SettlementView.tsx:61` und `shareText.ts:55` zeigen `cashBoxAfterPayouts`. Nachgerechnet: `verify.ts:147` erzwingt `Σ cashFromBox + unallocatedCash = totalCash − totalPayout = cashBoxAfterPayouts` — die Zeilen addieren sich also für **jede** gespeicherte Abrechnung zur Summe. TV9: 190,00 € + 10,00 € = 200,00 €. Meine WP6-Snapshot-Tests (TV2/TV4/TV8/TV9/TV9b/TV10) bleiben grün. |

---

## Tabelle × Aktion (`describe.ts`), von mir erzeugt und geprüft

Payload = realistische Zeile der jeweiligen Tabelle, Namen aufgelöst (Ali / Sa, 12.09.2026).

| Tabelle | INSERT | UPDATE | DELETE |
|---|---|---|---|
| `sessions` | hat die Session vom Sa, 12.09.2026 angelegt | hat die Session … geändert | hat die Session … gelöscht |
| `session_players` | hat Ali zur Session hinzugefügt | hat die Teilnahme von Ali geändert | hat Ali aus der Session entfernt |
| `entries` | hat Buy-in 100,00 € bar für Ali eingetragen | hat Buy-in 100,00 € bar für Ali geändert | hat Buy-in 100,00 € bar für Ali gelöscht |
| `players` | hat den Spieler „Ali" angelegt | hat den Spieler „Ali" geändert | hat den Spieler „Ali" gelöscht |
| `app_users` | hat sich zum ersten Mal angemeldet (Rolle Betrachter) | hat die Rolle von ali@… von Betrachter auf Bearbeiter gesetzt | hat den Nutzer ali@… gelöscht |
| `settings` | hat die Schnellbeträge auf 50,00 € / 100,00 € / 200,00 € gesetzt | dito | hat die Einstellung „quick_amounts_cents" gelöscht |
| `settlements` | hat die Abrechnung der Session vom … gespeichert | … geändert | hat die gespeicherte Abrechnung der Session vom … gelöscht |
| unbekannt (`role_whitelist`, `settlement_lines`, `""`) | hat einen Eintrag in „…" angelegt | … geändert | … gelöscht |

Sonderfälle (UPDATE mit erkannter Absicht):

| Fall | Satz |
|---|---|
| Abschluss mit Differenz | hat die Session vom Sa, 12.09.2026 abgeschlossen (Differenz -20,00 €) |
| Wieder öffnen | hat die Session vom Sa, 12.09.2026 wieder geöffnet |
| Umbenennen (Session) | hat die Session … umbenannt: „A" → „B" |
| Umbenennen (Spieler) | hat den Spieler „Ali" in „Alina" umbenannt |
| Betrag geändert | hat Buy-in für Ali von 100,00 € auf 50,00 € geändert |
| Rolle geändert | hat die Rolle von a@b.de von Betrachter auf Admin gesetzt |
| Name unbekannt | hat Unbekannt aus der Session entfernt (nie eine rohe UUID) |

Robustheit: `null`, `[]`, `[1,2,3]`, `"kaputt"`, `42`, `true`, falsche Typen in jedem Feld,
plus 500 fast-check-Läufe mit beliebigem JSON auf jede Tabelle/Aktion — **kein Absturz, kein
`undefined`/`NaN`/`[object …]` im Text**, immer ein Satz. Geld: `amount_cents: 100.5` wird
weggelassen („hat Buy-in bar für Ali eingetragen"), nie gerundet, nie als roher Integer gezeigt.

## Rollenwächter der Server Actions

| Action | Wächter | vor DB-Zugriff? | DB-Grenze |
|---|---|---|---|
| `setUserRole` | `requireAdmin()` | ✅ (`admin.ts:37`, vor `parseInput` und `createClient`) | RLS `app_users_update` (admin) + `protect_app_user_columns` (nur `role`) + `protect_last_admin` |
| `setQuickAmounts` | `requireAdmin()` | ✅ (`admin.ts:63`) | RLS `settings_insert`/`settings_update` (admin) |
| `upsertWhitelist` | `requireAdmin()` | ✅ (`admin.ts:85`) | RLS `role_whitelist_*` (admin in jeder Richtung) |
| `removeWhitelist` | `requireAdmin()` | ✅ (`admin.ts:103`) | RLS `role_whitelist_delete` (admin) |
| `loadAuditPage` (lesend) | `requireUser()` | ✅ (`audit.ts:22`) | RLS `audit_log_select` (jeder Eingeloggte), keine Schreibrechte für niemanden |

zod-Grenzen nachgeprüft: Schnellbeträge 1–6 Werte, `> 0`, Integer, eindeutig, aufsteigend
gespeichert, Obergrenze `MAX_AMOUNT_CENTS`; `"5000"`, `100.5`, `0`, `-100`, `NaN`, 7 Werte,
Dubletten werden abgewiesen. Whitelist-Adresse `"  Ali@Example.COM "` → `ali@example.com`
(auch beim Entfernen), unpassende Rolle abgewiesen, `userId` muss UUID sein.

---

## Findings

### F1 – [Major] Filterwechsel im Log ändert die URL, aber nicht die Liste

- **Wo:** `src/components/audit/AuditLogList.tsx:49-57`, `src/app/(app)/log/page.tsx:33-39`
- **Beobachtet:** `AuditLogList` hält `entries`, `names` und `cursor` in `useState`, jeweils
  aus den Props der **ersten** Serverantwort initialisiert. `applyFilters` macht nur
  `router.push('/log?…')`. Da die Route dieselbe bleibt und die Komponente an derselben
  Stelle im Baum mit demselben Typ gerendert wird, bleibt sie montiert: React übernimmt die
  neuen Props (`filters` — das Dropdown springt also um), verwirft aber die neuen
  `initialEntries`/`initialCursor`. Die Seite zeigt danach den **ungefilterten** Stand unter
  einer Filterbeschriftung. Anschließendes „Mehr laden" schickt den alten Cursor mit den
  neuen Filtern (`loadMore` liest `filters` aus den Props, `cursor` aus dem State) — die
  angehängte Seite passt dann nicht zur angezeigten.
- **Erwartet:** Nach dem Setzen eines Filters zeigt die Liste genau die gefilterte erste
  Seite (WP8 Schritt 3: „Filter: Session, Nutzer, Tabelle"). Der Weg über den Link
  „Log dieser Session" aus der Session-Detailseite ist nicht betroffen (Routenwechsel →
  Neuaufbau), der Filterwechsel **innerhalb** von `/log` schon.
- **Reproduktion:** `/log` öffnen (mindestens zwei verschiedene Bereiche im Log), im
  Dropdown „Bereich" `Einträge` wählen. Erwartet: nur Einträge-Zeilen. Beobachtet (statisch
  abgeleitet): dieselbe Liste wie vorher, URL aber `?table=entries`. Gegenprobe: dieselbe
  URL neu laden (F5) → korrekt gefiltert. Genau diese Differenz zwischen „per Dropdown" und
  „neu geladen" ist der Nachweis.
- **Vorschlag:** in `log/page.tsx` ein `key` aus den aktiven Filtern an `AuditLogList` geben
  (z. B. `key={auditFiltersToQuery(filters)}`), dann baut React die Liste bei jedem
  Filterwechsel neu auf. Alternativ die drei State-Werte per Effekt an die Props angleichen.
- **Anmerkung zur Ehrlichkeit:** statisch abgeleitet, nicht im Browser gesehen (ich starte
  keinen Dev-Server). Der Planer bestätigt es in zehn Sekunden (Punkt 4 unten). Sollte
  Next 16 hier wider Erwarten neu montieren, fällt das Finding ersatzlos weg.

### F2 – [Minor] Der Pagination-Cursor wird nicht als Zeitstempel validiert

- **Wo:** `src/lib/validation/audit.ts:26` (`at: z.string().min(1).max(64)`),
  `src/lib/audit/cursor.ts:22`
- **Beobachtet:** `loadAuditPage` ist ein öffentlicher Endpunkt. Der Wert `cursor.at` wird
  nur als „irgendein String bis 64 Zeichen" geprüft und danach unverändert in den
  PostgREST-Ausdruck `at.lt.<at>,and(at.eq.<at>,id.lt.<id>)` eingesetzt. Ein selbstgebauter
  Aufruf mit `at = "2026-01-01,id.gte.0"` schreibt zusätzliche Bedingungen in den
  `or()`-Ausdruck; ein `at = "abc"` erzeugt einen Cast-Fehler in Postgres.
- **Warum nur Minor:** Kein Datenleck und kein Rechtebruch. Der eingeschleuste Text landet
  **innerhalb** des `or()`-Terms, die Filter `session_id`/`user_id`/`table_name` bleiben als
  eigene AND-Bedingungen bestehen, und `audit_log` ist ohnehin für jeden eingeloggten Nutzer
  vollständig lesbar (SPEC §4, RLS `audit_log_select`). Schlimmster Fall: der Angreifer
  sieht Zeilen, die er auch ohne Cursor sehen darf, oder er provoziert bei sich selbst eine
  Fehlermeldung. Trotzdem gehört ein Wert, der roh in eine Query geht, validiert — der
  Testauftrag verlangt ausdrücklich „kein Open-Injection in Query".
- **Erwartet:** `at` gegen ein ISO-Zeitstempel-Muster prüfen (z. B.
  `z.string().datetime({ offset: true })` bzw. eigenes Regex) oder den Cursor signiert /
  als reine `id` + Zeitstempel aus der DB gegenprüfen.
- **Reproduktion:** Server Action `loadAuditPage({ filters: {…}, cursor: { at: "x,id.gte.0",
  id: 1 } })` aufrufen; die Payload passiert `auditPageSchema` (in meinem Test dokumentiert,
  dort bewusst nicht rot gestellt, damit die Suite grün bleibt).

### F3 – [Minor] `settings` mit unbekannter Aktion liefert keinen generischen Text

- **Wo:** `src/lib/audit/describe.ts:323-335`
- **Beobachtet:** `describeSetting` behandelt nur `DELETE` gesondert; jede andere Aktion —
  auch eine, die die Funktion nicht kennt — endet bei „hat die Schnellbeträge auf … gesetzt".
  Für `tableName='settings', action='TRUNCATE'` steht damit eine Aussage auf dem Schirm, die
  so nicht stattgefunden hat. Alle anderen Tabellen fallen in diesem Fall korrekt auf
  `generic(entry)` zurück.
- **Erwartet:** Wie überall sonst: unbekannte Aktion → generischer Text (WP8 Testauftrag:
  „unbekannte Fälle liefern generischen Text").
- **Warum Minor:** Der Trigger in 0002 feuert ausschließlich `INSERT`/`UPDATE`/`DELETE`, der
  Fall kann heute nicht entstehen. Es ist eine Lücke in genau der Schutzschicht, die
  `describe.ts` sonst konsequent zieht.
- **Reproduktion:** `describeAuditEntry({ tableName: 'settings', action: 'TRUNCATE',
  newData: { key: 'quick_amounts_cents', value: [5000] } })`.

### F4 – [Minor] Whitelist-Änderungen stehen in keinem Log — Bewertung

- **Wo:** `supabase/migrations/0002_functions_triggers.sql:367-399` (kein Trigger auf
  `role_whitelist`), Siris Übergabe „Vorschläge"
- **Bewertung gegen SPEC:** **Kein Spezifikationsbruch.** SPEC §4 zählt die zu
  protokollierenden Tabellen ausdrücklich auf: „Sessions, Teilnehmern, Einträgen, Spielern,
  Nutzerrollen, Einstellungen" — `role_whitelist` ist nicht darunter, und das Wort
  „lückenlos" steht in SPEC §3 über die **Erfasser-Angaben**, nicht über den Tabellenumfang.
  Siris Annahme ist also richtig, und es ist kein Regressionsfehler aus WP8.
- **Trotzdem ein Hinweis:** Wer wann wem per Whitelist vorab Admin- oder Bearbeiterrechte
  zugeschanzt hat, ist damit nirgends nachvollziehbar. Das ist der einzige Weg, auf dem ein
  Konto Rechte bekommt, **ohne** dass eine Zeile im Log entsteht (`app_users`-INSERT beim
  ersten Login zeigt nur die Rolle, nicht wer sie hinterlegt hat). Wenn es um echtes Geld
  geht, würde ich einen `audit_row_change('email')`-Trigger auf `role_whitelist` in einer
  späteren Migration empfehlen — **Entscheidung des Planers**, weil es das WP1-Schema
  berührt und außerhalb von WP8 liegt.

---

## Angriffe, die ich gefahren habe und die halten

| Angriff | Ergebnis |
|---|---|
| `/admin` als Editor/Viewer direkt aufrufen | „Kein Zugriff", **keine** Admin-Abfrage (Rollenprüfung steht vor `getAdminData()`); zusätzlich RLS: `role_whitelist` liest für Nicht-Admins leer |
| `setUserRole` mit fremder `userId` als Viewer | `requireAdmin()` → „Das darf nur ein Admin."; selbst ohne den Wächter: RLS `app_users_update` + `is_admin()` |
| `setUserRole` mit zusätzlichen Feldern (`email`, `display_name`) | zod verwirft sie; die Action schreibt ausschließlich `{ role }`; Trigger `protect_app_user_columns` → `ONLY_ROLE_EDITABLE` |
| Letzten Admin degradieren | Trigger `LAST_ADMIN` → deutscher Satz, Dropdown springt zurück |
| Schnellbeträge `[]`, `[0]`, `[-100]`, `[100.5]`, 7 Werte, Dubletten, `"5000"` | alle abgewiesen; gespeichert wird immer aufsteigend sortiert |
| Whitelist mit `„  Ali@Example.COM "` | normalisiert zu `ali@example.com` (0001 prüft `email = lower(email)`) |
| Log-Filter `?table=role_whitelist`, `?session=1' or '1'='1`, `?user=id.gte.0`, `?table=entries)or(true`, Array-Parameter | alle verworfen → `NO_AUDIT_FILTERS` |
| Kaputte/fehlende `old_data`/`new_data` (feste Fälle + 500 Zufallsläufe) | nie ein Absturz, immer ein Satz; `safeJson` fängt auch nicht serialisierbare Rohdaten ab |
| Roher Postgres-Text Richtung Browser | `mapAdminError` übersetzt bekannte Codes und loggt alles andere generisch |
| Schreibpfad im Log | `audit_log` hat für `authenticated` nur `select` (0003:51), die Sequenz ist entzogen; `loadAuditPage`/`auditLog.ts` enthalten keine Schreiboperation |

---

## Was der Planer im Browser prüfen soll

1. **Admin-Schutz.** Als Editor und als Viewer `/admin` direkt aufrufen → „Kein Zugriff";
   im Netzwerk-Tab darf in der Antwort **keine** Whitelist-Adresse und keine Nutzerliste
   auftauchen. Admin-Tab ist bei diesen Rollen auch nicht in der Tab-Leiste.
2. **Letzter Admin.** Eigenes Konto (einziger Admin) auf „Bearbeiter" stellen → Toast
   „Der letzte Admin kann nicht degradiert werden. …", Dropdown springt zurück,
   `app_users` unverändert.
3. **Rolle wirkt sofort (DoD).** Zweites Konto in einem anderen Browser auf „Bearbeiter"
   setzen; dort **ohne neuen Login** die Seite neu laden → Schreib-Buttons erscheinen.
   Danach zurück auf „Betrachter" → nach dem Neuladen sind sie weg.
4. **F1 – der entscheidende Punkt.** `/log` öffnen, im Dropdown „Bereich" `Einträge` wählen.
   Zeigt die Liste danach andere Zeilen als vorher? Zur Kontrolle dieselbe URL mit F5 neu
   laden und beide Listen vergleichen. Sind sie verschieden, ist F1 bestätigt.
5. **Pagination.** Mit mehr als 50 Zeilen im Log: „Mehr laden" → hängt an, keine Zeile
   doppelt, keine fehlt (besonders an der Grenze zwischen zwei Zeilen aus **einer**
   Transaktion, z. B. Abschluss = `sessions`-UPDATE + `settlements`-INSERT).
6. **Gelöschter Eintrag.** In einer offenen Session einen Buy-in löschen → im Log
   „hat Buy-in 100,00 € bar für Ali gelöscht", Rohdaten aufklappbar mit den alten Werten.
7. **Schnellbeträge.** Chip entfernen, `25` hinzufügen, speichern → Buy-in-Sheet einer
   offenen Session zeigt die neuen Buttons (Reihenfolge aufsteigend). Grenzen: 7. Betrag,
   Duplikat, letzten Chip entfernen — jeweils Meldung, kein Speichern.
8. **Log dieser Session.** Aus einer Session-Detailseite auf „Log dieser Session" →
   `/log?session=…`, nur Zeilen dieser Session, Session-Dropdown vorbelegt.
9. **Mobile 375 px.** `/log` und `/admin`: kein horizontales Scrollen, Rohdaten-`<pre>` darf
   intern scrollen, alle Tipp-Ziele ≥ 44 px, Rollen-Dropdown mit dem Daumen bedienbar.
10. **WP6-F3.** Session mit Differenz abschließen → Block 1 „Summe" = Kassenstand, darunter
    „Bleibt in der Kasse: … (Differenz)"; „Abrechnung kopieren" zeigt dieselbe Summe.

---

## Nicht verifiziert

- **Kein Browser, kein Login.** Alles zur Darstellung, zu Toasts, zum Dropdown-Verhalten und
  zum Mobile-Layout ist Code-Review bzw. statische Ableitung. Das betrifft ausdrücklich auch
  **F1** (siehe Anmerkung dort) und den DoD-Punkt „Rolle ändern wirkt sofort", der logisch
  über `React.cache` belegt, aber nicht ausgeführt ist.
- **Keine Ausführung gegen die Datenbank mit Login.** `protect_last_admin`,
  `protect_app_user_columns` und der Audit-Trigger sind als SQL gelesen und in TypeScript
  nachgebildet, nicht live ausgelöst. `npm run rls:smoke` beweist nur die Kehrseite: ohne
  Login kommt niemand an `audit_log`, `settings` oder `role_whitelist`.
- **Echtes PostgREST-Verhalten bei F2.** Dass der eingeschleuste Cursor-Text tatsächlich als
  zusätzliche `or`-Bedingung ankommt (und nicht schon vorher als Fehler abprallt), ist aus
  dem Aufbau von `supabase-js` abgeleitet, nicht gegen den Server ausprobiert. An der
  Bewertung („validieren, aber kein Leck") ändert das nichts.
- **Log-Zählung je Nutzer** (`getAdminData`, eine `head`-Count-Abfrage pro Konto) ist nur
  gelesen; bei vielen Konten ist das langsam, war aber Siris bewusste, dokumentierte
  Entscheidung und ist kein Finding.
- **Realtime** spielt in WP8 keine Rolle; es gibt in diesem Paket keinen Channel
  (`AuditLogList` abonniert nichts, also auch kein Leck).
