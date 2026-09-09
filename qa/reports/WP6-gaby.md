# WP6 – Prüfbericht Gaby

**Urteil: FREIGEGEBEN (mit Hinweisen)**

Geprüfter Stand: `5f83003` „WP6: close/reopen session, settlement view" auf `main`.
Diff-Basis: `82d9d5c` (WP5-Abnahme). Datum: 2026-09-09.

Kein Blocker, kein Major. Drei Minor-Findings (F1–F3), davon eines an der Werkzeugkette,
nicht am Paket. Der sicherheitskritische Kern – **die Abrechnung kommt immer vom Server, und
die abgeschlossene Ansicht zeigt ausschließlich gespeicherte Zahlen** – hält allen Angriffen
stand, die ich fahren konnte.

---

## Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `npm run typecheck` (`next typegen && tsc --noEmit`) | **grün** |
| `npx eslint src tests scripts` | **grün**, 0 Errors, 0 Warnings |
| `npm run lint` (ganzes Verzeichnis) | **rot** – 445 Errors, alle aus `.claude/worktrees/agent-a71d72967abdcedec/.next/**` (untracked Build-Artefakt eines fremden Agent-Worktrees, kein Projektcode). Siehe F1. |
| `npm test` (`vitest run`) | **grün** – 37 Dateien, **781 Tests** (davon 23 neu von mir; Siris Stand: 36 Dateien / 758) |
| `npm run build` | **grün** – `/sessions/[id]` weiterhin dynamisch (ƒ) |
| `npm run rls:smoke` (live gegen `vcyqzqgybjggoreffwjc`) | **grün** – 29 Prüfungen, 29 beweisbar geblockt, 0 Lecks. Explizit geblockt: `settlements`, `settlement_lines`, `settlement_transfers` (select+insert) sowie die RPCs `close_session`, `reopen_session`, `settlement_input` (je `42501`). |
| `npx vitest run src/actions/close.test.ts src/lib/settlement/verify.test.ts` | grün (49 Tests) |

Eigene Tests: **`tests/gaby/wp6-close.gaby.test.ts` – 23 Tests, grün.** Sie bleiben im Repo
und laufen bei `npm test` mit.

`git diff 82d9d5c..5f83003 -- tests/gaby` ist leer: **Siri hat `tests/gaby/**` nicht angefasst.**

---

## DoD-Abgleich

| DoD-Punkt (ARBEITSPAKETE.md WP6) | Status | Anmerkung |
|---|---|---|
| Editor kann mit Differenz nicht abschließen | ✅ | Dreifach: UI (`CloseSessionPanel.tsx:315`), Server Action (`close.ts:118-126`), RPC (`0002:934-938`). Nur die letzten beiden sind Sicherheitsgrenze. |
| Admin nur mit Kommentar (≥ 3 Zeichen) | ✅ | `close.ts:119` + `0002:935`; zod trimmt (`validation/close.ts:27-33`). |
| `discrepancy_cents` und `close_note` sichtbar | ✅ | `SessionDetailClient.tsx:491-513` (`ClosedNotice`), `whitespace-pre-line` zeigt auch den angehängten Wieder-Öffnen-Grund. |
| Nach Abschluss jede Schreibaktion in der UI weg | ✅ | `mayAct = canEdit && isOpen` (`SessionDetailClient.tsx:104`) steuert Teilnehmer-Button, `ParticipantCard interactive`, `HistoryList canEdit`; `CloseSessionPanel` nur bei `isOpen && canEdit`. Kein Schreibpfad ohne `mayAct` gefunden. |
| Serverseitig blockiert, Toast bei Race | ✅ | `validate_entry` (Session muss `open`), `close_session` sperrt die Session-Zeile mit `for update` und wirft `SESSION_CLOSED`; `de.ts:27` übersetzt deutsch, `CloseSessionPanel.submit` zeigt Toast + `refresh()`. |
| Gespeicherte Abrechnung = Vorschau vor dem Klick | ✅ | Beide Wege rufen `computeSettlement` über dieselben Teilnehmerdaten; das Bestätigungs-Sheet holt zusätzlich die **Server**-Vorschau. Browser-Gegenprobe steht unten. |
| Wieder öffnen löscht die Abrechnung, Log zeigt Grund | ✅ (statisch) | `reopen_session` löscht `settlements` (Kaskade), hängt `[wieder geöffnet: …]` an `close_note`, alter Wert bleibt in `audit_log.old_data`. Nicht live geprüft (kein Login). |
| Erneutes Abschließen erzeugt neue Abrechnung | ✅ (statisch) | PK `settlements.session_id` ist nach dem Delete frei. |
| Anzeige nutzt gespeicherte Werte, nicht Neuberechnung | ✅ | Code-Review + manipuliertes Fixture, siehe unten. |
| `npm run check` grün | ⚠️ | Auf dem **verfolgten** Inhalt grün (typecheck, `eslint src tests scripts`, 781 Tests). Der Gesamtlauf ist nur wegen F1 rot. |
| `npm run build` grün | ✅ | |
| Geld = Integer-Cent, keine `any`, keine deaktivierten Lint-Regeln, UI Deutsch | ✅ | Kein `any`, kein `eslint-disable`, kein `@ts-ignore` im WP6-Diff (`git diff 82d9d5c..5f83003 \| grep -i "any\|eslint-disable\|ts-ignore"` liefert nichts Relevantes). `formatCents` wirft bei nicht-ganzzahligen Cent. |
| Keine neuen Abhängigkeiten | ✅ | `package.json` im Diff unverändert. |

---

## Testauftrag im Einzelnen

### 1. Gespeicherte Werte statt Neuberechnung

**Code-Review.** `SettlementView.tsx`, `ClosedSessionSection.tsx`, `CopySettlementButton.tsx`,
`shareText.ts` und `sessionDetail.ts` enthalten weder `computeSettlement` noch `distribute` –
das friere ich in
`tests/gaby/wp6-close.gaby.test.ts` („SettlementView und ClosedSessionSection rufen
computeSettlement nicht auf") dauerhaft ein, damit es niemand später hineinrutschen lässt.
`computeSettlement` wird nur an drei erlaubten Stellen gerufen: `close.ts` (Abschluss +
Server-Vorschau), `derive.ts` (Auszahlungs-Vorschau offener Sessions, WP5),
`CloseSessionPanel.tsx` (Live-Vorschau **vor** dem Abschluss).

**Manipuliertes Fixture.** Ich habe die gespeicherten TV2-Zeilen verbogen (Ali `cash_from_box`
160,00 € → 111,11 €, Transfer 40,00 € → 12,34 €, `unallocated_cash` 0 → 48,89 €) und
`fromStoredRows` + `SettlementView` gerendert (`renderToStaticMarkup`):
die Anzeige zeigt **111,11 €**, **12,34 €** und „Bleibt in der Kasse: 48,89 €" und
korrigiert nichts; die ehrliche Zahl 160,00 € taucht nirgends auf. Gegenprobe: genau diese
Zeilen fallen bei `verifySettlement` durch – sie hätten also nie geschrieben werden können.
Zusätzlich geprüft: `fromStoredRows` sortiert nach gespeicherter `position`, nicht nach
Array-Reihenfolge (Zeilen rückwärts eingelesen → korrekte Reihenfolge A, B, C, D).

### 2. Race: zwei gleichzeitige Abschlüsse

Statisch nachvollzogen in `0002_functions_triggers.sql:722-729`: `close_session` nimmt
`select … from sessions where id = … for update` **vor** jeder Prüfung. Die zweite
Transaktion blockiert bis zum Commit der ersten, liest dann `status = 'closed'` und wirft
`SESSION_CLOSED`; ein Duplikat kann es zusätzlich nicht geben, weil `settlements.session_id`
Primärschlüssel ist. Ändern sich zwischenzeitlich Einträge, greift der Vergleich gegen
`entries` (`0002:766-837`) → `SETTLEMENT_MISMATCH`. Beide Codes sind deutsch übersetzt
(`de.ts:27`, `de.ts:55`) und landen als Toast (`CloseSessionPanel.tsx:64-68`), das Panel lädt
danach neu. `close.test.ts:379` deckt den Fall mit gemocktem Client ab.
Live gegen die DB ohne Login: `rls:smoke` zeigt, dass `close_session` für `anon` schon am
`grant` scheitert. Der echte Zwei-Tab-Test bleibt beim Planer (siehe „Nicht verifiziert").

### 3. Share-Text gegen TV2 und TV4 (von Hand nachgerechnet)

TV2 (box 200 → Stufe 1 Ali 100 / Ben 40, Stufe 2 Ali 60; Residuen +40 / 0 / −40):

```
Poker-Kasse · Sa, 12.09.2026

Aus der Kasse:
- Ali bekommt 160,00 € bar
- Ben bekommt 40,00 € bar
Summe: 200,00 €

Überweisungen:
- Can schuldet Ali 40,00 €
Summe: 40,00 €

Ergebnis des Abends:
- Ali: +100,00 €
- Can: -40,00 €
- Ben: -60,00 €
```

TV4 (A bekommt die komplette Kasse 200; Residuen +100 / 0 / −50 / −50):

```
Poker-Kasse · Sa, 12.09.2026 · Freitagsrunde

Aus der Kasse:
- A bekommt 200,00 € bar
Summe: 200,00 €

Überweisungen:
- C schuldet A 50,00 €
- D schuldet A 50,00 €
Summe: 100,00 €

Ergebnis des Abends:
- A: +200,00 €
- C: -50,00 €
- D: -50,00 €
- B: -100,00 €
```

Beides stimmt zeichenweise mit `buildShareText` überein (mein Test vergleicht den kompletten
String, nicht Ausschnitte). Sortierung im Ergebnisblock ist Plus/Minus absteigend, bei
Gleichstand Beitrittsreihenfolge – bei TV4 also C vor D. Zusätzlich geprüft: kein `<`, `>`
oder Tab in allen sechs Testfällen (WhatsApp-tauglich).

### 4. `SettlementView` mit TV8 / TV9 / TV9b / TV10

Alle als Text-Test über `renderToStaticMarkup` in `tests/gaby/wp6-close.gaby.test.ts`.

- **TV8 (Cent-Rundung):** Stufe 2 = 66,67 / 66,67 / 66,66 (Handrechnung: 200/3 = 66,666…,
  Rest 2 Cent an A und B nach Largest-Remainder mit Eingabereihenfolge als Tie-Break).
  Auf dem Schirm: „166,67 € bar" zweimal, „166,66 € bar" einmal, Summe 500,00 €,
  Transfers 33,34 / 33,33 / 33,33 (F → C zuerst, weil C der größte Gläubiger ist).
  Kein Differenz-Hinweis.
- **TV9:** `unallocatedCash` 10,00 € → „Bleibt in der Kasse: 10,00 € (Differenz)",
  Block 2 „Keine Schulden, alles bar erledigt.", Block 3 „Differenz -10,00 € — 10,00 €
  weniger gezählt als eingekauft".
- **TV9b:** `uncoveredDebts` 100,00 € → „100,00 € Schuld ohne Gläubiger (Differenz)".
  Der reine TV9b hat `unallocatedCash = 0`; damit die geforderte Gleichzeitigkeit wirklich
  geprüft ist, habe ich den Fall (A auf Liste 100 ohne Stack, B bar 100 ohne Stack)
  ergänzt: `discrepancy −200,00 €`, `unallocatedCash 100,00 €` **und** `uncoveredDebts
  100,00 €`. Beide Hinweise stehen gleichzeitig auf dem Schirm. ✔
- **TV10:** `uncoveredClaims` 10,00 € → „10,00 € Anspruch ohne Deckung (Differenz)",
  Block 3 „Differenz +10,00 € — 10,00 € mehr gezählt als eingekauft".
- Fehlt ein Name in der Tabelle, erscheint „Unbekannt", nie eine rohe UUID.

### 5. `closeSession` gegen manipulierte Eingaben – der Kern

**Die Action nimmt gar keine Abrechnung entgegen.** `closeSessionSchema`
(`validation/close.ts:24-33`) hat exakt zwei Felder: `sessionId` und `note`. Alles Übrige
verwirft zod, bevor irgendetwas passiert. `p_settlement` ist ausschließlich
`toSettlementPayload(settlement)` aus der eigenen Berechnung über `settlement_input`
(`close.ts:129-133`). Das habe ich zusätzlich statisch eingefroren, damit ein späteres Paket
nicht heimlich ein Client-Feld nachrüstet.

**`verify.ts` als einzige Verteidigung für die zwei DB-Lücken.** Ich habe meine beiden
dokumentierten Restlücken aus `tests/gaby/wp1-close-session.gaby.test.ts` gegen
`verifySettlement` gefahren – beide sind zu:

| Lücke von `close_session` | Angriff | `verifySettlement` |
|---|---|---|
| Invariante 5: Stufe-1-Kürzung nicht anteilig | A bekommt 100 statt 50, B geht mit Schuldschein heim | `TIER1_NOT_PROPORTIONAL` ✔ |
| Deckung je Schuldner | A zahlt 200 für sich **und** B, Summen stimmen | `DEBTOR_OVERPAYS` ✔ |
| (dritte, kleinere Lücke) Stufe nur umetikettiert | Bar-Zahler bekommt seinen Anspruch als „Stufe 3" | `TIER1_NOT_PROPORTIONAL` / `TIER3_WRONG` ✔ |

Weitere Angriffe, die ich selbst gebaut habe und die alle abgewiesen werden:
ein Gläubiger kassiert doppelt (`CREDITOR_OVERPAID`), Bargeld an den Listen-Spieler während
ein Bar-Zahler offen ist (`CASH_FIRST_VIOLATED` + `TIER2_WRONG`), Differenz aus den
Kopfzahlen wegretuschiert (`DISCREPANCY_WRONG` u. a.), halbe Cent (`NON_INTEGER_AMOUNT`),
eine unterschlagene Überweisung (`TRANSFER_TOTAL_WRONG`).

Der Grund, warum das trägt: `verify` leitet die Stufen 1–3 mit `distribute()` **aus den
Zeilen neu ab** und vergleicht exakt. Da die DB `cashIn`/`creditIn`/`stack`/`payout` jeder
Zeile gegen `entries` prüft und `verify` `claim`, `netResult`, `cashFromBox` und `residual`
als Definitionen nachrechnet, ist die gesamte Kassenverteilung eindeutig festgelegt. Der
einzige verbleibende Freiheitsgrad ist die **Paarung** der Überweisungen (A→D/B→C statt
A→C/B→D bei gleichen Beträgen) – da jeder Schuldner genau seine Schuld zahlt und jeder
Gläubiger genau sein Guthaben bekommt, verschiebt das kein Geld; und über `closeSession` ist
er ohnehin unerreichbar, weil die Transfers aus `computeSettlement` stammen. Kein Fehlalarm:
alle Pflichtfälle gehen durch (bei mir zusätzlich noch einmal geprüft, bei Siri plus 1000
Zufallssessions).

### 6. Rollen und Fehlercodes

| Aktion | Rollenprüfung Action | Rollenprüfung DB |
|---|---|---|
| `previewSettlement` | `requireUser()` (nur lesen) | `settlement_input` ist `security invoker` → RLS |
| `closeSession` | `requireEditor()` | `close_session`: `if not is_editor() → FORBIDDEN` |
| `reopenSession` | `requireAdmin()` | `reopen_session`: `if not is_admin() → FORBIDDEN` |
| Abschluss mit Differenz | `isAdmin(user.role)` **und** Kommentar ≥ 3 | `is_admin()` **und** `length(v_note) >= 3` |

Die Differenz-Regel ist damit serverseitig doppelt, nicht nur in der UI.
Alle geforderten Codes sind deutsch (`src/lib/errors/de.ts:26-58`):
`MISSING_CASH_OUT` (die Action nennt sogar die fehlenden Spieler beim Namen,
`close.ts:226-232`), `DISCREPANCY_REQUIRES_ADMIN_NOTE`, `SETTLEMENT_MISMATCH`
(„Die Daten haben sich geändert. Bitte noch einmal prüfen."), `SETTLEMENT_INVARIANT`,
`SESSION_CLOSED`, `SESSION_NOT_CLOSED`, `REASON_REQUIRED`. Roher Postgres-Text erreicht den
Browser nie (`mapDbError` loggt und wirft generisch weiter).

### 7. Siris offene Detailfrage: Admin-Kommentar im Share-Text

**Bewertung: Siris Entscheidung ist richtig, kein Finding.** `docs/SPEC.md` erwähnt Teilen
gar nicht; `ARBEITSPAKETE.md` WP6 Schritt 5 nennt als Inhalt ausdrücklich nur „Datum,
‚Aus der Kasse: …', ‚Überweisungen: …'". Die Differenz selbst steht im Text („Differenz
−20,00 € (20,00 € weniger gezählt als eingekauft)"), also fehlt im Chat keine Information
über Geld. Der Kommentar ist die interne Begründung und gehört auf die Session-Seite und ins
Audit-Log. Wenn der Planer ihn doch will, ist es eine Zeile in `resultBlock`.

---

## Findings

### F1 – [Minor] `npm run check` ist lokal rot, weil ESLint fremde Build-Artefakte mitliest

- **Wo:** `eslint.config.mjs:9-17` (`globalIgnores([".next/**", …])`), `.gitignore:16-18`
- **Beobachtet:** `npm run lint` bricht mit 445 Errors ab. **Kein einziger** stammt aus
  Projektcode – alle liegen unter
  `.claude/worktrees/agent-a71d72967abdcedec/.next/build/chunks/*.js` und
  `…/.next/types/validator.ts`. Dieses Verzeichnis ist ein liegengebliebener
  Agent-Worktree (er stammt aus einem früheren Paket, nicht aus WP6) und ist weder in
  `.gitignore` noch in den ESLint-Ignores; `git status` zeigt `?? .claude/worktrees/`.
  Das Muster `".next/**"` greift nur auf oberster Ebene, nicht auf verschachtelte
  `.next`-Ordner.
- **Erwartet:** `npm run check` ist grün (ARBEITSPAKETE.md, Projektweite Konventionen:
  „`npm run check` … muss vor jeder Übergabe grün sein"). Ein frisch geklontes Repo ist
  grün – deshalb Minor und kein Blocker: der Fehler steckt nicht im ausgelieferten Stand,
  sondern macht das Pflicht-Gate in jeder Arbeitskopie mit Worktrees unbrauchbar.
- **Reproduktion:** `npm run lint` im Projektordner. Gegenprobe:
  `npx eslint src tests scripts` → 0 Probleme.
- **Vorschlag (Planer-Entscheidung, außerhalb WP6):** `.gitignore` um `.claude/worktrees/`
  und `eslint.config.mjs` um `"**/.next/**"` sowie `".claude/**"` ergänzen. Passt gut zu
  Siris `.gitattributes`-Vorschlag in derselben Ecke.

### F2 – [Minor] Veralteter Kommentar: „the frozen settlement itself follows in WP6"

- **Wo:** `src/components/sessions/SessionDetailClient.tsx:490`
- **Beobachtet:** `/** Head of a closed session; the frozen settlement itself follows in WP6. */`
  über `ClosedNotice` – WP6 ist genau dieses Paket, die Abrechnung steht jetzt darunter.
  Der sichtbare Text darunter wurde korrekt angepasst, nur der Kommentar nicht.
- **Erwartet:** Kommentar beschreibt den Ist-Zustand (z. B. „…; die eingefrorene Abrechnung
  rendert `ClosedSessionSection`").
- **Reproduktion:** Datei öffnen, Zeile 490.

### F3 – [Minor] Block 1 „Summe" ist nicht die Kasse, wenn Bargeld liegen bleibt

- **Wo:** `src/components/settlement/SettlementView.tsx:65`, `src/lib/settlement/shareText.ts:55`
- **Beobachtet:** Die Summenzeile in „Aus der Kasse" zeigt `Σ cashFromBox`. WP6 Schritt 3
  formuliert „Summe = Kasse". Bei `unallocatedCash > 0` (TV9) sind das zwei verschiedene
  Zahlen: Summe 190,00 €, Kasse (`cashBoxAfterPayouts`) 200,00 €. Die Zeile „Bleibt in der
  Kasse: 10,00 € (Differenz)" steht direkt darunter, die Rechnung geht für den Leser also
  auf – aber das Wort „Summe" allein ist mehrdeutig, und am Tisch wird genau über solche
  Zeilen gestritten.
- **Erwartet:** Entweder Beschriftung schärfen („Bar auszuzahlen") oder bei
  `unallocatedCash > 0` zusätzlich die Kasse ausweisen. Rein sprachlich, kein falscher Cent.
- **Reproduktion:** TV9 (A: bar 100 / Stack 90; B: bar 100 / Stack 100) in der Abrechnung
  ansehen; siehe auch mein Test „TV9 — fehlende Chips bleiben als ‚Bleibt in der Kasse'
  sichtbar".

---

## Was der Planer im Browser prüfen soll

Ohne Login/Browser bleibt der letzte Meter offen. Bitte gegen die eingespielte DB:

1. **Sauberer Abschluss (Admin oder Editor).** Session mit 3 Spielern, alle Stacks
   eingetragen, Buy-ins = Stacks. Erwartet: zwei grüne Haken, Vorschau mit Wasserzeichen
   „Vorschau — so würde die Abrechnung gespeichert.", Button aktiv → Sheet → „Jetzt
   abschließen". **Danach die Zahlen der gespeicherten Abrechnung Zeile für Zeile mit einem
   Foto/Screenshot der Vorschau vergleichen** – sie müssen identisch sein (DoD).
2. **Abschluss mit Differenz.** Einen Stack um 20 € verändern.
   - Als **Editor**: Button deaktiviert, Hinweis „Nur ein Admin kann mit Differenz
     abschließen."
   - Als **Admin ohne Kommentar**: weiterhin deaktiviert, Hinweis „Bitte einen Kommentar zur
     Differenz eingeben."
   - Als **Admin mit Kommentar**: geht durch; Kopf zeigt „Abgeschlossen am … von …",
     „Differenz −20,00 €" und den Kommentar.
3. **Nach Abschluss keine Schreibaktion mehr.** Keine „Teilnehmer hinzufügen"-Schaltfläche,
   keine Tipp-Reaktion auf den Spielerkarten, keine Löschen-Symbole im Verlauf.
4. **Wieder öffnen (Admin).** Grund eingeben → Abrechnung verschwindet, Status „Offen",
   `close_note` enthält `[wieder geöffnet: …]` (mehrzeilig sichtbar). Danach erneut
   abschließen → neue Abrechnung entsteht; im Log stehen beide Vorgänge.
5. **Race.** Zwei Tabs derselben offenen Session, in beiden „Jetzt abschließen".
   Erwartet: einer erfolgreich, der andere ein deutscher Toast („Diese Session ist
   abgeschlossen …" bzw. „Die Daten haben sich geändert. Bitte noch einmal prüfen.") und
   **genau eine** Zeile in `settlements`.
6. **Kopieren-Button.** „Abrechnung kopieren" → in WhatsApp einfügen. Auf dem Handy
   zusätzlich prüfen, ob der Fallback greift (Text erscheint zum Markieren), falls die
   Zwischenablage verweigert wird.
7. **Mobile 375 px.** Session-Detail einer abgeschlossenen Session: kein horizontales
   Scrollen der Seite (die beiden Tabellen in Block 3 und im „Rechenweg" dürfen intern
   scrollen, `overflow-x-auto`), alle Tipp-Ziele ≥ 44 px, „Rechenweg" auf- und zuklappbar.
8. **Viewer.** Als Viewer eine offene Session öffnen: kein Abschluss-Bereich. Als Viewer eine
   abgeschlossene Session: Abrechnung und Kopieren-Button sichtbar, **kein** „Wieder öffnen".

---

## Nicht verifiziert

- **Kein Lauf gegen die Datenbank mit Login.** Ich habe keine Session, kein `psql`, kein
  Docker. `close_session` und `reopen_session` sind damit weiterhin nur als SQL gelesen und
  in TypeScript nachgebildet (`tests/gaby/wp1-close-session.gaby.test.ts`). Der `for
  update`-Lock, das Kaskaden-Delete beim Wieder-Öffnen und das Verhalten bei zwei
  gleichzeitigen Abschlüssen sind **logisch** belegt, nicht **ausgeführt**.
  `npm run rls:smoke` beweist nur die Kehrseite: ohne Login kommt niemand an die drei
  Settlement-Tabellen oder an die RPCs heran.
- **Kein Browser.** Vorschau vs. gespeicherte Anzeige, Bestätigungs-Sheet, Toasts,
  Clipboard-Fallback, Mobile-Layout und der Wasserzeichen-Hinweis sind nur als Code und über
  serverseitig gerendertes Markup geprüft. Punkte 1–8 oben gehören dem Planer.
- **Audit-Log-Inhalt beim Wieder-Öffnen** (alter `close_note` in `old_data`) ist aus dem
  Trigger abgeleitet, nicht gelesen; die Ansicht kommt erst in WP8.
- **Realtime bei Statuswechsel:** dass ein zweiter Tab den Abschluss innerhalb von 2 s sieht,
  hängt an der `sessions`-Subscription aus WP5 und ist hier nicht erneut geprüft worden.
