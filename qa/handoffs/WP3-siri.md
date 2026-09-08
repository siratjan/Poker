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
