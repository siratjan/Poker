# WP3 – Prüfbericht Gaby

**Urteil: FREIGEGEBEN** – nach Runde 2 bestätigt.

- **Runde 1** (Commit `7180bc6`): 0 Blocker, 0 Major, 6 Minor (F1–F6).
- **Runde 2** (Commit `9087f54`): **alle sechs Findings erledigt (6 × ✔)**. Ein neuer Minor
  (**F7**) ist bei der Nacharbeit entstanden: `src/lib/settlement/README.md` behauptet noch
  einen Sortier-Fallback nach `name`/`playerId`, den es weder im Code noch in
  `docs/SETTLEMENT.md` gibt. Eine Zeile Text, kein falscher Cent → bleibt FREIGEGEBEN.

Geprüft in Runde 1 im Worktree `C:\Users\sirat\Poker_App_wp3`, Branch `wp3`, Commit `7180bc6`
(`WP3: settlement algorithm with tests`), am 08.09.2026.
Runde 2 in `C:\Users\sirat\Poker_App`, Branch `main`, Commit `9087f54`, am 08.09.2026.

Kernaussage: Ich habe **TV1–TV12 vollständig von Hand nachgerechnet** und mit den
Erwartungswerten **im Testcode** (`src/lib/settlement/settlement.test.ts`, Array `vectors`)
verglichen. **Kein einziger Wert weicht ab** – weder zwischen Test und Dokument noch zwischen
Dokument und Implementierung. Dazu habe ich 22 eigene Gegenbeispiele mit selbst hergeleiteten
Erwartungswerten geschrieben; alle bestätigen die Implementierung. Die gefundenen Punkte sind
ausnahmslos Dokument- bzw. Konfigurations-Kosmetik, kein falscher Cent.

---

## Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `npm run check` (typecheck + lint + test) – Baseline vor meinen Tests | **grün**, 6 Dateien / 119 Tests, 591 ms |
| `npx vitest run tests/gaby/settlement.gaby.test.ts` | **grün**, 22 Tests, 352 ms |
| `npm run check` (mit meinen Tests) | **grün**, 7 Dateien / **141 Tests**, 661 ms |
| `npm run test` (zweiter Lauf, Determinismus) | **grün**, 7 Dateien / 140 Tests, identisch |
| `npm run test:coverage` | **grün**, `src/lib/settlement` **100 % Stmts / 100 % Lines / 100 % Funcs / 92,85 % Branches** |
| `npm run build` | **grün** (statische Seiten, Proxy-Middleware) |
| `grep -n "/" src/lib/settlement/distribute.ts` | einzige Division: Zeile 49, beide Operanden `bigint` |

`npm ci` habe ich **nicht** ausgeführt (Auftrag des Planers: `node_modules` ist im Worktree
vorhanden). Siri berichtet `npm ci` als grün; siehe „Nicht verifiziert“.

Eigene Tests: `tests/gaby/settlement.gaby.test.ts` (22 Tests). Alle Erwartungswerte sind im
Test als Kommentar Schritt für Schritt hergeleitet (Stufe 1 / Stufe 2 / Stufe 3, Residuen,
Greedy-Transfers), damit sie ohne erneuten Programmlauf nachprüfbar bleiben.

> Hinweis zur Redlichkeit: Zwei meiner Tests sind im ersten Lauf **fehlgeschlagen**
> (`distribute(100, [30,30,30])` und ein Exaktheits-Fall). Beide Fehler lagen bei **mir** –
> ich hatte `box ≥ Σ wants` gewählt, wo `distribute` laut Dokument Schritt 1 jeden Wunsch voll
> bedient, statt zu rationieren. Nach Korrektur meiner Eingaben (nicht der Erwartungen an den
> Algorithmus) sind beide grün. Der Code war in beiden Fällen richtig.

---

## Nachrechnung TV1–TV12 (von Hand gegen den Testcode)

| TV | Dokument | Testcode `settlement.test.ts` | Handrechnung | Ergebnis |
|---|---|---|---|---|
| TV1 | Stufe1 100/100/100, Stufe2 150/50, Residuen 0 | Z. 70–77 | deckungsgleich | ✔ |
| TV2 | Stufe1 100/40, Stufe2 60, Can→Ali 40 | Z. 89–94 | deckungsgleich | ✔ |
| TV3 | Stufe1 100/50, Stufe2 50, Can→Ali 100 | Z. 107–113 | deckungsgleich | ✔ |
| TV4 | A bekommt die ganze Kasse 200, C→A 50, D→A 50 | Z. 126–132 | deckungsgleich | ✔ |
| TV5 | box 50, Stufe1 B 50, keine Transfers | Z. 144–149 | deckungsgleich | ✔ |
| TV6 | box 0, A Stufe1 0, B→A 100 | Z. 160–164 | deckungsgleich | ✔ |
| TV7 | Stufe1 A 100, Stufe2 A 100, C→A 100 | Z. 176–181 | deckungsgleich | ✔ |
| TV8 | Stufe2 66,67/66,67/66,66; F→C 33,34, F→A 33,33, F→B 33,33 | Z. 196–208 | deckungsgleich | ✔ |
| TV9 | disc −10, unallocatedCash 10, keine Transfers | Z. 219–223 | deckungsgleich | ✔ |
| TV10 | disc +10, B→A 10, uncoveredClaims 10 | Z. 234–238 | deckungsgleich | ✔ |
| TV11 | `NO_PARTICIPANTS`; Einzelspieler; Alles-Null ohne Fehler | Z. 296–326 | deckungsgleich | ✔ |
| TV12 | fünf Fehlercodes | Z. 328–397 | deckungsgleich | ✔ |

Zusätzlich geprüft und korrekt: `totalBuyIn`, `totalStack`, `cashBoxStart`,
`cashBoxAfterPayouts`, `isCashPlayer`, `claim`, `netResult` (Tests Z. 264–293).

### Rechenweg TV2 (Bar-Zahler vor Listen-Gewinner)

```
Ali bar 100,00 / Stack 200,00 · Ben bar 100,00 / Stack 40,00 · Can Liste 100,00 / Stack 60,00
cashBoxStart = 200,00 ; Σ payout = 0 ; box = 200,00
totalBuyIn = 300,00 ; totalStack = 300,00 ; discrepancy = 0
claim   = Ali 200,00 · Ben 40,00 · Can 60,00
isCash  = Ali ja · Ben ja · Can nein
Stufe 1 want1 = max(0, min(cashIn, stack) − payout)
        Ali min(100,00; 200,00) = 100,00 · Ben min(100,00; 40,00) = 40,00 · Can 0
        Σ want1 = 140,00 ≤ box 200,00  →  voll bedient, box = 60,00
Stufe 2 want2 = claim − tier1 = Ali 100,00 · Ben 0 · Can 0
        Σ want2 = 100,00 > box 60,00  →  rationieren:
        Ali = 10000 · 6000 / 10000 = 6000 Cent exakt, kein Rest
        tier2 = Ali 60,00 ; box = 0
Stufe 3 want3 = Can 60,00, box 0 → 0 ; unallocatedCash = 0
cashFromBox = Ali 160,00 · Ben 40,00 · Can 0     (Σ 200,00 = box)
residual = claim − cashFromBox − creditIn
        Ali 200,00 − 160,00 − 0      = +40,00
        Ben  40,00 −  40,00 − 0      =      0
        Can  60,00 −      0 − 100,00 = −40,00      (Σ = 0 ✔)
Transfers: Gläubiger [Ali 40,00], Schuldner [Can 40,00] → Can → Ali 40,00
```
Testcode Z. 90–94: `Ali 10000/6000/0/16000/+4000`, `Ben 4000/0/0/4000/0`,
`Can 0/0/0/0/−4000`, `transfer('Can','Ali',4000)`. **Identisch.**

### Rechenweg TV4 (Gewinner bekommt die komplette Kasse)

```
A bar 100,00 / Stack 300,00 · B bar 100,00 / Stack 0
C Liste 100,00 / Stack 50,00 · D Liste 100,00 / Stack 50,00
cashBoxStart = 200,00 ; box = 200,00
totalBuyIn = 400,00 ; totalStack = 400,00 ; discrepancy = 0
claim = A 300,00 · B 0 · C 50,00 · D 50,00
Stufe 1 want1 = A min(100,00; 300,00) = 100,00 · B min(100,00; 0) = 0 · C, D 0 (Liste)
        Σ want1 = 100,00 ≤ 200,00  →  voll, box = 100,00
Stufe 2 want2 = A 300,00 − 100,00 = 200,00 · B 0 − 0 = 0
        Σ want2 = 200,00 > box 100,00  →  A = 20000 · 10000 / 20000 = 10000 Cent, box = 0
Stufe 3 want3 = C 50,00 · D 50,00, box 0 → beide 0
cashFromBox = A 200,00 (= die ganze Kasse ✔) · B 0 · C 0 · D 0
residual = A 300,00 − 200,00 − 0 = +100,00 · B 0 · C 50,00 − 0 − 100,00 = −50,00 · D −50,00
Transfers: Gläubiger [A 100,00]; Schuldner absteigend, bei Gleichstand Eingabereihenfolge:
        C (Index 2) vor D (Index 3)  →  C → A 50,00 ; danach D → A 50,00
```
Testcode Z. 126–132: `A 10000/10000/0/20000/+10000`, `B`, `C −5000`, `D −5000`,
`[C→A 5000, D→A 5000]`. **Identisch**, inklusive der Reihenfolge C vor D.

### Rechenweg TV6 (Listen-Spieler hat die Kasse leergezogen)

```
A bar 100,00 / Stack 100,00 / payout 0 · B Liste 100,00 / Stack 100,00 / payout 100,00
Vorbedingung Σ payout ≤ Σ cashIn : 100,00 ≤ 100,00 ✔ (Grenzfall, kein Fehler)
cashBoxStart = 100,00 ; Σ payout = 100,00 ; box = 0
totalBuyIn = 200,00 ; totalStack = 200,00 ; discrepancy = 0
claim = A 100,00 − 0 = 100,00 · B 100,00 − 100,00 = 0
Stufe 1 want1 = A min(100,00; 100,00) − 0 = 100,00 · B 0 (Liste)
        Σ want1 = 100,00 > box 0  →  rationieren mit box = 0:
        share_A = 10000 · 0 / 10000 = 0, Rest 0 − 0 = 0  →  A bekommt 0
Stufe 2 want2 = A 100,00 − 0 = 100,00, box 0  →  0
Stufe 3 want3 = B 0 ; Σ = 0 ≤ box 0  →  0 ; unallocatedCash = 0
cashFromBox = A 0 · B 0
residual = A 100,00 − 0 − 0 = +100,00 · B 0 − 0 − 100,00 = −100,00
Transfers: B → A 100,00 ; uncoveredClaims = 0
```
Testcode Z. 160–164: `A 0/0/0/0/+10000`, `B 0/0/0/0/−10000`, `[B→A 10000]`. **Identisch.**

### Rechenweg TV8 (Cent-Rundung, Largest Remainder)

```
A, B, C je bar 100,00 / Stack 200,00 · D, E je bar 100,00 / Stack 0 · F Liste 100,00 / Stack 0
cashBoxStart = 500,00 ; box = 500,00 ; totalBuyIn = 600,00 = totalStack ; discrepancy = 0
claim = A, B, C je 200,00 · D, E, F je 0
Stufe 1 want1 = A, B, C je min(100,00; 200,00) = 100,00 · D, E min(100,00; 0) = 0 · F 0
        Σ want1 = 300,00 ≤ 500,00  →  voll, box = 200,00
Stufe 2 want2 = A, B, C je 200,00 − 100,00 = 100,00 ; Σ = 300,00 > box 200,00  →  rationieren
        Σ wants = 30000 Cent, box = 20000 Cent
        je Spieler: Zähler 10000 · 20000 = 200 000 000
                    200 000 000 / 30000 = 6666  (6666 · 30000 = 199 980 000)
                    Rest je 200 000 000 − 199 980 000 = 20 000  (gleich für A, B, C)
        Σ floor = 3 · 6666 = 19 998 ; verbleibender Rest = 20 000 − 19 998 = 2 Cent
        Gleicher Nachkommaanteil  →  Eingabereihenfolge entscheidet: A (+1) und B (+1)
        tier2 = A 66,67 · B 66,67 · C 66,66  (Σ 200,00) ; box = 0
Stufe 3 want3 = F 0 ; box 0 → 0 ; unallocatedCash = 0
cashFromBox = A 166,67 · B 166,67 · C 166,66 · D, E, F 0   (Σ 500,00 = box ✔)
residual = A 200,00 − 166,67 = +33,33 · B +33,33 · C 200,00 − 166,66 = +33,34
           D 0 · E 0 · F 0 − 0 − 100,00 = −100,00           (Σ = 0 ✔)
Transfers greedy, Gläubiger absteigend: C 33,34 (Index 2), dann A 33,33 (0), B 33,33 (1)
        F → C 33,34 ; F → A 33,33 ; F → B 33,33   (Σ 100,00 exakt)
```
Testcode Z. 196–208: `A .../6667/...`, `B .../6667/...`, `C .../6666/...`,
`[F→C 3334, F→A 3333, F→B 3333]`. **Identisch**, inklusive Tie-Break und Transfer-Reihenfolge.

---

## Eigene Gegenbeispiele (`tests/gaby/settlement.gaby.test.ts`, 22 Tests)

| # | Fall | Kern der Handrechnung | Ergebnis |
|---|---|---|---|
| (a1) | Drei Bar-Zahler 50 / 100 / 200, Kasse reicht | Stufe 1 250,00, Stufe 2 100,00, alle Residuen 0 | ✔ |
| (a2) | Dieselben Einsätze + Listen-Spieler, Stufe 2 knapp | Stufe 2 anteilig 90,00 / 60,00 / 0; D→A 60,00, D→B 40,00 | ✔ |
| (b1) | Frühgeher-Payout 50,00 < Anspruch 150,00 | Stufe 1 + 2 füllen ihn auf 150,00 auf, keine Transfers | ✔ |
| (b2) | Frühgeher-Payout kleiner, Kasse reicht nicht | A erhält 150,00 bar, Rest 100,00 als Schuld C→A | ✔ |
| (c) | Alle auf Liste, Kasse 0 | keine Barauszahlung, D→A 100,00 und C→A 50,00 | ✔ |
| (d) | **9 Spieler, ungerade Cent-Beträge** | Stufe 2: 6348/5555/4761 + Rest 2 an die zwei größten Reste → **6349 / 5555 / 4762**; 5 Transfers, Σ 66,68 € | ✔ |
| (e) | Permutation | **alle 120 Reihenfolgen** identisch, dazu 500 fast-check-Permutationen | ✔ |

Der 9-Spieler-Fall (d) ist der schärfste: `Σ wants = 23 334`, `box = 16 666`, drei
verschiedene Nachkommaanteile (19 842 / 7 778 / 19 048), Rest 2 Cent an P1 und P3.
Meine Handrechnung (im Test ausgeschrieben) und der Code stimmen auf den Cent überein;
`Σ cashFromBox = 233,32 €` = Kassenbestand, `Σ residual = 0`.

### Invariante 6 gezielt angegriffen

`tests/gaby/settlement.gaby.test.ts`, Block „invariant 6 under attack“:
ein bewusst breiterer Generator als der von Siri – Stacks völlig frei (fehlende **und**
überzählige Chips), Payouts bis an beide Vorbedingungen herangetrieben, **und zusätzlich eine
zufällige Reihenfolge, in der die Payouts die Kasse leeren** (genau das kann Stufe 1
aushungern). **2 000 Läufe: kein Gegenbeispiel.** Ein Listen-Spieler bekommt nie Bargeld,
solange ein Bar-Zahler offen ist.

Das ist auch strukturell zwingend: `distribute` schöpft die Kasse im Rationierungsfall **exakt**
aus (`Σ got == box`). Bleibt nach Stufe 2 noch Geld übrig, war Stufe 2 also im Fall 1 des
Dokuments („Σ wants ≤ box“) und damit vollständig bedient. Stufe 3 kann folglich nur laufen,
wenn kein Bar-Zahler mehr offen ist. Dieselbe Kette gilt zwischen Stufe 1 und 2.

Weitere 1 000 Läufe prüfen die Stufenzuordnung (kein Bar-Zahler aus Stufe 3, kein
Listen-Spieler aus Stufe 1/2) und die Kassen-Bilanz aus Invariante 2.

### Invariante 5 (präzisierte Fassung des Planers)

Ich habe die aktuelle Fassung aus `C:\Users\sirat\Poker_App\docs\SETTLEMENT.md` geprüft
(Bedingung: `payout_j ≤ cashIn_j` für **alle** j). Ergebnis:

- Der Beweis trägt: gilt `payout_j ≤ cashIn_j` für alle j, dann ist
  `box = Σ(cashIn − payout) ≥ Σ want1`, weil `want1_j ≤ cashIn_j − payout_j`; Stufe 1 wird also
  immer voll bedient. Ein Bar-Zahler mit `stack ≥ cashIn` und `payout == 0` bekommt genau
  `cashIn`. Mit 2 000 fast-check-Läufen bestätigt (eigener Test).
- Siris Property-Test (`settlement.property.test.ts` Z. 185–192) prüft **schon jetzt genau
  diese präzisierte Bedingung** (`participants.some((p) => p.payout > p.cashIn)`).
  Code und Test entsprechen der neuen Dokumentfassung – **kein Nacharbeitsbedarf**.
- Siris Regressionstest zum Gegenbeispiel (`settlement.test.ts` Z. 399–429) ist korrekt und
  bleibt sinnvoll; ich habe ihn in meiner Datei unabhängig nachgebaut und nachgerechnet.

### distribute(): Float-Freiheit und Tie-Break

- **Grep**: `grep -n "/" src/lib/settlement/distribute.ts` liefert außerhalb von Kommentaren
  genau eine Stelle, Zeile 49: `const share = numerator / totalWant;` – beide Operanden sind
  `bigint` (`numerator = BigInt(want) * boxBig`, `totalWant` per `+= BigInt(want)` aufgebaut).
  Eine erweiterte Suche über die ganze Bibliothek (`Math.round|floor|ceil`, `parseFloat`, `**`,
  `toFixed`, Division auf `number`) findet **nichts**. `Math.min`/`Math.max` in `index.ts`
  arbeiten ausschließlich auf validierten Integern.
- **Tie-Break in Eingabereihenfolge belegt** (drei Empfänger, gleiche Nachkommaanteile):
  - `distribute(88, [30,30,30]) → [30,29,29]` – ein Rest-Cent, der **erste** gewinnt.
  - `distribute(89, [30,30,30]) → [30,30,29]` – zwei Rest-Cent, die **ersten beiden** gewinnen.
  - `distribute(4, [1,1,4]) → [1,1,2]` und `distribute(4, [4,1,1]) → [3,1,0]` – drei **gleiche**
    Nachkommaanteile (je 4/6) bei **verschiedenen** Wünschen: es entscheidet die Position, nicht
    der Betrag; die Permutation kehrt die Gewinner um.
  - Gegenprobe `distribute(4, [2,1,3]) → [1,1,2]` – ein echt größerer Rest schlägt die Position.
- **Exaktheit jenseits von `Number.MAX_SAFE_INTEGER`**: `distribute(1 536 311 250,
  [1 796 508 745, 1 796 508 745])` liefert exakt `[768 155 625, 768 155 625]`, während der naive
  Float-Term `Math.floor(want * box / Σ)` bereits auf `768 155 624` abrundet (im Test mit
  `expect(naiveFloor).toBe(exactShare − 1)` festgehalten).

### Determinismus

- Voller Testlauf **zweimal** hintereinander: identisch (141 bzw. 140 Tests, alle grün).
- Eigener Test: `computeSettlement` zweimal auf dem 9-Spieler-Fixture → `toEqual` **und**
  `JSON.stringify`-Gleichheit (also auch gleiche Schlüsselreihenfolge).
- Alle **120** Permutationen von fünf Teilnehmern → identisches Ergebnis.
- Zusätzlich: `computeSettlement` mutiert die Eingabe nicht (Test mit `Object.freeze`).

---

## DoD-Abgleich

| DoD-Punkt (WP3) | Status | Anmerkung |
|---|---|---|
| Alle TV1–TV12 grün mit exakten Zahlen | ✔ | Von Hand gegen den Testcode nachgerechnet, keine Abweichung |
| Property-Tests grün | ✔ | 3 Properties × 500 Läufe (Siri) + 5 Properties × 500–2 000 Läufe (Gaby) |
| Coverage `src/lib/settlement/**` ≥ 95 % Zeilen | ✔ | **100 % Lines**, 100 % Stmts, 100 % Funcs, 92,85 % Branches |
| Keine Float-Arithmetik in `distribute` (Grep) | ✔ | Einzige Division `distribute.ts:49`, beide Operanden `bigint` |
| `npm run check` grün (projektweite Konvention) | ✔ | typecheck + lint + test, 141 Tests |
| `npm run build` grün | ✔ | |
| Implementation Plan Schritt 1–10 umgesetzt | ✔ | `types.ts`, `errors.ts`, `distribute.ts`, `transfers.ts`, `index.ts`, `format.ts`, drei Testdateien, `README.md` (25 Zeilen statt „10 Zeilen“ – unkritisch) |
| Keine neuen Abhängigkeiten | ✔ | `package.json` unverändert gegenüber WP0 |
| Geld nur Integer-Cent | ✔ | `assertAmount` erzwingt `Number.isInteger` und `≥ 0` an jeder Eingangsgröße |
| Kein `any`, strict, Lint sauber | ✔ | `npm run typecheck`/`lint` grün, kein `any` in `src/lib/settlement/**` |

---

## Findings

### F1 – [Minor] `docs/SETTLEMENT.md` im Worktree ist veraltet (Invariante 5)

- **Wo**: `C:\Users\sirat\Poker_App_wp3\docs\SETTLEMENT.md`, Invariante 5 (Zeile 156–157)
- **Beobachtet**: Der Worktree trägt noch die alte, zu schwache Fassung
  („… sofern kein **Listen-Spieler** vorher `payout` entnommen hat“). Die vom Planer
  präzisierte Fassung (Bedingung `payout_j ≤ cashIn_j` für alle j) steht nur in
  `C:\Users\sirat\Poker_App\docs\SETTLEMENT.md`. Der übrige Inhalt beider Dateien ist bis auf
  Zeilenenden (CRLF/LF) identisch – ich habe das per `diff` abgeglichen.
- **Erwartet**: Die Referenzdatei ist im Branch `wp3` dieselbe wie in `main`, sonst prüft der
  nächste Leser gegen die überholte Formulierung (WORKFLOW.md: „Nur der Planer ändert
  `docs/SETTLEMENT.md`“ – deshalb kein Auftrag an Siri).
- **Reproduktion**: `diff C:\Users\sirat\Poker_App\docs\SETTLEMENT.md C:\Users\sirat\Poker_App_wp3\docs\SETTLEMENT.md`
- **Wirkung auf das Urteil**: keine. Code und Tests entsprechen bereits der **neuen** Fassung.

### F2 – [Minor] Kommentare in Siris Tests verweisen noch auf die alte Invariante 5

- **Wo**: `src/lib/settlement/settlement.property.test.ts:181–184`,
  `src/lib/settlement/settlement.test.ts:400–404`
- **Beobachtet**: Die Kommentare bezeichnen die Dokumentfassung als „one cent too weak“ bzw.
  als „Counterexample to the literal wording of invariant 5“ und verweisen auf die offene Frage
  im Handoff. Nachdem der Planer die Invariante geschärft hat, ist das sachlich überholt: die
  Testbedingung **ist** jetzt die Dokumentbedingung.
- **Erwartet**: Kommentar auf die geltende Fassung umstellen (die Assertions bleiben, wie sie
  sind – sie sind korrekt). Rein redaktionell.
- **Reproduktion**: Dateien lesen.

### F3 – [Minor] Schritt 5 in `docs/SETTLEMENT.md`: „bereits als `unallocatedCash` sichtbar“ stimmt nicht immer

- **Wo**: `docs/SETTLEMENT.md`, Schritt 5, letzter Absatz
- **Beobachtet**: Das Dokument sagt, ein verbleibender `debtor.rest` werde „nicht als Schuld
  ausgegeben, sondern ist bereits als `unallocatedCash` sichtbar“. Gegenbeispiel (mein Test
  „absorbs an unassigned debt when chips are missing“): A bar 100,00 / Stack 50,00 und
  B Liste 100,00 / Stack 50,00 → `discrepancy = −100,00`, aber `unallocatedCash = 0`, während
  B eine **nicht zugeordnete Schuld von 100,00 €** trägt (Stufe 3 zahlt B seine 50,00 € aus,
  die Kasse ist leer, es gibt keinen Gläubiger).
- **Erwartet**: Der Algorithmus ist richtig – niemand wird falsch belastet, und der Admin muss
  eine Differenz ohnehin kommentieren. Die **Formulierung** im Dokument sollte präzisiert
  werden, und **WP6 darf `unallocatedCash` nicht als vollständige Erklärung einer negativen
  Differenz anzeigen** (sonst fehlen dem Tisch 100,00 € in der Darstellung).
- **Reproduktion**: `npx vitest run tests/gaby/settlement.gaby.test.ts -t "absorbs an unassigned debt"`

### F4 – [Minor] Schritt 5 verspricht die „minimale Anzahl“ Überweisungen – der Greedy hält das nicht

- **Wo**: `docs/SETTLEMENT.md`, Überschrift „Schritt 5 – Überweisungen (greedy, minimale Anzahl)“;
  Implementierung `src/lib/settlement/transfers.ts:27–59`
- **Beobachtet**: Der Code setzt den im Dokument **vorgeschriebenen** Greedy exakt um – das ist
  richtig. Der Greedy liefert aber nicht immer die kleinste Transferzahl. Konkreter,
  realistischer Fall (mein Test): reine Listen-Runde mit Residuen
  `+300,00 / +200,00 / +200,00 / −300,00 / −400,00` ergibt **vier** Überweisungen
  (E→A 300,00, E→B 100,00, D→B 100,00, D→C 200,00), obwohl **drei** genügen
  (D→A 300,00, E→B 200,00, E→C 200,00).
- **Erwartet**: Entweder die Klammer im Dokument entschärfen („greedy, wenige Überweisungen“)
  oder bewusst akzeptieren. Eine Algorithmusänderung wäre ein Spezifikationswechsel und
  **nicht** Sache von WP3.
- **Reproduktion**: `npx vitest run tests/gaby/settlement.gaby.test.ts -t "needs four transfers"`

### F5 – [Minor] Coverage-Lauf versucht `README.md` als Quellcode zu parsen

- **Wo**: `vitest.config.mts:17–19` (`coverage.include: ['src/lib/**']`) in Verbindung mit der
  neuen Datei `src/lib/settlement/README.md`
- **Beobachtet**: `npm run test:coverage` gibt aus:
  `Failed to parse file:///…/src/lib/settlement/README.md. Excluding it from coverage.`
  samt Stacktrace. Die Zahlen stimmen trotzdem, aber der Lauf sieht rot aus. Vor WP3 gab es
  in `src/lib/**` keine Nicht-TS-Datei, deshalb fällt es erst jetzt auf.
- **Erwartet**: `include: ['src/lib/**/*.ts']` (oder README ausschließen). Änderung liegt in
  `vitest.config.mts`, also außerhalb meines Schreibrechts – Vorschlag an Siri/den Planer.
- **Reproduktion**: `npm run test:coverage`, erste Ausgabezeilen.

### F6 – [Minor] `position` ist optional und fällt auf den Array-Index zurück

- **Wo**: `src/lib/settlement/types.ts:22`, `src/lib/settlement/index.ts:154–156`
  (`const positionA = a.participant.position ?? a.index;`)
- **Beobachtet**: Liefert ein Aufrufer `position` für **einen Teil** der Teilnehmer und lässt
  sie beim Rest weg, werden in derselben Vergleichsfunktion echte Positionen und Array-Indizes
  gemischt; die Sortierung ist dann überraschend, aber fehlerfrei still. Aus der Datenbank ist
  das nicht erreichbar (`session_players` hat `unique (session_id, position)`, die RPC
  `settlement_input` liefert `position` immer). Ein handgebautes Vorschau-Array in WP5/WP6
  könnte aber genau das tun.
- **Erwartet**: Entweder `position` verpflichtend machen oder im Typkommentar/README das
  Alles-oder-nichts ausdrücklich festhalten. Kein Bug im Sinne von WP3, Robustheitshinweis
  für WP5/WP6.
- **Reproduktion**: `computeSettlement([{playerId:'a', position:5, …}, {playerId:'b', …}])`
  sortiert `b` (Index 1) vor `a` (Position 5).

---

## Nicht verifiziert

- **`npm ci` / frische Installation.** Der Planer hat ausdrücklich vorgegeben, das vorhandene
  `node_modules` im Worktree zu benutzen. Siri berichtet `npm ci` als grün; ich habe es nicht
  selbst ausgeführt. Für eine reine TS-Bibliothek ohne neue Abhängigkeiten ist das Risiko
  gering, aber es ist nicht von mir bestätigt.
- **Verhaltensbeweis der Float-Freiheit bei realistischen Beträgen.** Ich habe gezielt gesucht
  (2 Mio. Zufallsfälle, Beträge bis 4 · 10⁹) und **keine** Eingabe gefunden, bei der eine naive
  Float-Implementierung von `distribute` ein **anderes Endergebnis** liefert als die
  BigInt-Fassung – die Largest-Remainder-Stufe repariert Ein-Cent-Fehler zuverlässig. Der
  Nachweis der Float-Freiheit ist daher **strukturell** (Grep + `bigint`-Typen), nicht
  verhaltensbasiert. Wer die BigInt-Arithmetik später gegen Floats tauscht, würde das an den
  Tests bei realistischen Beträgen **nicht** merken – nur mein Exaktheitstest jenseits von
  `Number.MAX_SAFE_INTEGER` schlägt dann an.
- **Integration mit Datenbank und UI.** WP3 ist eine reine Bibliothek; ob die RPC
  `settlement_input` (WP1) genau die Felder in der erwarteten Sortierung liefert und ob WP6 das
  Ergebnis verlustfrei einfriert, ist Gegenstand von WP5/WP6, nicht dieses Pakets.
- **Browser-/Dev-Server-Prüfung.** Entfällt: WP3 hat keine UI. Ich habe keinen Dev-Server
  gestartet. Für den Planer gibt es hier **nichts** manuell zu prüfen.
- **Branch-Coverage 92,85 %.** Die sechs offenen Branches liegen alle in
  `index.ts:154–163` (Fallbacks `position ?? index`, `name ?? ''` und eine Richtung des
  `playerId`-Vergleichs). Die DoD verlangt Zeilen-Coverage (100 % erreicht); ich habe die
  fehlenden Branches nicht künstlich abgedeckt.

---

## Empfehlung an den Planer

FREIGEGEBEN. Vor der Übernahme nach `main` empfehle ich drei kleine Schritte, keiner davon
blockierend:

1. `docs/SETTLEMENT.md` aus `main` in den Branch `wp3` übernehmen (F1) – **du** als Planer.
2. F5 (Coverage-Konfiguration) und F2 (überholte Testkommentare) bei nächster Gelegenheit an
   Siri geben; beides ist Ein-Zeilen-Arbeit und kann auch in WP6 mitlaufen.
3. F3 und F4 sind Formulierungen in `docs/SETTLEMENT.md`, über die **du** entscheidest. F3 hat
   eine Konsequenz für WP6: Bei negativer Differenz erklärt `unallocatedCash` nicht immer den
   ganzen Fehlbetrag – die Anzeige sollte das nicht behaupten.

## Runde 2 (Nachprüfung, 08.09.2026)

Grundlage: Commit `9087f54` (`WP3: uncoveredDebts, required position, review cleanups (round 2)`)
auf `main`, Siris Handoff `qa/handoffs/WP3-siri.md` Abschnitt „Runde 2", und die
Planer-Entscheidungen (F1 durch Merge erledigt; F3 → `uncoveredDebts` + TV9b +
Property-Gleichungen; F6 → `position` Pflicht mit `INVALID_POSITION`; Tie-Breaks nach
Name/`playerId` entfernt, `docs/SETTLEMENT.md` Abschnitt „Eingabe" vom Planer angepasst).

Der Commit fasst neun Dateien an, davon **keine** außerhalb von WP3:
`src/lib/settlement/{README.md,errors.ts,index.ts,transfers.ts,types.ts}`, die drei Testdateien
und `vitest.config.mts`. `docs/SETTLEMENT.md` hat Siri korrekt **nicht** angefasst.

### Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `git show --stat 9087f54` + vollständiger Diff gelesen | 9 Dateien, +349/−58, nichts außerhalb von WP3 |
| `npm run check` (Beginn der Prüfung, 17:36) | **grün**, 9 Dateien / 205 Tests, 867 ms |
| `npx vitest run src/ tests/gaby/settlement.gaby.test.ts` (WP3-Umfang, mit meinen neuen Tests) | **grün**, 6 Dateien / **121 Tests**; zweiter Lauf identisch |
| `npm run typecheck` / `npm run lint` (ganzes Repo, inkl. meiner Tests) | **grün** |
| `npm run test:coverage` | **grün, ohne Parse-Fehler und ohne Stacktrace** |
| Coverage `src/lib/settlement` (aus `coverage-summary.json`) | **100 % Stmts / 100 % Branches / 100 % Funcs / 100 % Lines** |
| `npx vitest run tests/gaby/settlement.gaby.test.ts` | **grün**, 34 Tests (22 alte unverändert + 12 neue) |
| `git diff 7486cfd HEAD -- tests/gaby/settlement.gaby.test.ts` | **leer** – meine 22 Tests aus Runde 1 sind unangetastet |

`npm ci` und `npm run build` habe ich nach Vorgabe des Planers **nicht** ausgeführt.

> **`npm run check` ist am Ende der Prüfung rot – aber nicht wegen WP3.** Um 17:36 war der
> volle Lauf grün (205 Tests). Um 17:41 schlugen 3–5 Tests in
> `tests/gaby/wp1-schema.gaby.test.ts` fehl (SQL-Prüfungen zu `search_path`, Trigger-Drops und
> der Fehlercode-Liste). Diese Datei gehört zur **parallel laufenden WP1-Nacharbeit** eines
> anderen Siri an `supabase/**`; sie ist nicht committet und wandert gerade unter meinen
> Händen. Ich habe sie auftragsgemäß weder angefasst noch bewertet. Im WP3-Umfang
> (`src/**` + `tests/gaby/settlement.gaby.test.ts`) sind **alle 121 Tests grün**, ebenso
> `typecheck` und `lint` über das ganze Repo. Der Planer sollte `npm run check` nach dem
> Abschluss von WP1 noch einmal als Ganzes sehen.

### Findings aus Runde 1

| Finding | Status | Nachweis |
|---|---|---|
| **F1** – `docs/SETTLEMENT.md` im Worktree veraltet | **✔** | Durch den Merge `271c4e1` erledigt. Es gibt nur noch eine Datei, und sie trägt die geschärfte Invariante 5 (`payout_j ≤ cashIn_j` für alle j). |
| **F2** – überholte Kommentare zur alten Invariante 5 | **✔** | `settlement.property.test.ts:189–196` und `settlement.test.ts:456–467` beschreiben jetzt die geltende Fassung; die Formulierungen „one cent too weak" und „Counterexample to the literal wording" sind weg. Die Assertions sind unverändert – genau richtig, sie waren schon korrekt. |
| **F3** – „bereits als `unallocatedCash` sichtbar" stimmt nicht immer | **✔** | Neues Pflichtfeld `SettlementResult.uncoveredDebts`, TV9b als Vektor ergänzt, `uncoveredDebts` wird in **allen** Vektoren geprüft, und die beiden Gleichungen aus Schritt 5 laufen in `checkGeneralInvariants` in **jedem** Property-Test mit. Details unten. |
| **F4** – „minimale Anzahl" Überweisungen | **✔** | `transfers.ts:27–34` und `README.md` sagen jetzt „deliberately *not* … the theoretical minimum, which would be NP-hard". `grep -rni "minimal" src/lib/settlement/ docs/SETTLEMENT.md` findet nichts mehr. Der Algorithmus ist unverändert – richtig so, mein Test „needs four transfers where three would settle the same residuals" ist weiter grün. |
| **F5** – Coverage-Lauf parst `README.md` | **✔** | `vitest.config.mts`: `include: ['src/lib/**/*.ts']`, `exclude: ['src/lib/**/*.test.ts']`. `npm run test:coverage` liefert keinen Treffer mehr auf `failed to parse`/`stack`/`README`. |
| **F6** – `position` optional mit Fallback auf den Array-Index | **✔** | `position: number` ist Pflicht; `assertPosition` (`index.ts:170–192`) wirft `INVALID_POSITION` bei fehlender, nicht-ganzzahliger und doppelter Position. Der Fallback `position ?? index` existiert nicht mehr. |

### TV9b von Hand nachgerechnet

Auftragsgemäß unabhängig vom Testcode hergeleitet und erst danach verglichen.

```
A Liste 100,00 / Stack 0 / payout 0 · B Liste 100,00 / Stack 100,00 / payout 0
cashBoxStart = Σ cashIn = 0 ; Σ payout = 0 ; box = 0
Vorbedingung Σ payout ≤ Σ cashIn : 0 ≤ 0 ✔
totalBuyIn = 200,00 ; totalStack = 100,00 ; discrepancy = 100,00 − 200,00 = −100,00
claim   = A 0 − 0 = 0 · B 100,00 − 0 = 100,00
isCash  = A nein · B nein  (cashIn = 0)
Stufe 1 want1 = 0 für beide (kein Bar-Zahler)          → tier1 = 0/0 ; box = 0
Stufe 2 want2 = 0 für beide (nur Bar-Zahler)           → tier2 = 0/0 ; box = 0
Stufe 3 want3 = A 0 · B 100,00 ; Σ = 100,00 > box 0 → rationieren mit box = 0:
        share_B = 10000 · 0 / 10000 = 0                → tier3 = 0/0 ; box = 0
unallocatedCash = 0
cashFromBox = A 0 · B 0
residual = claim − cashFromBox − creditIn
        A   0    −  0 − 100,00 = −100,00
        B 100,00 −  0 − 100,00 =       0        (Σ = −100,00 = discrepancy ✔)
Transfers: Gläubiger [] , Schuldner [A 100,00] → Schleife läuft nicht
        uncoveredClaims = 0 ; uncoveredDebts = 100,00
Gleichung Schritt 5: unallocatedCash 0 + uncoveredDebts 100,00 = 100,00 = −discrepancy ✔
```

Testcode `settlement.test.ts:240–254`: `discrepancy −10000`, `unallocatedCash 0`,
`uncoveredClaims 0`, `uncoveredDebts 10000`, `A 0/0/0/0/−10000`, `B 0/0/0/0/0`, `transfers []`.
**Identisch** – auch mit dem Dokument (`docs/SETTLEMENT.md`, TV9b). Ich habe TV9b zusätzlich als
eigenen Test in `tests/gaby/settlement.gaby.test.ts` hinterlegt
(„reports TV9b exactly as the document does"), damit die Rechnung ohne Siris Datei nachprüfbar
bleibt.

### Die beiden Gleichungen aus Schritt 5 – Beweis und Property-Test

`docs/SETTLEMENT.md`, Schritt 5, Zeilen 150–156 fordern:
`discrepancy < 0` → `unallocatedCash + uncoveredDebts == −discrepancy`;
`discrepancy > 0` → `uncoveredClaims == discrepancy`.

**Ich habe sie erst bewiesen, dann den Test dagegen gehalten.** Mit
`Σ cashFromBox = Σ cashIn − Σ payout − box` gilt

```
Σ residual = Σ(claim − cashFromBox − creditIn)
           = (Σ stack − Σ payout) − (Σ cashIn − Σ payout − box) − Σ creditIn
           = Σ stack − Σ cashIn − Σ creditIn + box
           = discrepancy + unallocatedCash
```

Der Greedy schöpft immer die kleinere Seite aus, also
`uncoveredClaims − uncoveredDebts = Σ residual = discrepancy + unallocatedCash`, und höchstens
eine der beiden Summen ist > 0. Dazu die Schlüsselbeobachtung: **bleibt nach Stufe 3 Geld in der
Kasse (`unallocatedCash > 0`), wurde jeder Wunsch voll bedient**, also `residual_i = −creditIn_i ≤ 0`
und damit `uncoveredClaims = 0`. Daraus folgen beide Dokumentgleichungen zwingend, und für
`discrepancy > 0` zusätzlich `unallocatedCash = 0` (sonst wäre `Σ residual ≤ 0 < discrepancy`).

Siris `checkGeneralInvariants` (`settlement.property.test.ts:192–205`) prüft genau diese drei
Fälle – **korrekt und vollständig**, einschließlich `uncoveredClaims == 0` bzw.
`uncoveredDebts == 0` auf der jeweils anderen Seite und aller drei Werte = 0 bei
`discrepancy == 0`. Da der Block in `checkGeneralInvariants` steht, läuft er in **allen vier**
Properties mit, nicht nur im neuen. `result.uncoveredDebts` ist außerdem in die
Ganzzahl-/Vorzeichenprüfung von Invariante 1 aufgenommen.

Die beiden neuen Properties sind sauber gebaut:
`buildWithDiscrepancy` erzwingt über `fc.oneof` je einen Zweig für echt negatives und echt
positives `delta`, und der Test prüft am Ende selbst nach, dass er **beide Vorzeichen gesehen
hat** (`seenSigns`) – genau die Selbstkontrolle, die einem Property-Test sonst fehlt. Die
Assertions lesen `result.discrepancy`, nie `delta`; das Clamping bei `Math.max(0, …)` kann den
Test also nicht stillschweigend entwerten. Die TV9b-Verallgemeinerung
(reine Listen-Runde, alle Stacks 0 → `uncoveredDebts == Σ creditIn`) habe ich von Hand
nachvollzogen: box ist 0, Stufe 3 rationiert auf 0, jeder residual ist `−creditIn_i`, es gibt
keinen Gläubiger. Stimmt.

**Eigene Gegenprobe:** Ich prüfe die Bilanz in einer anderen Formulierung als Siri – nicht per
Fallunterscheidung, sondern als eine Gleichung
`unallocatedCash + uncoveredDebts − uncoveredClaims + discrepancy == 0` plus
`min(uncoveredClaims, uncoveredDebts) == 0`. Das ist zu den beiden Dokumentgleichungen
äquivalent, benutzt aber einen unabhängigen Generator (cashIn/creditIn/stack frei gewürfelt,
1–6 Spieler). **2 000 Läufe, kein Gegenbeispiel**; der Test weist selbst nach, dass er beide
Vorzeichen der Differenz getroffen hat.

### F6 nachgeprüft: `position` und der entfernte Tie-Break

Der Kern von F6 war das **stille** Mischen echter Positionen mit Array-Indizes. Genau dieser
Aufruf wird jetzt abgelehnt (mein Test „rejects a partially filled position instead of mixing it
with the index"): `{playerId:'a', position:5}, {playerId:'b'}` wirft `INVALID_POSITION` mit
`playerId: 'b'`, statt `b` vor `a` zu sortieren. Damit ist der Robustheitshinweis für WP5/WP6
erledigt – ein handgebautes Vorschau-Array **muss** die Reihenfolge jetzt aussprechen.

Das Entfernen des sekundären/tertiären Tie-Breaks habe ich gegengeprüft und halte es für
**richtig**: `position` wird als eindeutige Ganzzahl validiert, bevor sortiert wird, also ist
`a.position - b.position` eine totale Ordnung und der Vergleich nach `name`/`playerId` war
nachweislich unerreichbar. Das Ergebnis ändert sich in **keinem** erreichbaren Fall — meine
Permutationstests aus Runde 1 (alle 120 Reihenfolgen + 500 fast-check-Permutationen) sind
unverändert grün. Der Planer hat `docs/SETTLEMENT.md` Abschnitt „Eingabe" entsprechend auf
„Weitere Sortierschlüssel gibt es nicht" gesetzt; Code und Dokument decken sich.

Angriffe, die ich zusätzlich gefahren habe (alle als Test hinterlegt): `NaN` und `Infinity` als
`position` (beide `INVALID_POSITION` – `Number.isInteger` fängt sie), Kollision an dritter
Stelle (der Fehler nennt den **zweiten** Träger `c`, nicht `a`), Positionen mit Lücken
(`10, 2, 7` → sortiert `b, c, a`; wichtig, weil `session_players` nach dem Entfernen eines
Spielers Lücken hat) und eine negative `position`, die bewusst **erlaubt** bleibt.

### Coverage: eine Lesefalle, kein Fehler

`npm run test:coverage` läuft sauber (F5 ✔), aber die **Textausgabe zeigt die Zeile
`lib/settlement` gar nicht mehr**. Das ist kein Rückschritt, sondern eine Folge des Erfolgs:
der Text-Reporter blendet Einträge aus, die in **allen vier** Metriken auf 100 % stehen. In
Runde 1 standen die Branches auf 92,85 %, deshalb war die Zeile sichtbar. Ich habe das
verifiziert – mit der **alten** Konfiguration (`include: ['src/lib/**']`) fehlt die Zeile
genauso, es liegt also nicht an Siris Änderung – und die Zahlen stattdessen aus
`coverage-summary.json` gelesen:

```
distribute.ts  100 / 100 / 100 / 100      index.ts      100 / 100 / 100 / 100
errors.ts      100 / 100 / 100 / 100      transfers.ts  100 / 100 / 100 / 100
format.ts      100 / 100 / 100 / 100      types.ts      100 / 100 / 100 / 100
                                          (Stmts / Branches / Funcs / Lines)
```

Die DoD (≥ 95 % Zeilen) ist mit **100 %** erfüllt, und die 92,85 % Branches aus Runde 1 sind auf
**100 %** gestiegen. **Hinweis für den Planer:** Wer die DoD künftig am Terminal abliest, findet
die Zeile nicht mehr und könnte das für einen Rückschritt halten – die belastbare Quelle ist
`npx vitest run --coverage --coverage.reporter=json-summary`.

### Neues Finding

#### F7 – [Minor] `README.md` verspricht einen Sortier-Fallback, den es nicht mehr gibt

- **Wo**: `src/lib/settlement/README.md:22`
- **Beobachtet**: „`position` … **Pflicht** … einen Rückfall auf den Array-Index gibt es nicht.
  **Danach wird sekundär nach `name`, tertiär nach `playerId` sortiert.**" Der zweite Satz ist
  in Runde 2 falsch geworden: `validateAndSort` sortiert nur noch nach `a.position - b.position`,
  `docs/SETTLEMENT.md` („Eingabe") sagt ausdrücklich „Weitere Sortierschlüssel gibt es nicht",
  und Siris eigener Kommentar in `types.ts:13–15` erklärt, dass `name` von der Berechnung gar
  nicht mehr gelesen wird (`grep "\.name" src/lib/settlement/*.ts` findet nur
  `SettlementError.name`). Die drei Aussagen widersprechen sich.
- **Erwartet**: Den Halbsatz streichen (der Absatz stimmt sonst). Das README ist das erste, was
  ein WP5/WP6-Entwickler liest; es darf der Spezifikation nicht widersprechen. Nebenbei: der
  Kommentar in `types.ts:13–15` verweist auf „the secondary sort key of `docs/SETTLEMENT.md`" –
  den gibt es dort seit der Planer-Anpassung nicht mehr.
- **Reproduktion**: `sed -n '20,23p' src/lib/settlement/README.md` gegen
  `docs/SETTLEMENT.md`, Abschnitt „Eingabe", letzter Absatz.
- **Wirkung auf das Urteil**: keine. Reine Dokumentation, kein falscher Cent.

### Meine Tests

`tests/gaby/settlement.gaby.test.ts` ist von **22 auf 34 Tests** gewachsen. Die 22 aus Runde 1
sind **byte-identisch** unverändert (`git diff 7486cfd HEAD` auf die Datei ist leer) und alle
grün – Siris Pflicht-`position` bricht sie nicht, weil ich `position` von Anfang an überall
gesetzt hatte. Neu sind zwölf Tests in zwei Blöcken:

- **(f) `uncoveredDebts`**: TV9b eigenständig nachgerechnet; mein F3-Gegenbeispiel, jetzt mit
  sichtbarer Schuld; **der Fall, in dem `unallocatedCash` *und* `uncoveredDebts` gleichzeitig
  > 0 sind** (A bar 100,00/Stack 50,00 · B Liste 100,00/Stack 20,00 → `discrepancy −130,00`,
  `unallocatedCash 30,00`, `uncoveredDebts 100,00`) – der Test hält ausdrücklich fest, dass
  **keine der beiden Zahlen die Differenz allein erklärt**; die Gegenrichtung
  (`discrepancy > 0` → `uncoveredDebts == 0`); und die Bilanz-Property über 2 000 Läufe.
- **(g) `INVALID_POSITION`**: die sechs oben beschriebenen Angriffe.

> Hinweis zur Redlichkeit: Zwei meiner neuen Assertions sind im ersten Lauf fehlgeschlagen,
> **beide Male lag der Fehler bei mir**. (1) `expect(x).toBe(-result.discrepancy)` vergleicht mit
> `Object.is`, und bei `discrepancy === 0` ist `-0 !== 0`; ich habe die Gleichung als Summe
> umgeschrieben, statt die Erwartung abzuschwächen. (2) Meine Vorzeichen-Selbstkontrolle
> verlangte auch `discrepancy === 0`, was bei frei gewürfelten Beträgen praktisch nie eintritt;
> ich prüfe jetzt beide **von null verschiedenen** Vorzeichen, der ausgeglichene Fall ist durch
> die Blöcke (a)–(e) reichlich abgedeckt. **Der Code war in beiden Fällen richtig.**

### Nicht verifiziert (Runde 2)

- **`npm ci` und `npm run build`** – vom Planer ausdrücklich ausgenommen. `package.json` ist
  unverändert, es kommen keine Abhängigkeiten dazu; Siri berichtet beides als grün.
- **`npm run check` als Ganzes.** Zu Beginn meiner Prüfung grün (205 Tests); am Ende rot **allein**
  wegen `tests/gaby/wp1-schema.gaby.test.ts` aus der parallelen WP1-Nacharbeit, die ich
  auftragsgemäß nicht bewerte. `typecheck`, `lint` und der komplette WP3-Umfang sind grün. Der
  Planer muss `npm run check` nach WP1 noch einmal als Ganzes sehen.
- **WP1-Änderungen** (`supabase/**`, `scripts/**`, `src/lib/database.types.ts`,
  `qa/handoffs/WP1-siri.md`, `qa/reports/WP1-gaby.md`, `tests/gaby/wp1-schema.gaby.test.ts`) und
  die **unversionierten Änderungen an `docs/SETTLEMENT.md`** – nicht angefasst, nicht bewertet.
- **Integration mit UI/DB** – unverändert Sache von WP5/WP6. WP3 hat keine UI, es gibt für den
  Planer **nichts** manuell im Browser zu prüfen.

### Empfehlung an den Planer

**FREIGEGEBEN.** Die Nacharbeit ist sauber: Siri hat alle sechs Punkte erledigt, ohne am
Algorithmus zu drehen, und der Umbau auf die Pflicht-`position` ist eine echte Verbesserung
statt einer Beruhigungspille. Offen bleiben drei kleine Dinge, keines blockierend:

1. **F7** an Siri geben – ein Halbsatz in `src/lib/settlement/README.md:22` (und der Verweis in
   `types.ts:13–15`). Kann in WP6 mitlaufen.
2. Siris **offene Frage 3** ist mit deiner Anpassung von „Eingabe" bereits beantwortet; ich habe
   das Entfernen des Tie-Breaks gegengeprüft und bestätige es als verhaltensneutral.
3. **Für WP6 vormerken** (Siris offene Frage 4, mein F3): Eine negative Differenz braucht in der
   Anzeige **beide** Zahlen – „n € Bargeld ohne Empfänger" (`unallocatedCash`) **und** „n €
   Schuld ohne Gläubiger" (`uncoveredDebts`). Mein Test „splits a negative discrepancy over
   unallocatedCash and uncoveredDebts" liefert dafür einen konkreten Fall, in dem beide Zahlen
   gleichzeitig ungleich null sind.
