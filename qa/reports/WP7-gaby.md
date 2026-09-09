# WP7 – Prüfbericht Gaby

**Urteil: FREIGEGEBEN** (mit Hinweisen; 0 Blocker, 0 Major, 6 Minor)

Geprüfter Stand: `642446e` („WP7: player overview and detail“, Merge `4a6c538`) auf `main`.
Das Verzeichnis `.claude/worktrees/` (paralleles WP8) wurde vollständig ignoriert.

## Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `npm run check` (typecheck + lint + test), Stand Siri | **grün** – 39 Dateien, 808 Tests, 1,42 s |
| `npm run build` | **grün** – Routen `/players` und `/players/[id]` werden gebaut (ƒ dynamisch) |
| `npm run rls:smoke` | **grün** – 29 Prüfungen, 29 beweisbar geblockt, 0 Lecks (deckt nur Tabellen ab, keine Views – siehe F2) |
| `npx vitest run tests/gaby/wp7-players.gaby.test.ts` | **grün** – 38 neue Fälle |
| `npm run check` (mit meinen Tests) | **grün** – 40 Dateien, **846 Tests**, 1,38 s |

Eigene Tests: `tests/gaby/wp7-players.gaby.test.ts` (38 Fälle, 5 Blöcke)

1. **View-SQL streng**: `security_invoker = true` und *kein* `security_definer`; genau **ein**
   `grant`, nur `select`, nur an `authenticated`, nicht an `anon`/`public`; `from public.players p`
   mit zwei `left join`, kein `inner join` auf oberster Ebene; jede Kennzahl `coalesce(…)::int`;
   der **Geldblock** (nur der Teilbaum zwischen `settlement_lines` und dem Join-Ende, ohne
   Kommentare) enthält `where s.status = 'closed'`, die drei Summen und **kein** `payout_cents`;
   `public.entries` kommt im ganzen SQL nicht vor (nie neu gerechnet); kein `numeric`/`float`/
   `avg`/Division auf `*_cents`; `count(*) filter (where s.status = 'open')`; kein Schreibbefehl;
   `last_played_on` stammt aus `session_players`, nicht aus `settlement_lines`.
2. **Konsistenz mit echtem Algorithmus**: Fixture-Abende werden nicht von Hand gefüllt, sondern
   durch `computeSettlement` abgeschlossen (TV2-artig sauber, TV9-artig −20,00 €, +5,00 €,
   TV8-artige Cent-Rundung). Eigener, von Siri unabhängiger Nachbau der View-Aggregation prüft:
   je Spieler `net = Stack − Buy-in`, Handrechnung je Spieler (Ali +145,00 €, Bea −60,00 €,
   Cem −100,00 €, Dana 0), Spieler ohne Abend bleibt mit 0 drin, offene Abende ändern nichts,
   und **Σ net_cents aller Spieler = Σ discrepancy aller abgeschlossenen Sessions = −15,00 €**
   (bei nur sauberen Abenden 0).
3. **`getPlayerDetail` gegen gefälschten Supabase-Client**: genau 5 Queries bei 12 Abenden
   (kein N+1, Reihenfolge `player_stats`→`session_players`→`sessions`→`settlement_lines`→
   `entries`, `sessions`/`entries` gebündelt per `in`), 2 Queries ohne Teilnahme; abgeschlossener
   Abend zeigt **exakt die gespeicherte Zeile**, auch wenn ich `net_result_cents` im Fixture
   absichtlich inkonsistent setze (also keine Neuberechnung); offener Abend aus `entries` mit
   `payout` ignoriert und `netCents = null`; Fehler in **jeder** der vier Teil-Queries ergibt
   `{ ok: false, reason: 'error' }`, unbekannter Spieler `not_found`; Sortierung
   `played_on desc` steckt in der Query.
   `listPlayerStats`: genau **eine** Query; fehlende View („relation does not exist“) ergibt
   `{ ok:false }`, nie eine leere Liste.
4. **Sortierung/Suche**: alle fünf Spalten × beide Richtungen gegen Handrechnung, Tie-Break
   stabil (auch bei umgekehrter Eingabe), Eingabe unverändert, Tap-Verhalten; Property-Tests
   (fast-check, je 200 Läufe): Sortierung ist Permutation, deterministisch und monoton; Suche
   liefert immer eine Teilmenge und erfindet nie einen Spieler; Trim/Groß-Klein/Diakritika
   (`muller`→Müller, `jose`/`josé`→José).
5. **Statische UI-Zusagen**: kein `parseFloat`/`toFixed`/`/100`/`Number(` in den WP7-Dateien,
   `tabular-nums` + `text-right` in Übersicht, Detail und `NetAmount`, ≥ 2 × `min-h-[44px]` und
   `w-11`, Fehlerhinweis-Zweige in `/players`, `/players/[id]` und `/`, `PlayersManager` ist
   `'use client'` **ohne** `.from(`/`.rpc(`, interaktive Teilnehmer-Karte behält
   `onClick={onPrimary}` (Buy-in) und bekommt den Spieler-Link nur im Aktions-Sheet.

Handrechnungen (Auszug, gegen den Testcode geprüft):

* s1 (sauber): Ali 250,00 − 100,00 = **+150,00**; Bea 50,00 − 100,00 = **−50,00**;
  Cem 0 − 100,00 = **−100,00** → Σ = 0 = `discrepancy`.
* s2 (fehlend): Ali 90,00 − 100,00 = −10,00; Bea −10,00 → Σ = **−20,00** = `discrepancy`.
* s3 (zu viel): Ali 55,00 − 50,00 = +5,00; Cem 0 → Σ = **+5,00**.
* Gesamt über alle Spieler: +145,00 − 60,00 − 100,00 + 0 = **−15,00** = 0 − 20,00 + 5,00. ✔
* Siris Fixture in `src/lib/players/stats.test.ts` habe ich Zeile für Zeile nachgerechnet
  (0/0 bzw. 0/−20,00/+5,00 → −15,00): **korrekt**.

`tests/gaby/**` ist von Siri unangetastet (`git diff 642446e~1 642446e -- tests/` ist leer).

## DoD-Abgleich

| DoD-Punkt | Status | Anmerkung |
|---|---|---|
| View `player_stats` (SPEC §7 „Spieler-Übersicht“), `security_invoker`, Migration | ✔ (statisch) | `0007_player_stats.sql`; Nummer 0007 statt 0006 vom Planer vorgegeben und im Kopf vermerkt. Live nicht prüfbar, siehe „Nicht verifiziert“ |
| Nur `closed`-Sessions zählen | ✔ | Geld/Zähler ausschließlich aus `settlement_lines` mit `join sessions … where s.status='closed'`; `entries` kommt im SQL nicht vor |
| Spieler ohne Sessions erscheinen mit 0 | ✔ | `left join` ab `players`, `coalesce(…,0)::int`, `last_played_on = null`; UI zeigt „–“ statt 0,00 € |
| `security_invoker = true`, Grant nur `authenticated` | ✔ | genau ein `grant select … to authenticated`, kein `anon`, kein `public`, kein `security_definer` |
| `open_sessions` korrekt | ✔ | `count(*) filter (where s.status='open')` aus `session_players` |
| `last_played_on` korrekt | ⚠ | zählt auch offene Abende – fachlich vertretbar, aber Planerentscheidung offen (F1) |
| Zahlen der Übersicht = Σ Session-Ergebnisse (Fixture) | ✔ (Logikebene) | eigener Fixture-Test mit `computeSettlement`; Gegenprobe an echten Daten steht aus (DB) |
| Σ net_cents = Σ discrepancy_cents | ✔ | eigener Test + Siris Test, beide handnachgerechnet |
| Sortierung Default Bilanz absteigend, alle Spalten, stabil | ✔ | `DEFAULT_SORT = {net,desc}`, fünf Spalten, Tie-Break über Namen, Property-Tests |
| Suche (Trim, Groß/Klein, Umlaute) | ✔ | `normalizeName` faltet Trim/Case/Diakritika; „ß“ nicht (F3) |
| Zahlen rechtsbündig/`tabular-nums`, Tippziele ≥ 44 px | ✔ (Code) | Sortierköpfe und Suchfeld `min-h-[44px]`, Karten 64 px, Umbenennen `w-11` in voller Kartenhöhe; Zurück-Link kleiner (F6). Optik am Gerät: Planer |
| Feste Query-Anzahl, kein N+1 | ✔ | 1 Query Übersicht, ≤ 5 Detail – mit Mock-Client gemessen |
| Kein `.from(` in Client-Komponenten | ✔ | WP2-Snapshot-Test grün, zusätzlich eigener Test für `PlayersManager` |
| `QueryResult` statt stillem `[]` (WP5 F6) | ✔ | `listPlayers`, `listPlayerStats`, `getPlayerDetail`, **und** `listSessions`; sichtbarer Hinweis auf `/`, `/players`, `/players/[id]` und im „Teilnehmer hinzufügen“-Sheet |
| Link Teilnehmer-Karte → Spieler, Buy-in bleibt bei 3 Tipps | ✔ | interaktive Karte: Tap = Buy-in unverändert, Link im „⋯“-Sheet; nicht-interaktive Karte ist selbst der Link |
| Geld = Integer-Cent, kein `any`, Lint sauber, UI Deutsch | ✔ | keine Float-Operation in SQL oder WP7-UI; `npm run check` grün |
| `npm run check` + `npm run build` grün | ✔ | siehe oben, auch mit meinen 38 zusätzlichen Tests |
| `tests/gaby/**` unangetastet | ✔ | leerer Diff |

## Findings

### F1 – [Minor] `last_played_on` zählt auch offene Abende (Siris offene Frage 1)
- Wo: `supabase/migrations/0007_player_stats.sql:73` (`max(s.played_on) as last_played_on` im
  Teilnahme-Unterselect, ohne Statusfilter)
- Beobachtet: „Zuletzt gespielt“ auf der Detailseite springt bereits auf das Datum eines noch
  laufenden Abends, während `sessions_played`, Buy-ins, Stacks und Bilanz erst beim Abschluss
  reagieren. Zwei Spalten derselben Karte beziehen sich damit auf unterschiedliche Mengen.
- Erwartet: `docs/SPEC.md` §7 („Ansichten“, Zeilen „Spieler-Übersicht“/„Spieler-Detail“) nennt
  „zuletzt gespielt“ überhaupt nicht, WP7 Schritt 1 nennt `last_played_on` ohne Definition – es liegt **kein** SPEC-Bruch vor. Siris Begründung („wann saß er zuletzt am
  Tisch“) ist die für den Nutzer plausiblere Lesart; der Widerspruch ist erklärungsbedürftig,
  nicht falsch. Entscheidung des Planers, danach ein Satz in `docs/SPEC.md`.
- Reproduktion: Spieler in eine offene Session aufnehmen → Detailseite zeigt heutiges Datum bei
  „Zuletzt gespielt“, aber „Noch kein abgeschlossener Abend.“ bzw. die alte Bilanz.
- Mein Test friert dieses Verhalten **nicht** ein (er prüft nur, dass das Datum aus der
  Teilnahme und nicht aus der Abrechnung kommt) – eine Änderung bricht keine Gaby-Tests.

### F2 – [Minor] `rls:smoke` deckt keine Views ab
- Wo: `scripts/rls-smoke.ts:211` (`for (const table of TABLE_NAMES)`),
  `src/lib/database.types.ts:659` (`TABLE_NAMES` enthält nur Tabellen)
- Beobachtet: Der Anon-Smoke-Test prüft 11 Tabellen und 7 RPCs, aber weder `session_overview`
  (WP4) noch `player_stats` (WP7). Ein versehentliches `grant select … to anon` auf einer View
  bliebe unbemerkt – Views tragen keine eigene RLS, nur das Grant und `security_invoker`
  schützen sie.
- Erwartet: Der Anon-Beweis soll jede über PostgREST erreichbare Relation abdecken
  (WP1-Testauftrag „ohne Login ist nichts lesbar“). Vorschlag: `VIEW_NAMES` analog zu
  `TABLE_NAMES` und im Skript nur `select` prüfen. Bestand schon vor WP7 (seit WP4), deshalb
  Minor und kein WP7-Vorwurf.
- Reproduktion: `npm run rls:smoke` – in der Ausgabe kommt weder `session_overview` noch
  `player_stats` vor.
- Ersatzweise habe ich das Grant statisch geprüft (genau ein `grant`, nur `authenticated`);
  den Live-Gegenbeweis bitte einmal manuell führen (siehe „Für den Planer“, Punkt 2).

### F3 – [Minor] Suche faltet „ß“ nicht
- Wo: `src/lib/players/stats.ts:64` (`normalizeName`)
- Beobachtet: `normalizeName('Straße') === 'straße'`, `normalizeName('Strasse') === 'strasse'` –
  die Eingabe „strasse“ findet den Spieler „Straße“ nicht (und umgekehrt). Diakritika werden
  korrekt gefaltet, „ß“ ist aber keine Kombination aus Basiszeichen + Diakritikum.
- Erwartet: WP7 DoD verlangt nur „Suche funktioniert“; Umlautfaltung ist bereits über der
  Anforderung. Für deutsche Namen wäre `.replace(/ß/g,'ss')` vor dem NFD-Schritt konsequent.
- Reproduktion: Spieler „Straßer“ anlegen, im Suchfeld „strasser“ tippen → kein Treffer.

### F4 – [Minor] Spieler ohne abgeschlossenen Abend sortieren als 0,00 €
- Wo: `src/components/players/PlayersManager.tsx:256` (`played={player.sessionsPlayed > 0}`),
  `src/lib/players/stats.ts:110` (`sortPlayers`)
- Beobachtet: Die Bilanz wird richtigerweise als „–“ angezeigt, sortiert aber mit `netCents = 0`
  mitten zwischen Gewinnern und Verlierern.
- Erwartet: Kein Datenfehler – die Anzeige stimmt, nur die Reihenfolge suggeriert ein Ergebnis.
  Vorschlag für WP9: Spieler ohne Abend bei Bilanz-Sortierung ans Ende.
- Reproduktion: Neuen Spieler anlegen, Übersicht in der Default-Sortierung ansehen.

### F5 – [Minor] Spieler-Detail zeigt `payout` nicht
- Wo: `src/app/(app)/players/[id]/page.tsx:146-155` (nur Buy-ins und Stack),
  `src/lib/queries/players.ts:38-52` (`PlayerSessionRow` führt kein `payout`)
- Beobachtet: Die Session-Detailseite schreibt „· bar erhalten 120,00 €“ auf die
  Teilnehmer-Karte, die Spieler-Detailseite nicht. Wer während des Abends Bargeld aus der Kasse
  genommen hat, sieht das auf seiner Seite nicht.
- Erwartet: WP7 Schritt 3 verlangt „Datum, Buy-ins bar/Liste, Stack, Ergebnis“ – `payout` ist
  **nicht** gefordert, das Geld ist auch ohne ihn korrekt (er verändert `netResult` nicht).
  Reine Informationslücke gegenüber der Session-Ansicht; Vorschlag für WP9.
- Reproduktion: Session mit Payout abschließen, Spieler-Detailseite öffnen.

### F6 – [Minor] Zurück-Link „← Alle Spieler“ unter 44 px
- Wo: `src/app/(app)/players/[id]/page.tsx:47`
- Beobachtet: `text-sm` ohne Mindesthöhe/Padding – Tippziel ca. 20 px hoch, während WP7/WP9 für
  alles andere 44 px vorgibt (Sortierköpfe, Suchfeld, Karten sind sauber).
- Erwartet: ≥ 44 px Tippziel (Konvention „mobil bedienbar“, WP9 Schritt 5).
- Reproduktion: `/players/<id>` im 375-px-Viewport, oben links.

## Für den Planer (Browser / DB, nach dem Einspielen von `0007`)

1. `supabase/migrations/0007_player_stats.sql` im SQL-Editor einspielen. **Solange das nicht
   passiert ist, zeigen `/players` und `/players/[id]` nur den Fehlerhinweis** – korrektes
   Verhalten, aber die Seite ist bis dahin ohne Funktion (auch Anlegen/Umbenennen aus WP4).
2. Anon-Gegenprobe für die Views (F2), ausgeloggt bzw. mit dem Publishable Key:
   `GET <URL>/rest/v1/player_stats?select=*` muss `401/permission denied` liefern, nicht `[]`
   mit Daten. Gleiches für `session_overview`.
3. Zahlenabgleich an echten Daten: für einen Spieler die Spalte „Ergebnis“ seiner
   abgeschlossenen Sessions addieren = Bilanz in der Übersicht. Und über alle Spieler:
   `select sum(net_cents) from player_stats;` muss gleich
   `select coalesce(sum(discrepancy_cents),0) from settlements;` sein.
4. Sortierung/Suche am Handy (375 px): Default Bilanz ↓, Tap auf „Name“ → A→Z, nochmal → Z→A;
   die Sortierleiste scrollt horizontal – prüfen, ob „Bilanz“ ohne Suchen erreichbar ist.
5. Drei-Tipp-Buy-in in einer offenen Session als Editor: Tap auf Teilnehmer-Karte muss weiterhin
   direkt das Buy-in-Sheet öffnen; der Spieler-Link liegt hinter „⋯“.
6. Wieder öffnen (Admin): Abend verschwindet aus Zähler und Bilanz, erscheint im Detail als
   „läuft“; erneut abschließen → wieder da.

## Bewertung der drei offenen Fragen Siris

1. **`last_played_on`** – siehe F1. Kein SPEC-Bruch, Siris Variante ist die nutzernähere;
   ich empfehle, sie zu behalten und in `docs/SPEC.md` einen Satz zu ergänzen („zuletzt am Tisch
   gesessen, offene Abende zählen mit“). Falls anders gewünscht: Statusfilter im
   Teilnahme-Unterselect, eine Zeile, kein Gaby-Test bricht.
2. **Umbenannte Spieler in eingefrorenen Abrechnungen** – Siri hat nichts eingefroren, und das
   ist richtig: `settlement_lines` speichert `player_id`, der Name kommt aus `players`. Ein
   Namensarchiv in der Abrechnung wäre eine SPEC-Änderung und würde Übersicht (aktueller Name)
   und alte Abrechnung (alter Name) auseinanderlaufen lassen – schlechter für „echtes Geld
   zwischen Freunden“. Empfehlung: so lassen, einen Satz dazu in `docs/SPEC.md` §7 aufnehmen.
   Kein Finding.
3. **Gelöschte Spieler** – korrekt beobachtet, aber heute rein theoretisch: es gibt **keine**
   Server Action `deletePlayer` (`src/actions/players.ts` enthält nur `createPlayer`/
   `renamePlayer`), also keinen UI-Weg. Wenn WP8 einen Weg anbietet, muss er den
   Fremdschlüsselfehler `23503` auf eine deutsche Meldung abbilden („… hat schon gespielt und
   kann nicht gelöscht werden“) – und darf `settlement_lines` niemals per Cascade mitlöschen,
   das wäre nachträglich verändertes Geld. Kein Finding in WP7, Hinweis für WP8.

## Nicht verifiziert

- **Die View selbst läuft nirgends.** `0007` ist in der Datenbank nicht eingespielt; alle
  Aussagen zu `player_stats` (Werte, RLS-Wirkung, `security_invoker`, PostgREST-Exposition,
  Verhalten bei `count(*) filter`) sind **statische SQL-Prüfungen**, keine Ausführung. Ein
  Tippfehler in einem Spaltennamen wäre gefunden, ein Planner-/Semantikfehler nicht.
- **Keine echten Daten.** Der DoD-Punkt „Zahlen der Übersicht = Summe der Session-Ergebnisse“ ist
  auf Fixture-/Query-Ebene bewiesen, nicht an der produktiven Datenbank (Punkt 3 oben).
- **Kein Browser.** Lesbarkeit auf 375 px, horizontales Scrollen der Sortierleiste, echte
  Tippziele, Farben in Dark Mode, Navigation Karte → Spieler → Session sind nicht geprüft.
- **Realtime**: WP7 fügt keine Kanäle hinzu; ein Leck kann daher nicht entstanden sein, geprüft
  wurde es nicht.
- **Rollen live**: dass ein Viewer auf `/players` weder Anlegen- noch Umbenennen-Ziele sieht,
  ist nur im Code geprüft (`canEdit(user.role)`), nicht mit zwei Konten.
