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

## Nacharbeit Runde 2 (Gaby-Report `qa/reports/WP5-gaby.md`, F1–F4)

Der Planer hat F1–F4 zur sofortigen Behebung freigegeben; **F5 und F6 bleiben bewusst
offen** (F5 theoretisch, F6 gehört zu WP7).

- **F1 (Reconnect nach `CHANNEL_ERROR`)** – `useSessionRealtime.ts` neu aufgebaut. Die
  Kanal-Logik steckt jetzt in der exportierten, React-freien Funktion
  `subscribeToSession(supabase, sessionId, { onEvent, setStatus })`, die der Effekt nur
  noch aufruft und deren Rückgabe er als Cleanup zurückgibt. Bei `CHANNEL_ERROR` /
  `TIMED_OUT` wird nicht mehr `channel.subscribe()` ein zweites Mal gerufen (das ist mit
  `@supabase/realtime-js` 2.116 im Zustand `errored` ein No-op), sondern der kaputte Kanal
  über `supabase.removeChannel` entfernt und ein **neuer** Kanal mit allen drei Filtern und
  **mit Status-Callback** aufgebaut – dadurch springt der Status nach erfolgreichem Rejoin
  wieder auf `live` und der 10-s-Hinweis verschwindet. Weiterhin genau ein Versuch
  (`retried`), danach greift der Hinweis „Verbindung getrennt“. Ein Kanal wird über
  `takeActiveChannel()` höchstens einmal entfernt, ein doppeltes Abo ist damit
  ausgeschlossen; wirft der Client beim Reconnect, wird geloggt und der Hinweis übernimmt.
- **F2 (✕ bei optimistischen Einträgen)** – `HistoryList` bekommt `pendingIds`
  (`ReadonlySet<string>`, in `SessionDetailClient` aus den Pending-Buy-ins ohne `realId`).
  Für solche Zeilen ist das ✕ `disabled` (44 px bleiben, kein Layout-Sprung), die
  Zweitzeile sagt „wird gespeichert …“ und das `aria-label` ebenso; zusätzlich ignoriert
  der `onDelete`-Handler in `SessionDetailClient` pending-Ids. Ein
  `deleteEntry({ id: 'pending-…' })` kann so nicht mehr abgeschickt werden.
- **F3 (Tippziel Sheet-Kopf)** – Das ✕ in `src/components/ui/Sheet.tsx` ist von `size-9`
  (36 px) auf `size-11` (44 px) vergrößert. Übrige WP5-Tippziele nachgemessen: Karte
  72 px, „⋯“ 44 px, Verlauf-✕ 44 px, Schnellbeträge 56 px, Spielerzeile im
  Teilnehmer-Sheet 52 px, Suchfeld 44 px, `Button` md 44 px / lg 52 px – alle ≥ 44 px,
  weitere Änderungen waren nicht nötig.
- **F4 (Refresh nach Fehler)** – `run()` in `SessionDetailClient` ruft im Fehlerfall
  zusätzlich zum Toast `refresh()`; ebenso der Fehlerpfad des optimistischen Buy-ins und
  der Fall „kein Stack mehr vorhanden“ beim Stack-Ändern. Meldung und Anzeige passen damit
  wieder zusammen, wenn der Fehler von einer fremden Änderung kommt.

**Neue Tests:** `src/components/sessions/useSessionRealtime.test.ts` (9 Fälle) treibt
`subscribeToSession` mit einem gefälschten Kanal: ein Abo mit drei Filtern, `live` +
Weiterleitung der Events, Ersetzen des kaputten Kanals (alter entfernt, neuer mit
Callback), Rückkehr auf `live` ohne Hinweis, genau ein Retry und danach der Hinweis nach
exakt 10 s, Hinweis nur einmal, Teardown entfernt den aktiven Kanal und schweigt danach,
kein doppeltes Entfernen, Fehler beim Reconnect wird abgefangen.

**Prüfung Runde 2:** `npm run check` grün – 32 Dateien, 670 Tests (inkl. Gabys
`tests/gaby/wp5-session.gaby.test.ts`, unverändert). `npm run build` grün.

**Was der Planer im Browser prüfen sollte:** Punkt 3 aus Gabys Liste (Netzwerk kappen,
15 s warten, Netzwerk zurück → der Hinweis „Verbindung getrennt“ muss von selbst
verschwinden und neue Einträge wieder ankommen), das ✕ im Sheet-Kopf bei 375 px, und ein
Buy-in mit sofortigem Tipp auf das ✕ im Verlauf (das ✕ ist blass und reagiert nicht,
bis „wird gespeichert …“ verschwunden ist).

## Vorschläge (außerhalb des Pakets)

- `listSessions`/`listPlayers` auf dasselbe `QueryResult`-Muster umstellen (Rest von
  Gabys F1), damit die Startseite einen Ladefehler nicht als „keine Sessions“ zeigt.
- WP6: den Platzhaltersatz im `ClosedNotice` durch die `SettlementView` ersetzen.
- WP8/WP9: der Verlauf könnte gelöschte Einträge aus dem Audit-Log einblenden
  („Ali · Buy-in 100 € · gelöscht von …“); heute sind sie nur im Log sichtbar.
- Ein „Alle ausgestiegen“-Fortschritt im Kopf (x von n) ist da; der Abschluss-Bereich
  darunter gehört bewusst zu WP6.

## Nacharbeit Runde 3 (Planer-Blocker Realtime)

**Befund:** Ein zweiter Tab bekam keine Events, meldete aber `SUBSCRIBED` und keinen
Fehler. Die Ursache liegt im Client, nicht in der Publication.

**Belegte Ursache – Wettlauf zwischen Token und Join.** `RealtimeChannel.subscribe()`
ist synchron und baut die Join-Payload aus dem, was der Socket in genau diesem Moment
hält (`node_modules/@supabase/realtime-js/dist/module/RealtimeChannel.js`, in
`subscribe()`):

```js
const accessTokenPayload = {};
...
if (this.socket.accessTokenValue) {
    accessTokenPayload.access_token = this.socket.accessTokenValue;
}
...
this.updateJoinPayload(Object.assign({ config }, accessTokenPayload));
```

Dort wird nichts abgewartet. Gefüllt wird `accessTokenValue` aber erst asynchron:
supabase-js hängt sich mit `_listenForAuthEvents()` an `onAuthStateChange` und ruft in
`_handleTokenChanged` (`node_modules/@supabase/supabase-js/dist/index.mjs`):

```js
if ((event === "TOKEN_REFRESHED" || event === "SIGNED_IN" || event === "INITIAL_SESSION") && this.changedAccessToken !== token) {
    this.changedAccessToken = token;
    this.realtime.setAuth(token);
}
```

`INITIAL_SESSION` kommt erst, nachdem `@supabase/ssr` das Auth-Cookie gelesen hat –
also nach unserem `useEffect`. Auch der Fallback in `RealtimeClient.connect()` hilft
nicht, er ist selbst asynchron und wird nur abgeschickt, nicht abgewartet:

```js
// while avoiding race conditions with SupabaseClient's immediate setAuth call
if (this.accessToken && !this._authPromise) {
    this._setAuthSafely('connect');
}
```

Der Join ging deshalb **ohne** `access_token` raus. Realtime fällt dann auf den
`apikey`-Parameter des Sockets zurück, das ist der Publishable Key → Rolle `anon`.
Unsere Policies sind `for select to authenticated using (true)`, `anon` trifft also
keine Zeile. Der Server bestätigt den Join trotzdem samt `postgres_changes`-Bindings,
darum meldet der Kanal `SUBSCRIBED` und es erscheint nie ein Fehler – es kommt nur
nichts an. Das spätere `setAuth` repariert das nicht: `_performAuth`
(`RealtimeClient.js`) schickt das neue Token nur an bereits gejointe Kanäle
(`if (channel.joinedOnce && channel.channelAdapter.isJoined())`); wer den Wettlauf
verloren hat, ist zu diesem Zeitpunkt noch nicht gejoint und bekommt nur eine
`updateJoinPayload` für einen Rejoin, der nie kommt.

Hypothesen 3 und 4 des Planers sind nicht die Ursache: die drei `.on()`-Filter werden
in `_updatePostgresBindings` positionsgleich mit der Serverantwort abgeglichen (bei
Abweichung gäbe es `CHANNEL_ERROR`, den gab es laut Beobachtung nicht), und
`private: true` betrifft Broadcast/Presence, nicht `postgres_changes`.

**Fix** (`src/components/sessions/useSessionRealtime.ts`): `subscribeToSession` holt vor
jedem Join erst die Session und setzt das Token auf den Socket; erst danach wird der
Kanal gebaut und gejoint (`authenticateThen` → `openChannel`). Der Retry nach
`CHANNEL_ERROR`/`TIMED_OUT` läuft durch denselben Pfad, authentifiziert sich also
erneut. Ohne Session wird `setAuth()` ohne Argument gerufen, damit der
`accessToken`-Callback von supabase-js die Quelle der Wahrheit bleibt; genau darum
bleibt auch bei `setAuth(token)` `TOKEN_REFRESHED` Sache von supabase-js
(`_performAuth`: `if (this.accessToken) this._manuallySetToken = false`). Schlägt das
Lesen der Session fehl, wird geloggt und trotzdem gejoint (dann greift der alte,
schlechtere Pfad – immer noch besser als gar kein Kanal). Wird während des Wartens
abgeräumt, öffnet sich kein Kanal mehr. Die Begründung der Reihenfolge steht als
Kommentar über `authenticateThen`. `src/lib/supabase/client.ts` blieb unverändert.

**Tests:** `useSessionRealtime.test.ts` von 9 auf 15 Fälle. Der Fake-Client hat jetzt
`auth.getSession` + `realtime.setAuth` und protokolliert die Reihenfolge. Neu: Join
erst nach `setAuth` (`['getSession','setAuth:jwt-user','channel','subscribe']`), gar
kein Join solange die Session noch gelesen wird, kein Join nach Teardown während des
Wartens, Fallback auf den Callback ohne Session, Join trotz Fehler beim Session-Lesen,
und Re-Authentifizierung vor dem Retry. Kein `.from(`/`.rpc(` in Client-Dateien,
`tests/gaby/**` unverändert.

**Prüfung Runde 3:** `npm run check` grün – 32 Dateien, 676 Tests. `npm run build` grün.

**Hinweis zur Umgebung (kein Code-Problem):** Im Worktree gilt `core.autocrlf=true`,
dadurch lagen die Dateien unter `supabase/migrations/` mit CRLF im Arbeitsbaum und drei
Fälle in `tests/gaby/wp1-schema.gaby.test.ts` schlugen fehl, weil sie SQL-Blöcke mit
`\n` wörtlich vergleichen. Nach einem Checkout mit LF sind sie grün; der Index enthält
ohnehin LF, am Commit ändert das nichts. Falls das öfter stört, wäre ein
`.gitattributes` mit `*.sql text eol=lf` die Lösung – das gehört aber nicht in dieses
Paket.

**Was der Planer im Browser prüfen sollte:** Zwei Tabs auf derselben Session-Detailseite,
in Tab 1 einen Buy-in oder Cash-out eintragen – Tab 2 muss die Änderung ohne Neuladen
innerhalb von 2 s zeigen. Danach derselbe Test mit einem Tab, der schon vor dem Login
offen war, um den Pfad „Session kommt erst später“ abzudecken.
