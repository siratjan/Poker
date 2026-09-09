# WP5 – Übergabe Siri

## Umgesetzt

**Server Actions**

- `src/actions/entries.ts` – alle acht Actions des Plans: `addParticipant`,
  `addParticipantByNewPlayer`, `removeParticipant`, `addBuyIn`, `addCashOut`,
  `updateCashOut`, `addPayout`, `deleteEntry`. Jede beginnt mit `requireEditor()`,
  danach zod (`parseInput`), erst dann `createClient()`. Alle Trigger-Codes werden
  über `translateDbError` in deutsche Meldungen übersetzt.
- `session_players.position` hat in `0001` keinen Default → die Action vergibt
  „höchste Position + 1“ und wiederholt bei Kollision auf `unique (session_id, position)`
  bis zu dreimal; eine Kollision auf dem Primärschlüssel bedeutet dagegen
  „Spieler ist schon dabei“ (`PLAYER_ALREADY_IN_SESSION`).
- `updateCashOut` filtert zusätzlich auf `type = 'cash_out'`, `deleteEntry` auf
  `session_id` – eine falsche Id kann so nie einen fremden Eintrag treffen.

**Fehlermeldungen**

- `src/lib/errors/de.ts` – Tabelle `DB_ERROR_MESSAGES` mit **allen 22** Codes, die
  `supabase/migrations/0002_functions_triggers.sql` wirft (inkl. der WP6-Codes
  `MISSING_CASH_OUT`, `SETTLEMENT_MISMATCH`, `SETTLEMENT_INVARIANT`,
  `DISCREPANCY_REQUIRES_ADMIN_NOTE`, `REASON_REQUIRED`, `SESSION_NOT_CLOSED`), dazu
  SQLSTATE-Mapping für `42501`, `23505`, `23503`, `23514`. Unbekannte Fehler geben
  `null` zurück → `actionResult` loggt und antwortet generisch, roher Postgres-Text
  erreicht den Browser nie.
- `src/lib/errors/de.test.ts` liest die Migration und schlägt fehl, sobald ein neuer
  Trigger-Code ohne Übersetzung dazukommt.

**Reine Logik (getestet)**

- `src/lib/session/derive.ts` – `deriveParticipants`, `deriveTotals`, `deriveSession`,
  `previewParticipants`, `previewCashEntitlement`, `sortEntriesNewestFirst`.
- `src/lib/session/labels.ts` – deutsche Beschriftungen (Buy-in-Zeile, Stack-Zeile,
  Verlaufstext, Buy-in-Toast, Vorzeichen-Formatierung).
- `src/lib/session/amountInput.ts` – Betragseingabe: Cent aus Euro-String,
  deutscher Hinweistext, Obergrenze 1.000.000 Cent.
- Tests: `derive.test.ts` (35 Fälle), `labels.test.ts`, `amountInput.test.ts`,
  `de.test.ts`, `entries.test.ts`, ergänzte `time.test.ts`.

**Daten laden**

- `src/lib/queries/sessionDetail.ts` – Session, Teilnehmer (+ Spielername), Einträge
  (+ Erfassername), Settlement-Flag, Schnellbeträge aus `settings`. Feste Anzahl
  Queries mit `in (…)`-Sammelabfragen, kein N+1.
- Gaby-WP4-**F1** behoben (Session-Detail-Pfad): Rückgabe ist
  `{ ok: true, data } | { ok: false, reason: 'not_found' | 'error' }`; ein Query-Fehler
  wird nicht mehr als leere Liste getarnt.
- Gaby-WP4-**F2** behoben: `notFound()` nur bei `reason === 'not_found'`, ein
  Ladefehler zeigt einen eigenen Hinweis („bitte neu laden“).
- `getSessionHeader` in `src/lib/queries/sessions.ts` entfernt (durch
  `getSessionDetail` ersetzt, war nur von der WP4-Detailseite benutzt).

**UI**

- `src/app/(app)/sessions/[id]/page.tsx` (Server) + `SessionDetailClient.tsx`.
- Kopf: Datum, Name, Status-Badge, bei `closed` Abschlussinfo (Zeitpunkt, Person,
  Differenz, Kommentar). 2×2-Kacheln: Buy-ins gesamt · davon bar/Liste · Kasse
  aktuell · Stacks gezählt (x von n, darunter Differenz bzw. „n spielen noch“).
- `ParticipantCard.tsx`: Name, „100,00 € bar + 50,00 € Liste“, Stack oder „spielt
  noch“, Auszahlung, Plus/Minus farbig. Tipp auf die Karte = Buy-in-Sheet, solange
  der Spieler noch spielt (drei Tipps, siehe DoD); „⋯“ öffnet das Aktions-Sheet.
- `EntrySheets.tsx`: Aktions-, Buy-in-, Cash-out-, Auszahlungs-, Teilnehmer-
  und Bestätigungs-Sheet. Buy-in: Schnellbeträge als große Buttons, freies Feld,
  „Bar“/„Auf Liste“ sind die Bestätigungsbuttons (zuletzt genutzte Zahlungsart ist
  hervorgehoben). Auszahlung: Kasse, Stack und „Nach Bar-zuerst-Regel stünden … ca. X zu“
  über `computeSettlement` (Spieler ohne Stack werden mit ihrem Buy-in angenommen und
  der Hinweis als „vorläufig“ markiert).
- `HistoryList.tsx`: `21:14 · Ali · Buy-in 100,00 € bar · von Sirat`, neueste oben,
  Löschen mit Bestätigung (Editor+).
- `useSessionRealtime.ts`: ein Kanal je Session (`entries`, `session_players`,
  `sessions`, gefiltert), Cleanup bei Unmount/Id-Wechsel, genau ein automatischer
  Reconnect bei `CHANNEL_ERROR`/`TIMED_OUT`, nach 10 s Hinweis „Verbindung getrennt“
  mit Button „Neu laden“. Der Kanal liest nur (`channel()`), kein Tabellenzugriff aus
  einer Client-Komponente.
- Optimistic UI nur für Buy-in: die Karte zeigt den Betrag sofort („wird gespeichert …“),
  bei Fehler wird die Zeile entfernt und der Grund als Toast gezeigt.
- Rollen: Viewer sieht alles, aber keinen Aktionsbutton; bei `closed` ist für alle
  jede Aktion aus.
- `src/components/ui/Sheet.tsx`: fokussiert das Panel nur noch, wenn nicht schon ein
  Feld darin per `autoFocus` den Fokus hat (sonst öffnet sich auf dem Handy die
  Tastatur nicht).
- `src/lib/time.ts`: `formatBerlinTime`, `formatBerlinDateTime` (+ Tests).

## Abweichungen vom Plan

- **Karten-Tipp führt direkt zum Buy-in** (statt zuerst ins Aktions-Sheet), solange der
  Spieler noch keinen Stack hat. Sonst wären es vier Tipps bis zum Buy-in, die DoD
  verlangt drei. Das Aktions-Sheet des Plans bleibt über „⋯“ erreichbar und ist bei
  Spielern mit Stack die Primäraktion.
- **Verlauf neueste zuerst.** Der Plan sagt „chronologisch“; am Tisch ist der letzte
  Eintrag der interessante, und Löschen bezieht sich fast immer darauf.
- **Kein Abrechnungs-Block bei abgeschlossenen Sessions** – das ist WP6. Der Kopf sagt
  derzeit, dass die gespeicherte Abrechnung „mit dem nächsten Arbeitspaket“ erscheint;
  dieser Satz muss in WP6 durch die `SettlementView` ersetzt werden.
- **`getSessionHeader` entfernt** statt zusätzlich repariert (siehe oben).
- **F1 nur im Session-Detail-Pfad behoben.** `listSessions`/`listPlayers` (WP4-Startseite,
  Spielerliste) geben bei Fehler weiterhin `[]` zurück; das anzufassen wäre Scope-Creep.
  Vorschlag unten.

## Offene Fragen an den Planer

- Keine blockierenden. Eine Detailfrage: In der Auszahlungs-Vorschau werden Spieler ohne
  Stack mit ihrem Buy-in als Stack angenommen (Plan Schritt 4). Das ist die konservative
  Lesart „Nullrunde“, kein „aktueller Chipstand“ – die App kennt laufende Stacks nicht.
  Falls der Auftraggeber die Vorschau anders erwartet, bitte melden.

## Neue Abhängigkeiten

- Keine.

## Prüfung

- `npm run check` (typecheck + lint + test): **grün** – 30 Testdateien, 611 Tests (2026-09-09).
- `npm run build`: **grün** – Route `/sessions/[id]` weiterhin dynamisch.
- `npm run rls:smoke`: **nicht ausgeführt** – keine eingespielte DB.
- **Nicht live testbar:** Die Migrationen `0001`–`0006` sind nicht eingespielt
  (`session_overview` fehlt) und der Google-Provider ist nicht aktiv. Realtime,
  RLS-Verhalten, Trigger-Fehler und das Verhalten mit zwei Geräten konnten daher
  **nicht** gegen die echte Datenbank geprüft werden – nur Unit-Tests mit gemocktem
  Supabase-Client und Codeanalyse.

## So prüft man es

1. `npm ci`, `npm run check`, `npm run build`.
2. `npx vitest run src/lib/session src/lib/errors src/actions/entries.test.ts` – die
   Kernlogik dieses Pakets.
3. Fehlercode-Tabelle: `src/lib/errors/de.ts` gegen
   `grep -n "raise exception" supabase/migrations/0002_functions_triggers.sql` abgleichen;
   `de.test.ts` macht genau das automatisch.
4. Rollenprüfung: In `src/actions/entries.ts` steht `await requireEditor()` in jeder
   exportierten Action als erste Anweisung, vor `parseInput` und `createClient`.
   `entries.test.ts` prüft für alle acht Actions Viewer **und** ausgeloggt.
5. Realtime-Review: `src/components/sessions/useSessionRealtime.ts` – Effekt hängt nur
   an `sessionId` (kein neues Abo bei Re-Render), `removeChannel` im Cleanup, `retried`
   erlaubt genau einen Reconnect, `DISCONNECT_HINT_MS = 10_000`.
6. Kein Schreibzugriff aus dem Client: `grep -rn "\.from(\|\.rpc(" src/components` liefert
   nichts.
7. Browser (Planer, sobald DB und Google-Login stehen):
   - Session öffnen, Teilnehmer hinzufügen (bestehender Spieler + „Neuen Spieler anlegen“).
   - Buy-in in drei Tipps: Karte → Schnellbetrag → „Bar“. Toast „100,00 € bar für Ali
     eingetragen“, Karte sofort aktualisiert.
   - Zweiter Tab: neuer Eintrag erscheint ohne Neuladen innerhalb von ~2 s.
   - Aussteigen (Stack 0 erlauben), danach Buy-in versuchen → deutscher Toast
     „Dieser Spieler ist schon ausgestiegen …“.
   - Auszahlung größer als die Kasse → „So viel Bargeld ist nicht in der Kasse.“
   - Als Viewer: keine Buttons, keine „⋯“, kein Löschen im Verlauf.
   - 375 px: kein horizontales Scrollen, Tippziele ≥ 44 px.

## Vorschläge (außerhalb des Pakets)

- `listSessions`/`listPlayers` auf dasselbe `QueryResult`-Muster umstellen (Rest von
  Gabys F1), damit die Startseite einen Ladefehler nicht als „keine Sessions“ zeigt.
- WP6: den Platzhaltersatz im `ClosedNotice` durch die `SettlementView` ersetzen.
- WP8/WP9: der Verlauf könnte gelöschte Einträge aus dem Audit-Log einblenden
  („Ali · Buy-in 100 € · gelöscht von …“); heute sind sie nur im Log sichtbar.
- Ein „Alle ausgestiegen“-Fortschritt im Kopf (x von n) ist da; der Abschluss-Bereich
  darunter gehört bewusst zu WP6.
