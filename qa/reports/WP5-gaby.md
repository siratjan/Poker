# WP5 – Prüfbericht Gaby

**Urteil: FREIGEGEBEN** (mit Hinweisen)

Geprüfter Stand: Commit `b78f067` „WP5: session detail with live entries“ auf `main`.
Keine Blocker, keine Major-Findings. Sechs Minor-Findings, alle ohne Geld- oder
Sicherheitswirkung. Die Live-Punkte (Realtime über zwei Tabs, echte Trigger-Fehler,
Mobile 375 px) stehen unter „Nicht verifiziert“ und gehören zur Browser-Prüfung des Planers.

Ich habe nur `tests/gaby/wp5-session.gaby.test.ts` angelegt — kein Produktivcode angefasst,
nicht committet.

## Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `npm run check` (typecheck + lint + test), vor meinen Tests | **grün** — 30 Dateien, 611 Tests, 1,27 s |
| `npm run build` | **grün** — `/sessions/[id]` dynamisch (ƒ), Proxy aktiv |
| `npm run rls:smoke` (DB ist jetzt eingespielt) | **grün** — 29 Prüfungen, 29 beweisbar geblockt, 0 Lecks; ohne Login weder lesbar noch schreibbar, auch `settlement_input`/`close_session`/`reopen_session` blockiert |
| `npx vitest run tests/gaby/wp5-session.gaby.test.ts` | **grün** — 50 Tests |
| `npm run check` inkl. meiner Tests | **grün** — 31 Dateien, **661 Tests**, 1,26 s |
| `git diff 2619513 b78f067 -- tests/gaby` | leer — Siri hat meine Tests nicht angefasst |
| Grep `any`/`as any`/`eslint-disable`/`@ts-ignore` in `src/` | keine Treffer |
| Grep `.from(`/`.rpc(` in `src/components`, `src/app` | keine Treffer |

### Eigene Tests — `tests/gaby/wp5-session.gaby.test.ts` (50)

1. **`derive.ts` gegen Handrechnung** — Ali 100 € bar + 50 € Liste (spielt noch),
   Ben 100 € bar / Stack 0, Cem 50 € Liste / Stack 80 € / zwei Auszahlungen 30 € + 20 €.
   Von Hand: `totalCash 20000`, `totalCredit 10000`, `totalBuyIn 30000`, `totalStack 8000`,
   `totalPayout 5000`, `cashBox 15000`, `stackCount 2/3`, `canClose false`,
   `discrepancy −22000`. Der Code liefert exakt das (`toEqual` auf das ganze Totals-Objekt).
2. Grenzfälle: leere Session (`canClose false`), Spieler ohne Buy-in mit Stack 0
   (`net 0`, `canClose true`, `discrepancy 0`), Teilnehmer ganz ohne Eintrag
   (blockiert `canClose`, bleibt entfernbar), mehrere Payouts mit krummen Cent
   (`10033 − 3311 − 22`), Listen-Buy-in füllt die Kasse nicht, Einträge eines
   Nicht-Teilnehmers werden ignoriert, Sortierung nach `position`,
   `lastPayment` = zeitlich letzter Buy-in, `sortEntriesNewestFirst` stabil und ohne Mutation.
3. **Live-Vorschau** gegen `docs/SETTLEMENT.md` von Hand: Ali (bar 100 €, Stack 120 €) und
   Ben (bar 100 €, Stack 80 €) → box 20000; Stufe 1 `min(cashIn, stack) − payout` = 10000/8000
   (Σ ≤ box, voll), Rest 2000; Stufe 2 `claim − tier1` = 2000/0 → Ali 2000.
   Erwartet Ali `cashFromBox 12000`, Ben `8000` — stimmt. Mit einem noch spielenden dritten
   Spieler bleibt Ali bei 12000, aber `provisional: true`. Verletzte Vorbedingung
   (Auszahlung ohne Bargeld in der Kasse) → `null` statt Exception; unbekannter Spieler → `null`.
4. **Fehlercode-Mapping**: eigener Scan über `raise exception '<CODE>'` in `0002`;
   jeder Code hat eine Übersetzung, keine Meldung enthält den Code oder einen
   SQL-Bezeichner, unbekannter Fehler (`22P02`) → `null` (generisch), `42501` → FORBIDDEN,
   eingebetteter Code („ERROR: SESSION_CLOSED (SQLSTATE P0001)“) wird erkannt.
5. **Zod-Grenzen**: Buy-in/Payout Integer > 0 bis 1.000.000 Cent, `MAX+1`, `0`, `-1`, `10.5`,
   `NaN`, `Infinity`, `"100"` abgelehnt; Cash-out erlaubt 0, lehnt −1 und 0,5 ab;
   Zahlungsart Pflicht; deutsche Meldungen inkl. „höchstens 10.000,00 €“.
6. **Rollenwächter**: Quelltext-Scan je Action-Body — `await requireEditor()` vor
   `parseInput(` und vor `createClient(`; genau acht Exports; die DB-Helfer
   `insertEntry`/`insertParticipant` sind nicht exportiert.
7. **Realtime/Client**: ein `supabase.channel(`, Effekt-Deps `[sessionId]`,
   `removeChannel` im Cleanup, genau ein `retried = true`, `DISCONNECT_HINT_MS = 10_000`,
   kein `.from(`/`.rpc(` in den Client-Dateien, `mayAct = canEdit && isOpen` verdrahtet.

## Fehlercode-Tabelle (Testauftrag: Mapping vollständig)

Alle 22 Codes aus `supabase/migrations/0002_functions_triggers.sql` haben eine deutsche
Meldung in `src/lib/errors/de.ts`. Unabhängig nachgezählt (`grep -n "raise exception"`), kein
Code fehlt, kein überflüssiger Eintrag.

| Code | Quelle in 0002 | Deutsche Meldung (gekürzt) |
|---|---|---|
| `LAST_ADMIN` | `protect_last_admin` :121 | „Der letzte Admin kann sich nicht selbst herabstufen …“ |
| `FORBIDDEN` | `app_users`-Schutz :162/:174, `close_session` :719, `reopen_session` :1036 | „Dafür fehlen dir die Rechte.“ |
| `ONLY_ROLE_EDITABLE` | `app_users`-Schutz :182 | „An diesem Nutzer lässt sich nur die Rolle ändern.“ |
| `SESSION_NOT_FOUND` | `validate_entry` :443, RPCs :725/:1046 | „Diese Session gibt es nicht (mehr).“ |
| `SESSION_CLOSED` | `validate_entry` :446, `validate_session_update` :572, `session_player_delete` :612, `close_session` :728 | „Diese Session ist abgeschlossen …“ |
| `SESSION_NOT_CLOSED` | `reopen_session` :1049 | „Diese Session ist gar nicht abgeschlossen.“ |
| `ENTRY_IMMUTABLE_KEYS` | `validate_entry` :457 | „Ein Eintrag kann nicht … umgehängt werden.“ |
| `CASH_OUT_HAS_PAYOUT` | `validate_entry` (delete) :475 | „Der Stack lässt sich nicht löschen, solange …“ |
| `PLAYER_ALREADY_CASHED_OUT` | :485 | „Dieser Spieler ist schon ausgestiegen …“ |
| `STACK_BELOW_PAYOUT` | :494 | „Der Stack ist kleiner als das, was … bar bekommen hat.“ |
| `PAYOUT_REQUIRES_CASH_OUT` | :504 | „Für eine Bar-Auszahlung braucht der Spieler zuerst einen Stack …“ |
| `PAYOUT_EXCEEDS_STACK` | :513 | „Die Auszahlung ist größer als der Stack …“ |
| `PAYOUT_EXCEEDS_CASHBOX` | :531 | „So viel Bargeld ist nicht in der Kasse.“ |
| `USE_RPC` | `validate_session_update` :566 | „Der Status … nur über Abschließen bzw. Wieder öffnen …“ |
| `IMMUTABLE_FIELD` | :578 | „Dieses Feld einer Session lässt sich nicht ändern.“ |
| `PLAYER_HAS_ENTRIES` | `validate_session_player_delete` :617 | „Dieser Spieler hat schon Einträge …“ |
| `NO_PARTICIPANTS` | `close_session` :734 | „Diese Session hat noch keine Teilnehmer.“ |
| `MISSING_CASH_OUT` | :745 | „Es haben noch nicht alle Teilnehmer einen Stack …“ |
| `SETTLEMENT_MISMATCH` | :763/:775/:787/:836/:995 | „Die Daten haben sich geändert. Bitte noch einmal prüfen.“ |
| `SETTLEMENT_INVARIANT` | :850–:927 | „Die Abrechnung ist nicht stimmig und wurde nicht gespeichert …“ |
| `DISCREPANCY_REQUIRES_ADMIN_NOTE` | :936 | „Mit Differenz kann nur ein Admin abschließen …“ |
| `REASON_REQUIRED` | `reopen_session` :1040 | „Bitte gib einen Grund an (mindestens 3 Zeichen).“ |

Zusätzlich SQLSTATE-Fallbacks: `42501` → FORBIDDEN, `23505` → Duplikat, `23503` → fehlende
Referenz, `23514` → unerlaubter Wert. **Unbekannt → `null`** → `actionResult` loggt serverseitig
und antwortet `UNEXPECTED` („Etwas ist schiefgelaufen …“). Damit erreicht keine rohe
Postgres-Meldung die UI (getestet mit `22P02`, inkl. `details`).

## Actions × Prüfung (Testauftrag)

| Action | Datei:Zeile | Wächter | vor `parseInput` | vor DB-Zugriff | Zod-Grenzen |
|---|---|---|---|---|---|
| `addParticipant` | `src/actions/entries.ts:42` | `requireEditor` | ✔ | ✔ (`insertParticipant` danach) | uuid × uuid |
| `addParticipantByNewPlayer` | :54 | `requireEditor` | ✔ | ✔ | Name getrimmt 1–40 |
| `removeParticipant` | :78 | `requireEditor` | ✔ | ✔ | uuid × uuid |
| `addBuyIn` | :100 | `requireEditor` | ✔ | ✔ | int > 0, ≤ 1.000.000, `cash`/`credit` |
| `addCashOut` | :115 | `requireEditor` | ✔ | ✔ | int ≥ 0, ≤ 1.000.000 |
| `updateCashOut` | :136 | `requireEditor` | ✔ | ✔ | int ≥ 0, `type = 'cash_out'` im Filter |
| `addPayout` | :159 | `requireEditor` | ✔ | ✔ | int > 0, ≤ 1.000.000 |
| `deleteEntry` | :179 | `requireEditor` | ✔ | ✔ | uuid, `session_id` im Filter |

`insertEntry`/`insertParticipant` sind modulprivat; es gibt keinen exportierten Weg an
`requireEditor` vorbei. Die eigentliche Grenze bleibt RLS + Trigger (`rls:smoke` grün).

## DoD-Abgleich

| DoD-Punkt | Status | Anmerkung |
|---|---|---|
| Buy-in in drei Tipps (Spieler → Betrag → Bar/Liste) | ✔ (Code) | Karte → Schnellbetrag → „Bar“/„Auf Liste“ = 3 Tipps. Siris Abweichung (Karten-Tipp öffnet direkt das Buy-in-Sheet, Aktions-Sheet auf „⋯“) ist **die einzige Variante, die die DoD erfüllt** — der Plan-Weg wären vier Tipps. Bewertung: zulässig und richtig. Bei Spielern mit Stack öffnet die Karte das Aktions-Sheet, was zur Sache passt. Browser-Bestätigung durch den Planer. |
| Zweites Gerät/Tab sieht Einträge < 2 s ohne Neuladen | nicht verifiziert | Kanal auf `entries`/`session_players`/`sessions` mit `session_id`-Filter; `0004` publiziert alle drei und setzt `replica identity full` für `entries` (Deletes kommen vollständig). Zwei-Tab-Test macht der Planer. |
| Trigger-Fehler als verständliche deutsche Toasts, nie roh | ✔ (Logik) / live offen | Vollständige Code-Tabelle oben; unbekannt → generisch. Der echte Trigger-Text kommt erst live an. |
| Mobile 375 px, Tippziele ≥ 44 px | überwiegend ✔, ein Verstoß | Karten 72 px, „⋯“ 44 px, Verlauf-Löschen 44 px, Buttons `min-h-44/52`, Schnellbeträge 56 px, `max-w-2xl`, `truncate`. **Ausnahme: das ✕ im Sheet-Kopf ist 36 px** (F3). Viewport-Prüfung: Planer. |
| Alle 8 Actions, zod + `requireEditor` | ✔ | Tabelle oben. |
| `derive.ts` getestet, reine Funktionen | ✔ | 35 Tests von Siri + 50 von mir, Handrechnung stimmt. |
| Optimistic UI nur für Buy-in, Rollback + Toast | ✔ | `submitBuyIn` ist die einzige optimistische Aktion; bei `!ok` wird die Pending-Zeile entfernt und `showError(result.error.message)` gezeigt; Doppelzählung ist über `visiblePending` (Abgleich mit `realId`) ausgeschlossen. |
| Viewer ohne Aktions-Buttons, `closed` gesperrt | ✔ (UI) + serverseitig | `mayAct = canEdit && isOpen` steuert Karten-Interaktivität, „Teilnehmer hinzufügen“, „⋯“ und Verlauf-Löschen. Serverseitig `requireEditor` + RLS + `SESSION_CLOSED`-Trigger. |
| Geld = Integer-Cent, `formatCents`/`parseEuroInput` | ✔ | Eingabe ausschließlich über `amountFromInput` → `parseEuroInput`; keine Division/Float in `derive.ts`; `parseQuickAmounts` wirft nicht-ganzzahlige Schnellbeträge weg. |
| Kein `any`, Lint sauber, keine deaktivierten Regeln, UI Deutsch | ✔ | Greps ohne Treffer; alle sichtbaren Texte deutsch, Code/Kommentare englisch. |
| WP4-F1/F2 im Session-Detail-Pfad behoben | ✔ | `getSessionDetail` liefert `QueryResult`; `notFound()` nur bei `not_found`, Ladefehler bekommt eigenen Hinweis. |

## Findings

### F1 – Minor: Der eine Reconnect nach `CHANNEL_ERROR` läuft mit dieser Realtime-Version vermutlich ins Leere
- Wo: `src/components/sessions/useSessionRealtime.ts:85-94`
- Beobachtet: Nach `CHANNEL_ERROR` wird `channel.subscribe()` ein zweites Mal gerufen. In
  `@supabase/realtime-js@2.116.0` tut `subscribe()` nur dann etwas, wenn der Kanal-Adapter im
  Zustand `closed` ist (`RealtimeChannel.js:140` → `channelAdapter.isClosed()`); nach einem
  Fehler ist der Zustand `errored`, der Aufruf gibt also nur `this` zurück. Außerdem wird beim
  zweiten Aufruf **kein Callback** übergeben — käme es doch zu einem Re-Join, würde der Status
  nicht auf `live` zurückspringen, obwohl er es ist.
- Erwartet: „bei `CHANNEL_ERROR` einmal neu abonnieren“ (WP5 Schritt 4). In der Praxis rejoint
  Phoenix von selbst, und der 10-s-Hinweis samt „Neu laden“ fängt den Rest ab — deshalb Minor
  und kein Datenverlust. Sauberer wäre `removeChannel` + neuer Kanal (State-Flag), oder den
  Retry ersatzlos streichen und sich auf den Auto-Rejoin plus Hinweis verlassen.
- Reproduktion: Nur live — Netzwerk im Browser kappen, 15 s warten, wieder verbinden und
  beobachten, ob der Hinweis verschwindet und neue Einträge wieder ankommen (Planer).

### F2 – Minor: Der Lösch-Button greift auch bei einem noch nicht gespeicherten Buy-in
- Wo: `src/components/sessions/SessionDetailClient.tsx:121-131` + `HistoryList.tsx:53-62`
- Beobachtet: Optimistische Buy-ins werden in den Verlauf gemischt (`mergedEntries`); ihre `id`
  ist bis zur Serverantwort `pending-…`. Ein Tipp auf ✕ in diesem Moment schickt
  `deleteEntry({ id: 'pending-…' })` → zod lehnt mit „Ungültiger Eintrag.“ ab.
- Erwartet: Entweder kein Lösch-Button für unbestätigte Zeilen oder eine passende Meldung
  („wird noch gespeichert“). Kein Geld- oder Sicherheitsproblem: die Zeile bleibt korrekt, es
  wird nichts Falsches gelöscht.
- Reproduktion: Buy-in eintragen und im selben Augenblick ✕ im Verlauf tippen.

### F3 – Minor: Tippziel unter 44 px im Sheet-Kopf
- Wo: `src/components/ui/Sheet.tsx:72-79` (`size-9` = 36 px)
- Beobachtet: Das ✕ zum Schließen ist 36 × 36 px.
- Erwartet: „alle Tipp-Ziele ≥ 44 px“ (WP5 DoD, Mobile). Entschärft durch Backdrop-Tipp und
  Escape, deshalb Minor. (Kommt aus WP4, wird durch WP5 nur häufiger benutzt.)
- Reproduktion: 375-px-Viewport, Sheet öffnen, ✕ messen.

### F4 – Minor: Nach einem Fehler wird nicht aktualisiert
- Wo: `src/components/sessions/SessionDetailClient.tsx:146-158` (`run`), `:190-194`
- Beobachtet: `refresh()` läuft nur im Erfolgsfall. Genau die typischen Fehler kommen aber
  daher, dass sich die Daten geändert haben (`SESSION_CLOSED`, `PLAYER_ALREADY_CASHED_OUT`,
  `PAYOUT_EXCEEDS_CASHBOX` nach fremder Auszahlung). Der Bildschirm zeigt dann weiter den alten
  Stand, bis ein Realtime-Event eintrifft.
- Erwartet: Bei diesen Codes zusätzlich `router.refresh()`, damit Meldung und Anzeige zusammenpassen.
  Kein Geldfehler — geschrieben wurde nichts.
- Reproduktion: Zwei Tabs; in Tab A Stack eintragen, in Tab B (mit unterdrücktem Realtime)
  Buy-in versuchen → Toast erscheint, Karte bleibt „spielt noch“.

### F5 – Minor: Codesuche in der ganzen Fehlermeldung kann theoretisch falsch treffen
- Wo: `src/lib/errors/de.ts:118-126` (`extractCode`)
- Beobachtet: Kommt der Code nicht allein, wird die gesamte Meldung nach jedem bekannten Code
  als Wort durchsucht. Enthielte eine Postgres-Meldung einmal Nutzerdaten mit so einem Wort
  (z. B. ein Spieler namens `SESSION_CLOSED`), zeigte die UI die falsche Erklärung.
- Erwartet: Unkritisch (nie mehr Rechte, nie ein anderer Betrag), aber sauberer wäre, nur
  `error.message` **exakt** oder ein `^CODE\b`-Präfix zu akzeptieren. Bewusst Minor.
- Reproduktion: Konstruiert; nicht live beobachtet.

### F6 – Minor (Bewertung des offen gelassenen WP4-F1): akzeptabel, mit einer sichtbaren Folge in WP5
- Wo: `src/lib/queries/players.ts:22-25` (`listPlayers`), `src/lib/queries/sessions.ts` (`listSessions`)
- Beobachtet: Beide geben bei Query-Fehler weiter `[]` zurück. Im WP5-Pfad landet das im Sheet
  „Teilnehmer hinzufügen“: bei einem Ladefehler steht dort „Alle Spieler sind schon dabei.“
  (`EntrySheets.tsx:306-311`) statt eines Hinweises.
- Erwartet: Für WP5 vertretbar — kein Geld, keine Rechte, der Nutzer kann neu laden; die
  kritischen Daten der Detailseite laufen bereits über `QueryResult` (F1/F2 aus WP4 dort
  behoben). Ich stimme Siri zu, dass eine Umstellung von `listSessions`/`listPlayers`
  Scope-Creep wäre — sie gehört in WP7 (Spieler-Übersicht) mit erledigt.
- Reproduktion: Nur mit provoziertem Query-Fehler.

## Bewertete Abweichungen vom Plan

| Abweichung | Bewertung |
|---|---|
| Karten-Tipp öffnet direkt das Buy-in-Sheet, Aktions-Sheet auf „⋯“ | **Richtig so.** Der Plan-Weg (Karte → Aktions-Sheet → Buy-in → Betrag → Zahlungsart) wären vier Tipps und würde die DoD „Buy-in in drei Tipps“ verletzen. Das Aktions-Sheet bleibt vollständig erreichbar; bei Spielern mit Stack ist es die Primäraktion. Begründet im Handoff. |
| Verlauf neueste zuerst statt „chronologisch“ | Akzeptabel; die Reihenfolge ist deterministisch (Zeit, dann `id`) und passt zum Löschen des letzten Eintrags am Tisch. Nur Anzeige, keine Rechnung. |
| Kein Abrechnungsblock bei `closed` (Platzhaltersatz) | Korrekt abgegrenzt — das ist WP6. Der Satz „erscheint mit dem nächsten Arbeitspaket“ muss in WP6 durch `SettlementView` ersetzt werden (`SessionDetailClient.tsx:449-452`). |
| `getSessionHeader` entfernt | Ok, war nur von der WP4-Detailseite benutzt; `npm run build` grün. |

## Nicht verifiziert

- **Realtime über zwei Tabs/Geräte** (< 2 s, Delete-Events, Reconnect nach Netzwerkverlust,
  Verschwinden des Hinweises „Verbindung getrennt“). Nur Code-Review; F1 ausdrücklich hier prüfen.
- **Echte Trigger-Fehler**: `PLAYER_ALREADY_CASHED_OUT`, `PAYOUT_EXCEEDS_CASHBOX`,
  `PAYOUT_EXCEEDS_STACK`, `STACK_BELOW_PAYOUT`, `CASH_OUT_HAS_PAYOUT`, `PLAYER_HAS_ENTRIES`,
  `SESSION_CLOSED`. Das Mapping ist vollständig geprüft, aber ich habe keinen echten
  Postgres-Fehlertext gesehen — bitte einmal live gegenprüfen, dass die Meldung wirklich
  **nur** den Code enthält (sonst greift F5).
- **Mobile 375 px**: kein horizontales Scrollen, Tippziele, Sheet über der Tab-Leiste,
  Tastatur öffnet sich im Buy-in-Sheet (`autoFocus` + Sheet-Fokus-Ausnahme).
- **RLS im eingeloggten Zustand**: `rls:smoke` beweist nur den anonymen Fall. Ein Viewer, der
  eine Server Action direkt aufruft, wurde nur per Unit-Test (`requireEditor` → FORBIDDEN)
  geprüft, nicht gegen die echte Policy.
- **Position-Retry** bei gleichzeitigem Hinzufügen (`insertParticipant`, `unique (session_id,
  position)`): die Unterscheidung „Positionskonflikt“ vs. „Spieler schon dabei“ hängt daran,
  ob das Wort `position` in der Postgres-Meldung steht (`entries.ts:259-261`). Das ist
  plausibel (`duplicate key value violates unique constraint "session_players_session_id_position_key"`),
  aber ungeprüft. Falls es live danebengeht, erscheint „Dieser Spieler ist schon dabei.“
  obwohl er es nicht ist — bitte beim Test mit zwei Geräten kurz beobachten.

### Konkrete Browser-Prüfung für den Planer

1. Buy-in in drei Tipps: Karte → Schnellbetrag → „Bar“; Toast „100,00 € bar für Ali eingetragen“,
   Karte sofort aktualisiert („wird gespeichert …“ verschwindet).
2. Zweiter Tab: neuer Eintrag < 2 s; Eintrag löschen → verschwindet auch im zweiten Tab.
3. Netzwerk kappen → nach 10 s „Verbindung getrennt“; Netzwerk zurück → prüfen, ob der Hinweis
   von selbst verschwindet (F1).
4. Aussteigen mit Stack 0, danach Buy-in versuchen → deutscher Toast, keine SQL-Meldung.
5. Auszahlung größer als die Kasse → „So viel Bargeld ist nicht in der Kasse.“
6. Als Viewer: keine „⋯“, keine Buttons, kein ✕ im Verlauf.
7. 375 px: kein horizontales Scrollen; das ✕ im Sheet-Kopf ist klein (F3).
