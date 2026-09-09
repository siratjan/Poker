# WP6 – Übergabe Siri

Session abschließen, wieder öffnen, Abrechnung anzeigen.
Umgesetzt im isolierten Worktree auf dem Branch `agent-a251bed28588fb2b2` (nicht gepusht,
`main` nicht angefasst).

## Umgesetzt

**Server Actions – `src/actions/close.ts`**

- `previewSettlement({ sessionId })` – liest `settlement_input`, liefert Checkliste
  (`canClose`, `missingCashOuts[]`, `participantCount`), Namen, Summen, Differenz und die
  Abrechnung, die *jetzt* eingefroren würde. Nur Login nötig (`requireUser`), damit auch ein
  Viewer die Vorschau sehen kann; geschrieben wird hier nichts.
- `closeSession({ sessionId, note })` – `requireEditor`, zod, dann:
  1. `settlement_input` lesen (RPC, `security invoker` → RLS gilt),
  2. `computeSettlement` **serverseitig** aus diesen Zeilen,
  3. `verifySettlement()` (siehe unten),
  4. Differenz ⇒ Admin **und** Kommentar ≥ 3 Zeichen, sonst `DISCREPANCY_REQUIRES_ADMIN_NOTE`,
  5. RPC `close_session(p_session_id, p_settlement, p_note)`.
  **Kein einziger Wert aus dem Browser landet in `p_settlement`** – der Client schickt nur die
  Session-Id und (bei Differenz) den Kommentar. Ein mitgeschicktes Ergebnis wird ignoriert; genau
  das prüft `close.test.ts` („reicht kein vom Client geliefertes Ergebnis durch“).
- `reopenSession({ sessionId, reason })` – `requireAdmin`, Grund Pflicht (3–300 Zeichen),
  RPC `reopen_session`.
- Fehlercodes werden über `translateDbError` deutsch: `MISSING_CASH_OUT` (mit Namen der
  fehlenden Spieler), `DISCREPANCY_REQUIRES_ADMIN_NOTE`, `SETTLEMENT_MISMATCH`
  („Die Daten haben sich geändert. Bitte noch einmal prüfen.“), `SETTLEMENT_INVARIANT`,
  `SESSION_CLOSED`, `SESSION_NOT_CLOSED`, `REASON_REQUIRED`.
- `src/lib/validation/close.ts` – zod-Schemas, `MIN_NOTE_LENGTH = 3`, `MAX_NOTE_LENGTH = 300`.

**Sicherheitskritisch – `src/lib/settlement/verify.ts` (neu, 26 Tests)**

`verifySettlement(settlement)` prüft die fertige Abrechnung unabhängig gegen **alle** Invarianten
aus `docs/SETTLEMENT.md`, bevor die RPC gerufen wird, und rechnet dazu die **Stufen 1–3 mit
`distribute()` neu** nach. Damit sind genau die beiden Lücken geschlossen, die
`tests/gaby/wp1-close-session.gaby.test.ts` als „bekannte Restlücken“ dokumentiert:

| Lücke der DB | Prüfung hier | Test |
|---|---|---|
| Stufe-1-Kürzung nicht anteilig (Invariante 5) | `TIER1_NOT_PROPORTIONAL` | „Invariante 5: Stufe 1 einseitig statt anteilig bedient“ |
| Deckung je Schuldner in den Transfers | `DEBTOR_OVERPAYS` / `CREDITOR_OVERPAID` | „Deckung je Schuldner: einer zahlt für den anderen mit“ |

Zusätzlich abgedeckt: Kopfzahlen gegen die Zeilen, Invariante 2 (Kasse geht auf), 4 (nie mehr als
der Anspruch), 6 („Bar zuerst“, auch als falsch beschriftete Stufe), 8/9 (Richtung, Betrag > 0,
kein Selbst-Transfer, Σ = min(pos, neg)), die drei Differenz-Gleichungen, Integer/Vorzeichen,
doppelte Spieler. Bei einem Verstoß wird **nicht** geschrieben, sondern geloggt und
`SETTLEMENT_INVARIANT` gemeldet – eine abgeschlossene Session lässt sich nie korrigieren.
Gegenprobe „kein Fehlalarm“: alle Pflichtfälle TV1–TV11 plus 1000 zufällige Sessions gehen durch.

**Mapping – `src/lib/settlement/toPersist.ts` + `toPersist.test.ts`**

`toSettlementPayload` / `fromSettlementPayload` (Result ↔ RPC-JSON) und `fromStoredRows` /
`toStoredRows` (Result ↔ `settlements` / `settlement_lines` / `settlement_transfers`). Beide
Runden sind für TV1, TV2, TV5, TV8, TV9, TV9b, TV10 verlustfrei getestet, dazu: JSON-Roundtrip
(so geht es wirklich nach Postgres), exakte Schlüsselmengen, keine Alias-Arrays, Sortierung nach
gespeicherter `position` statt Array-Index, jede Geldspalte einzeln, und eine gespeicherte
`algorithm_version`, die dieser Build gar nicht mehr erzeugt (99) bleibt erhalten.
Dafür gibt es `FrozenSettlement` in `types.ts` = `SettlementResult` mit `algorithmVersion: number`.

**Anzeige – `src/components/settlement/SettlementView.tsx`**

- Block 1 „Aus der Kasse“: je Spieler mit `cashFromBox > 0` „Ali bekommt 250,00 € bar“, Summe;
  bei `unallocatedCash > 0` „Bleibt in der Kasse: 10,00 € (Differenz)“.
- Block 2 „Überweisungen“: „Can → Ali 40,00 €“ groß, Summe; leer → „Keine Schulden, alles bar
  erledigt.“; `uncoveredClaims` / `uncoveredDebts` als rote Hinweise (bei TV9b sind
  `unallocatedCash` und `uncoveredDebts` beide sichtbar).
- Block 3 „Ergebnis des Abends“: Tabelle bar / Liste / Stack / Auszahlung / Plus-Minus farbig,
  sortiert nach Plus-Minus absteigend, darunter der Differenz-Hinweis im Klartext.
- Aufklappbar „Rechenweg“: Kasse zu Beginn / nach Auszahlungen, Buy-ins vs. Stacks, und je
  Spieler Anspruch · Stufe 1 · Stufe 2 · Stufe 3 · offen.
- Rein darstellend: die Komponente rechnet **nichts**, sie zeigt, was sie bekommt.

**Abschluss-Bereich – `src/components/sessions/CloseSessionPanel.tsx`** (offen, Editor+)

Checkliste („Alle Spieler haben einen Stack (5/5)“ / „Buy-ins 800,00 € = Stacks 800,00 €“ bzw.
rot „Differenz −20,00 €: 20,00 € weniger gezählt als eingekauft“), Vorschau über dieselbe
`SettlementView` mit Wasserzeichen, bei Differenz Pflichtfeld für den Admin bzw. Hinweis „Nur ein
Admin kann mit Differenz abschließen“ für den Editor, Button, und ein Bestätigungs-Sheet
(„Danach kann nichts mehr geändert werden. Nur ein Admin kann wieder öffnen.“). Das Sheet holt
sich vor der Bestätigung die **Server**-Vorschau (`previewSettlement`) – was dort steht, ist das,
was gespeichert wird.

**Abgeschlossene Session – `src/components/sessions/ClosedSessionSection.tsx`**

`SettlementView` aus den **gespeicherten** Zeilen (`getSessionDetail` lädt `settlements`,
`settlement_lines`, `settlement_transfers`; `SessionDetail.hasSettlement: boolean` wurde durch
`settlement: FrozenSettlement | null` ersetzt), darunter „Abrechnung kopieren“ und für Admins
„Wieder öffnen“ mit Pflichtgrund. Der Platzhaltersatz aus WP5 („erscheint mit dem nächsten
Arbeitspaket“) ist weg.

**Teilen – `CopySettlementButton.tsx` + `src/lib/settlement/shareText.ts`**

`buildShareText` erzeugt reinen Text (Datum, Name, die drei Blöcke) für WhatsApp;
`navigator.clipboard.writeText` → Fallback verstecktes Textarea + `execCommand('copy')` →
letzter Ausweg: Text erscheint zum Markieren. `shareText.test.ts` prüft TV2, TV4, TV8, TV9, TV9b,
TV10 **wortwörtlich** gegen die Handrechnung, dazu unbekannte Namen, leerer Session-Name und
„kein Markup, kein Tab“.

**Verdrahtung**

- `src/app/(app)/sessions/[id]/page.tsx` reicht `isAdmin` durch.
- `SessionDetailClient` baut die Namenstabelle und rendert je nach Status den Abschluss-Bereich
  oder die gespeicherte Abrechnung. Nach Abschluss bleibt `mayAct = canEdit && isOpen` – jede
  Schreibaktion ist aus der UI verschwunden.
- `formatSignedCents` ist von `src/lib/session/labels.ts` nach `src/lib/money.ts` gewandert
  (Abrechnung und Share-Text brauchen es; `labels.ts` re-exportiert es, alle bisherigen
  Importstellen bleiben unverändert).

## Abweichungen vom Plan

- **Die Vorschau im Abschluss-Bereich rechnet der Browser** aus den ohnehin geladenen Einträgen,
  damit sie bei jedem Buy-in live mitläuft. Der Plan nennt dafür `previewSettlement`; diese Action
  gibt es, sie liefert die **Server**-Zahlen und wird im Bestätigungs-Sheet aufgerufen, direkt
  bevor abgeschlossen wird. Gespeichert wird ausschließlich, was `closeSession` selbst rechnet.
- **`verify.ts` ist zusätzlich** zum Plan (Schritt 1 verlangt es nicht namentlich, der Testauftrag
  aber inhaltlich). Ohne diese Datei wäre die Action gegen die zwei DB-Lücken wehrlos.
- **`SessionDetail.hasSettlement` wurde ersetzt** statt ergänzt – ein Flag ohne Daten hätte einen
  zweiten Ladepfad gebraucht. Schlägt das Laden der Zeilen fehl, meldet der Screen einen Fehler,
  statt eine halbe Abrechnung zu zeigen.
- **Kein `SettlementView` im Bestätigungs-Sheet**, nur die Kennzahlen (Teilnehmer, Buy-ins,
  Stacks, Differenz, Anzahl Überweisungen, Kommentar). Die vollständige Vorschau steht zwei
  Zentimeter darüber auf derselben Seite; sie im Sheet zu wiederholen macht es auf 375 px
  unbenutzbar lang.

## Offene Fragen an den Planer

- Keine blockierenden. Eine Kleinigkeit zur Entscheidung: Der Share-Text nennt bei einer Differenz
  die Differenz, aber **nicht** den Admin-Kommentar. Ich halte das für richtig (der Kommentar ist
  intern, im Chat steht sonst „Chip verloren“ ohne Kontext) – falls er mit rein soll, ist es eine
  Zeile in `buildShareText`.

## Neue Abhängigkeiten

- Keine.

## Prüfung

- `npm run check` (typecheck + lint + test): **grün** – 36 Testdateien, **752 Tests**
  (2026-09-09, vorher 670 in WP5; +82 aus `toPersist.test.ts` 15, `shareText.test.ts` 13,
  `verify.test.ts` 26, `close.test.ts` 23, plus die Property-Läufe).
- `npm run build`: **grün** – `/sessions/[id]` weiterhin dynamisch (ƒ).
- Gabys Tests unter `tests/gaby/**`: unverändert, alle grün (`git status` zeigt dort nichts).
- **Nicht verifiziert:** kein Lauf gegen die echte Datenbank und kein Browser. Abschließen,
  Wieder-Öffnen, das Verhalten bei zwei gleichzeitigen Abschlüssen und der Clipboard-Fallback auf
  dem Handy sind nur durch Unit-Tests mit gemocktem Supabase-Client abgedeckt.

### Hinweis zum Worktree (Zeilenenden)

`core.autocrlf=true` hat beim Auschecken dieses Worktrees alle Dateien mit CRLF materialisiert.
Drei von Gabys SQL-Textprüfungen in `tests/gaby/wp1-schema.gaby.test.ts` erwarten `\n` und sind
deshalb **im Worktree** fehlgeschlagen – nicht wegen einer Codeänderung. Ich habe die
Arbeitskopie wieder auf LF normalisiert (das ist exakt der Inhalt der Blobs, `git diff` zeigt für
diese Dateien nichts, im Commit landet davon nichts). **Vorschlag unten:** eine `.gitattributes`
würde das dauerhaft verhindern.
Außerdem hatte der Worktree kein eigenes `node_modules` – für `npm run build` (Turbopack findet
`next` nur unterhalb des Workspace-Roots) habe ich dort `npm install` ausgeführt.

## So prüft man es

1. `npm run check`, `npm run build`.
2. **Der Kern**: `npx vitest run src/actions/close.test.ts src/lib/settlement/verify.test.ts` –
   besonders „die Abrechnung kommt immer vom Server“ (ein manipuliertes Client-Ergebnis wird
   verworfen, `p_settlement` ist exakt das serverseitig gerechnete) und „die Lücken, die
   `close_session` offen lässt“.
3. Code-Review „nie neu berechnen“: `grep -rn "computeSettlement(" src/ | grep -v test` –
   **aufgerufen** wird die Funktion nur in `src/actions/close.ts` (Abschluss und Server-Vorschau),
   `src/lib/session/derive.ts` (Auszahlungs-Vorschau offener Sessions, WP5) und
   `src/components/sessions/CloseSessionPanel.tsx` (Live-Vorschau vor dem Abschluss); die übrigen
   Treffer sind Kommentare. `SettlementView.tsx` und `ClosedSessionSection.tsx` rufen sie
   **nicht** – die abgeschlossene Ansicht kommt ausschließlich aus `fromStoredRows`.
4. Manipuliertes Fixture: in `toPersist.test.ts` eine gespeicherte Zeile ändern und prüfen, dass
   `fromStoredRows` genau diesen (falschen) Wert zeigt – die Anzeige korrigiert nichts.
5. `npx vitest run src/lib/settlement/shareText.test.ts` – TV2 und TV4 stehen dort als
   vollständiger Text.
6. Browser (Planer, gegen die eingespielte DB):
   - Offene Session mit 3 Spielern, alle Stacks eintragen → Abschluss-Bereich zeigt zwei grüne
     Haken und die Vorschau; „Session abschließen“ → Sheet → „Jetzt abschließen“.
   - Danach: keine Buttons mehr an den Karten und im Verlauf, stattdessen die Abrechnung.
     Die Zahlen müssen **identisch** zur Vorschau sein.
   - Einen Stack absichtlich um 20 € verändern und als **Editor** abschließen wollen → Button
     deaktiviert, Hinweis „Nur ein Admin kann mit Differenz abschließen“. Als **Admin** ohne
     Kommentar → weiterhin deaktiviert; mit Kommentar → geht, Kopf zeigt Differenz + Kommentar.
   - „Abrechnung kopieren“ → in WhatsApp einfügen.
   - Als Admin „Wieder öffnen“ mit Grund → Abrechnung verschwindet, Session ist offen, im
     `close_note` steht `[wieder geöffnet: …]`; erneut abschließen erzeugt eine neue Abrechnung.
   - Race: zwei Tabs, in beiden abschließen → der zweite bekommt einen deutschen Toast
     (`SESSION_CLOSED` bzw. `SETTLEMENT_MISMATCH`), kein Duplikat.

## Vorschläge (außerhalb des Pakets)

- `.gitattributes` mit `* text=auto eol=lf` (und `*.sql text eol=lf`), damit Gabys
  SQL-Textprüfungen unabhängig von `core.autocrlf` und vom Checkout-Weg laufen.
- WP7 kann `fromStoredRows` direkt weiterverwenden: `settlement_lines` ist die Quelle der
  Spielerbilanzen.
- WP8: im Log ließe sich „hat Session vom 12.09. abgeschlossen (Differenz −20,00 €)“ aus
  `sessions.discrepancy_cents` bauen.
- Die drei Kacheln „Kasse aktuell“ / „Stacks gezählt“ und die Checkliste zeigen teils dasselbe;
  in WP9 (Polish) könnte man den Kopf einer abgeschlossenen Session verschlanken.
