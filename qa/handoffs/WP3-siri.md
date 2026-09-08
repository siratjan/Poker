# WP3 – Übergabe Siri

## Umgesetzt

- `src/lib/settlement/types.ts` – `SettlementParticipant`, `SettlementInput`, `SettlementLine`,
  `Transfer`, `SettlementResult` exakt nach `docs/SETTLEMENT.md` (Abschnitt „Ausgabe“).
- `src/lib/settlement/errors.ts` – `SettlementError` mit `code` (alle sechs Codes aus TV12) und
  optionalem `playerId`, dazu `assertAmount()` (prüft erst Ganzzahligkeit, dann Vorzeichen).
- `src/lib/settlement/distribute.ts` – `distribute(box, wants)` vollständig in BigInt: exakter
  Bruch `want_i · box / Σ wants`, `floor`, Largest-Remainder-Restverteilung, Tie-Break
  Eingabereihenfolge. Einzige Division in der Datei ist die BigInt-Division (Zeile 49).
- `src/lib/settlement/transfers.ts` – `computeTransfers(residuals)` greedy nach Schritt 5,
  liefert `{ transfers, uncoveredClaims, uncoveredDebts }`.
- `src/lib/settlement/index.ts` – `computeSettlement(participants)`: Validierung, Sortierung
  (`position` → `name` → `playerId`), Stufen 1–3, Residuen, Transfers, `algorithmVersion = 1`.
- `src/lib/settlement/format.ts` – `describeTransfer(transfer, names)` → „Can schuldet Ali 40,00 €“
  über `formatCents` aus `src/lib/money.ts`.
- `src/lib/settlement/settlement.test.ts` – TV1–TV10 als Tabellen-Test mit den exakten Cent-Werten
  aus dem Dokument (`cashTier1/2/3`, `cashFromBox`, `residual`, `transfers`, `unallocatedCash`,
  `uncoveredClaims`, `discrepancy`), TV11 und TV12 als eigene Blöcke, dazu Sortierung/Determinismus
  und `describeTransfer`.
- `src/lib/settlement/distribute.test.ts` – Grenzfälle (leer, alle wants 0, box 0, box ≥ Σ,
  Gleichstand bei Resten, Werte jenseits des Float-sicheren Bereichs, Fehlercodes) plus
  Property-Test `Σ got == min(box, Σ wants)` mit 500 Läufen.
- `src/lib/settlement/settlement.property.test.ts` – fast-check, 500 Läufe je Property, 2–10
  Teilnehmer, Beträge 0–100.000 Cent in 50-Cent-Schritten, `payout ≤ stack` und `Σ payout ≤ Kasse`:
  (a) ausgeglichene Sessions (`discrepancy = 0`) → Invarianten 1–9, (b) freie Stacks (fehlende und
  überzählige Chips) → Invarianten 1, 2, 4, 5, 6, 8, 9, (c) Determinismus und Permutation
  (Invariante 7).
- `src/lib/settlement/README.md` – Kurzanleitung mit Verweis auf `docs/SETTLEMENT.md`.
- `src/lib/settlement/.gitkeep` entfernt (Ordner enthält jetzt Code).

**Alle zwölf Testvektoren stimmen ohne Nachbesserung mit dem Dokument überein.** Ich habe TV1–TV12
vor der Implementierung von Hand nachgerechnet; kein einziger Wert weicht ab.

## Abweichungen vom Plan

- **BigInt-Literale (`0n`) sind nicht möglich**, weil `tsconfig.json` auf `target: "ES2017"` steht
  (TS2737). Gelöst mit `const ZERO = BigInt(0)` / `ONE = BigInt(1)` in `distribute.ts`; die
  Arithmetik bleibt vollständig BigInt. `tsconfig.json` habe ich bewusst **nicht** angefasst.
- `SettlementParticipant` hat `name` und `position` als **optionale** Felder. `docs/SETTLEMENT.md`
  listet in der Eingabetabelle nur `playerId`/`cashIn`/`creditIn`/`stack`/`payout`, verlangt aber
  die Sortierung nach Beitrittsreihenfolge, Name, `playerId`. Fehlt `position`, gilt die
  Array-Reihenfolge (die Eingabe kommt laut Plan bereits sortiert). Damit passt beides zusammen.
- `computeTransfers` liefert zusätzlich `uncoveredDebts`; wie in `docs/SETTLEMENT.md` gefordert
  wird der Wert **nicht** ins `SettlementResult` übernommen (der Betrag ist dort als
  `unallocatedCash` sichtbar). Der Plan nennt das Feld für die Hilfsfunktion ausdrücklich.
- `vitest.config.mts` musste **nicht** geändert werden; die vorhandene Coverage-Konfiguration
  (`include: ['src/lib/**']`) reicht.
- Fehlermeldungen (`error.message`) sind Englisch, nur die Codes sind die Schnittstelle; die
  deutsche Formulierung entsteht in der UI (WP6). Deutsche UI-Texte gibt es hier nur in
  `describeTransfer`.

## Offene Fragen an den Planer

1. **Invariante 5 in `docs/SETTLEMENT.md` ist eine Nuance zu schwach formuliert.** Sie lautet:
   „Ein Bar-Zahler mit `stack ≥ cashIn` und `payout == 0` erhält mindestens `cashIn` bar, sofern
   kein **Listen-Spieler** vorher `payout` entnommen hat.“ Die Kasse kann Stufe 1 aber auch dann
   nicht decken, wenn ein **Bar-Zahler** mehr Bargeld entnimmt, als er selbst bar eingezahlt hat.
   Gegenbeispiel (alle Vorbedingungen erfüllt, `discrepancy = 0`, kein Listen-Payout):
   A bar 100,00 / Stack 100,00 / Payout 0 · C bar 50,00 / Stack 150,00 / Payout 150,00 ·
   D Liste 100,00 / Stack 0. Kasse = 150,00 − 150,00 = 0, A bekommt 0,00 bar statt 100,00; die
   Deckung kommt korrekt als Schuld D → A 100,00 zurück. Der Algorithmus verhält sich hier genau
   wie in TV6, nur ist der Verursacher ein Bar-Zahler.
   **Ich habe nichts am Algorithmus geändert.** Der Property-Test prüft Invariante 5 mit der
   präzisen Bedingung „kein Teilnehmer hat mehr entnommen, als er selbst bar eingezahlt hat“
   (`payout ≤ cashIn` für alle), was die Dokument-Bedingung mit einschließt. Der Fall ist als
   Regressionstest festgehalten (`settlement.test.ts`, Block „invariant 5 – stage 1 depends on who
   drained the box“). Bitte entscheiden: Formulierung in `docs/SETTLEMENT.md` schärfen (mein
   Vorschlag) oder Algorithmus ändern.
2. Kein weiterer Punkt: TV1–TV12 stimmen exakt.

## Neue Abhängigkeiten

- Keine. `fast-check@^4.9.0` und `@vitest/coverage-v8@^5.0.0` waren aus WP0 bereits in
  `devDependencies`.

## Prüfung

- `npm ci` im Worktree `C:\Users\sirat\Poker_App_wp3` (Branch `wp3`): grün.
- `npm run check` (typecheck + lint + test): **grün**, 08.09.2026, 6 Testdateien / 119 Tests.
- `npm run build`: **grün** (ohne `.env.local`, WP3 ist eine reine Bibliothek).
- `npm run test:coverage`: `src/lib/settlement` **100 % Statements, 100 % Lines, 100 % Functions,
  92,85 % Branches** (die offenen Branches sind die Fallbacks `position ?? index` und `name ?? ''`).
  DoD verlangt ≥ 95 % Zeilen.
- Kein Dev-Server gestartet (reine Bibliothek, nichts im Browser zu sehen).

## So prüft man es

1. `cd C:\Users\sirat\Poker_App_wp3` (Branch `wp3`), `npm ci`.
2. `npm run check` und `npm run build` – beides muss grün sein.
3. `npm run test:coverage` – Zeile `lib/settlement` muss ≥ 95 % Lines zeigen.
4. `npx vitest run src/lib/settlement/settlement.test.ts -t "TV"` – die Testvektoren einzeln.
5. TV1–TV12 in `docs/SETTLEMENT.md` von Hand nachrechnen und mit den Zahlen **im Test**
   (`settlement.test.ts`, Array `vectors`) vergleichen – die Werte sind dort als Cent-Konstanten
   ausgeschrieben, nicht berechnet.
6. Float-Freiheit: `grep -n "/" src/lib/settlement/distribute.ts` – die einzige Division steht in
   Zeile 49 und arbeitet auf `bigint`.
7. Offene Frage 1 gegenlesen (Block „invariant 5“ in `settlement.test.ts`).

## Vorschläge (außerhalb des Pakets)

- WP6 braucht eine Abbildung `SettlementErrorCode` → deutscher Text; sinnvoll in
  `src/lib/settlement/messages.ts` oder zentral bei den Server-Action-Fehlercodes.
- Beim Einfrieren der Abrechnung (WP6) zusätzlich `algorithmVersion` und die Eingabezeilen
  speichern, damit ein späterer Algorithmus-Wechsel nachvollziehbar bleibt.
- `describeTransfer` fällt bei unbekannter `playerId` auf „Unbekannt“ zurück; falls die UI dort
  lieber gar keine Zeile zeigt, in WP6 vorher filtern.

---

## Runde 2 (Nacharbeit zu `qa/reports/WP3-gaby.md`, 08.09.2026)

Grundlage: Gabys Report (FREIGEGEBEN, 6 Minor) und die Planer-Entscheidungen. Basis war
`main` @ `271c4e1` (WP3 gemerged). `docs/SETTLEMENT.md` habe ich nur gelesen, nicht geändert.

| Finding | Was geändert |
|---|---|
| F1 | Erledigt durch den Merge nach `main`; nichts zu tun. |
| F2 | Die überholten Kommentare zur alten Invariante 5 („one cent too weak“, „Counterexample to the literal wording“) in `settlement.property.test.ts` und `settlement.test.ts` beschreiben jetzt die präzisierte Fassung (`payout_j ≤ cashIn_j` für alle j). Assertions unverändert. |
| F3 | `SettlementResult` hat jetzt `uncoveredDebts: number` (Σ verbleibende `debtor.rest` nach dem Greedy), durchgereicht aus `computeTransfers`. TV9b als elfter Eintrag im Tabellen-Test ergänzt, `uncoveredDebts` wird in **allen** Vektoren geprüft. Der irreführende Kommentar in `transfers.ts` („derselbe Betrag ist als `unallocatedCash` sichtbar“) ist korrigiert. |
| F4 | `transfers.ts` behauptete „minimal number of transfers“ – jetzt „greedy, wenige Überweisungen, deterministisch, bewusst nicht das theoretische Minimum (NP-schwer)“. Gleiche Aussage im README ergänzt. |
| F5 | `vitest.config.mts`: `coverage.include: ['src/lib/**/*.ts']` plus `exclude: ['src/lib/**/*.test.ts']`. `npm run test:coverage` läuft ohne Parse-Fehler und ohne Stacktrace. |
| F6 | `position` ist **Pflicht** (`position: number`, kein Fallback auf den Array-Index). Fehlende, nicht-ganzzahlige oder doppelte `position` → `SettlementError` mit neuem Code `INVALID_POSITION` (in `errors.ts` und im README ergänzt). Drei Tests in TV12 decken die drei Fälle ab. |

### Property-Test erweitert (F3)

`checkGeneralInvariants` prüft jetzt zusätzlich die beiden Gleichungen aus Schritt 5 – und
zwar in **jedem** Property-Test, nicht nur im neuen:

- `discrepancy < 0` → `unallocatedCash + uncoveredDebts == −discrepancy`, `uncoveredClaims == 0`
- `discrepancy > 0` → `uncoveredClaims == discrepancy`, `unallocatedCash == 0`, `uncoveredDebts == 0`
- `discrepancy == 0` → alle drei 0

Dazu zwei neue Properties:

- **Gezielte Differenz**: `buildWithDiscrepancy(seed, delta)` legt die Stacks auf
  `Σ Buy-in + delta`; `delta` kommt aus `fc.oneof` mit je einem Zweig für echt negativ und echt
  positiv, damit beide Vorzeichen sicher vorkommen (der Test prüft am Ende selbst, dass er beide
  gesehen hat – ein rein zufälliges `delta` traf `0` praktisch nie und war anfangs flaky).
- **TV9b verallgemeinert**: reine Listen-Runde mit lauter Stacks 0 → keine Transfers,
  `unallocatedCash == 0`, `uncoveredDebts == Σ creditIn`.

Je 500 Läufe wie die bestehenden Properties.

### Abweichungen in Runde 2

- **Tie-Break nach `name` und `playerId` entfernt.** Da `position` jetzt als eindeutige
  Ganzzahl validiert wird, konnten der sekundäre und tertiäre Sortierschlüssel aus
  `docs/SETTLEMENT.md` („Eingabe“) **nachweislich nie mehr** greifen: ein Gleichstand wird
  vorher als `INVALID_POSITION` abgelehnt. Der Vergleich ist deshalb `a.position - b.position`.
  Das Ergebnis ist in jedem erreichbaren Fall identisch; ich habe nur unerreichbaren Code
  entfernt (er hätte die Branch-Coverage von `index.ts` auf 70 % gedrückt). Der bisherige Test
  „breaks equal positions by name, then by playerId“ ist entsprechend durch den
  `INVALID_POSITION`-Test ersetzt, „keeps the given array order when no position is set“ durch
  „sorts by position, not by the array index“. `name` bleibt als optionales Feld erhalten
  (Aufrufer und Tests setzen es), wird aber vom Algorithmus nicht mehr gelesen. **Siehe offene
  Frage 3.**
- `computeSettlement` sortiert jetzt eine Kopie der Eingabe (`[...participants]`) statt eines
  Hilfs-Arrays; ein neuer Test hält fest, dass das Eingabe-Array unverändert bleibt.
- Negative `position` lehne ich **nicht** ab: `docs/SETTLEMENT.md` TV12 nennt nur „fehlende,
  nicht-ganzzahlige oder doppelte“. Konservativ am Dokument geblieben.

### Offene Fragen an den Planer (Runde 2)

3. **`docs/SETTLEMENT.md`, Abschnitt „Eingabe“** sagt weiterhin „sekundär Name, tertiär
   `playerId`“. Mit der Pflicht-`position` ist das unerreichbar (siehe Abweichung oben). Soll der
   Halbsatz gestrichen werden, oder soll `position` doch Gleichstände erlauben dürfen? Ich habe
   die konservative Variante gewählt: Verhalten unverändert, nur toter Code entfernt.
4. **F3 hat eine Konsequenz für WP6**, die Gaby schon nennt: `unallocatedCash` erklärt eine
   negative Differenz nicht allein. Die Anzeige braucht beide Zahlen
   („Differenz: n € Bargeld ohne Empfänger“ **und** „n € Schuld ohne Gläubiger“). Ich habe in
   WP3 nichts an der UI gebaut.

### Prüfung (Runde 2)

- `npm run check` (typecheck + lint + test): **grün**, 9 Testdateien / **205 Tests**, 970 ms.
  Zweiter Lauf identisch (Determinismus).
- `npm run test:coverage`: **grün, ohne Stacktrace**. `src/lib/settlement` steht auf
  **100 % Statements / 100 % Branches / 100 % Functions / 100 % Lines** (vorher 92,85 % Branches;
  die von Gaby genannten offenen Branches `position ?? index` und `name ?? ''` gibt es nicht mehr).
- `npm run build`: **grün**.
- `npm ci` **nicht** ausgeführt (Vorgabe des Planers); `package.json` ist unverändert, keine neuen
  Abhängigkeiten.
- **Gabys Tests unverändert.** `tests/gaby/settlement.gaby.test.ts` setzt `position` an allen drei
  Stellen (Helper `participants()` Z. 30, Permutations-Generator Z. 371, Session-Generator Z. 434),
  bricht durch die Pflicht-`position` also **nicht** – alle 22 Tests laufen weiter grün. Der
  Rückfall auf „`position` optional, Fehler nur bei Duplikaten“ war damit nicht nötig.
  `tests/gaby/wp1-schema.gaby.test.ts` habe ich nicht angefasst und nicht committet.

### So prüft man Runde 2

1. `npm run check`, `npm run test:coverage`, `npm run build` – alles grün, Coverage ohne Stacktrace.
2. `npx vitest run src/lib/settlement/settlement.test.ts -t "TV9b"` – der neue Tabellen-Eintrag.
3. `npx vitest run src/lib/settlement/settlement.test.ts -t "INVALID_POSITION"` – die drei
   Positions-Fehlerfälle.
4. `npx vitest run src/lib/settlement/settlement.property.test.ts` – die beiden Gleichungen aus
   Schritt 5 laufen in allen vier Properties mit.
5. `npx vitest run tests/gaby/settlement.gaby.test.ts` – Gabys 22 Tests, unverändert grün.
