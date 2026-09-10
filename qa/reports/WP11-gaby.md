# WP11 – Prüfbericht Gaby

**Urteil: FREIGEGEBEN** (nach Runde 2; Runde 1 war NACHARBEIT wegen F1/F2 — siehe „Runde 2“ am Ende)

Paket: Manuelle Übersteuerung der Abrechnung in der Vorschau (Worktree
`agent-a57e78849009f383c`, Branch `worktree-agent-a57e78849009f383c`, Siri-Commit
`6f07713`, Handoff `58d718b`). Geprüft gegen die verbindlichen Planer-Entscheidungen
aus der Beauftragung, `docs/SPEC.md` §6.1 und `docs/SETTLEMENT.md` „Manuelle
Übersteuerung (v1.1)“. Ein „## WP11“-Abschnitt existiert in `docs/ARBEITSPAKETE.md`
**nicht** (siehe F3); der Code verweist aber darauf.

## Durchgeführt

- `npm run check` (typecheck + lint + test): **grün**. 52 Dateien, **1092 Tests** grün
  (1069 bestehende + 23 neue Gaby-Tests), ~1,6 s. `node_modules` waren vorhanden, kein
  `npm ci` nötig.
- `npm run build`: **grün** (Next/Turbopack, 11 Routen).
- Eigene Tests: `tests/gaby/wp11-manual-settlement.gaby.test.ts` (23 Tests, grün):
  - `verifyManual`: lässt eine absichtlich unstimmige, aber wohlgeformte Abrechnung
    durch; weist Betrag 0/negativ/nicht-integer, Selbst-Transfer, Nicht-Teilnehmer
    (Zeile und Transfer), Kasse < 0, doppelte Zeile, Zeilenzahl-Mismatch, nicht-integer
    Header ab.
  - Round-Trip `toStoredRows` → `fromStoredRows` friert unstimmige manuelle Werte
    (cashFromBox 12345, freier Transfer) exakt ein und gibt sie 1:1 zurück; Automatik
    ist immer `isManual: false`.
  - Statischer SQL-Review von `0008_manual_settlement.sql`: admin-only + security
    definer, `p_note` Pflicht (< 3 → `REASON_REQUIRED`), Insert setzt `is_manual`/`true`,
    nur offene Session, keine `SETTLEMENT_INVARIANT`/keine `entries`-Neuberechnung,
    Transfer-Teilnehmerprüfung, Audit-Trigger auf beiden Zeilen-Tabellen, Grant/Revoke,
    Tabellen-Check-Constraints in 0001 unangetastet.
- Manuelle Nachrechnung Schwerpunkt 1: Die Pflicht-Testfälle TV1–TV12 liegen in
  `src/lib/settlement/settlement.test.ts` und wurden von WP11 **nicht** angefasst
  (nicht im Diff `6eea59c..6f07713`); alle grün. `verifySettlement`, `close_session`
  (RPC, dreifacher Nachrechen) und der `is_editor()`-Pfad sind unverändert.

## DoD-Abgleich

Da `docs/ARBEITSPAKETE.md` keinen WP11-Abschnitt hat, gegen die verbindlichen
Planer-Entscheidungen und die sieben Prüf-Schwerpunkte geprüft.

| Punkt | Status | Anmerkung |
|---|---|---|
| Manuell nur in Vorschau offener Session, beim Abschluss eingefroren + danach unveränderlich | ✔ | RPC prüft `status = 'open'`; abgeschlossen → `SESSION_CLOSED`. Kein Schreibpfad auf Closed. |
| Editierbar: „Aus der Kasse“ + Überweisungen | ✔ | `SettlementEditor` editiert `cashFromBox` je Spieler und Transferliste. |
| Freie Beträge/Paarungen, keine Reconciliation | ✔ | Weder Action noch RPC rechnen nach; keine Stufen-/Deckungs-Invarianten. |
| Grundintegrität serverseitig: >0, kein Selbst-Transfer, nur Teilnehmer, Integer, Kasse ≥ 0 | ✔ (mit Minor) | `verifyManual` (Server-Action) + RPC + Tabellen-Checks. Nicht-Integer bei Zeilen: siehe F2. |
| DB-Check-Constraints auf `settlement_transfers` bleiben | ✔ | `amount_cents > 0`, `from <> to` in 0001 unverändert; RPC verlässt sich darauf. |
| Manueller Modus nur Admin (UI **und** serverseitig getrennt) | ✔ | UI `canManual = isAdmin && preview` (`isAdmin(user.role)`); RPC `is_admin()`; Action `requireAdmin`. Getrennt. |
| `note` beim manuellen Abschluss Pflicht | ✔ | Zod (min 3), `ManualConfirmSheet` (Pflichtfeld), RPC `REASON_REQUIRED`. |
| Automatik-Pfad + TV1–TV12 unverändert und grün | ✔ | Kein Diff an Algorithmus/TV-Tests; alle grün. |
| Manual-Abschluss mit unstimmigen Zahlen wird gespeichert und exakt aus DB angezeigt, nie neu gerechnet | ✔ Daten / ✘ Anzeige | Round-Trip exakt (Zeilen + Transfers). Aber Aggregat-Anzeige der Kopf-Restfelder ist inkonsistent → **F1**. |
| `is_manual` gesetzt; Audit-Trigger auf `settlement_lines`/`settlement_transfers`; Werte im Log; `reopen` löscht Abrechnung | ✔ | `is_manual = true`; zwei Audit-Trigger via `audit_row_change`; `reopen_session` löscht `settlements` (Cascade). |
| Immutabilität/RLS: kein Schreibpfad auf Closed; Zeilen ohne RPC unbeschreibbar | ✔ | Nur `select` für `authenticated` auf den drei Tabellen, keine Insert/Update/Delete-Policy; Schreiben nur via SECURITY-DEFINER-RPC. |
| Integer-Cent, kein `any`, Lint sauber, UI Deutsch | ✔ | `npm run check` grün; UI-Texte deutsch. |
| Doc (SPEC/SETTLEMENT) und Code klaffen nicht auseinander | ✔ (mit Minor) | SPEC §6.1 / SETTLEMENT ergänzt und stimmig. ARBEITSPAKETE ohne WP11 → **F3**. |

## Findings

### F1 – Major: Eingefrorene Manual-Anzeige zeigt automatische Kopf-Restfelder, die den handeditierten Zeilen widersprechen
- Wo: `src/components/settlement/SettlementView.tsx:75` (Summe „Aus der Kasse“) sowie
  `:78–82`, `:111–120` (die drei „(Differenz)“-Warnungen). Herkunft der Werte:
  `src/components/settlement/SettlementEditor.tsx:230–233` (`return { ...base, ... }`
  übernimmt `cashBoxAfterPayouts`, `unallocatedCash`, `uncoveredClaims`,
  `uncoveredDebts` unverändert aus dem Automatik-Vorschlag), eingefroren durch die RPC.
- Beobachtet: In der abgeschlossenen Ansicht listet der Block „Aus der Kasse“ die
  handeditierten `cashFromBox`-Beträge je Spieler, die Zeile **„Summe“** zeigt aber
  `settlement.cashBoxAfterPayouts` – den **Automatik**-Wert (bar eingekauft − Payouts),
  nicht die Summe der editierten Zeilen. Ebenso stammen die Warnungen „Bleibt in der
  Kasse … (Differenz)“, „… Anspruch ohne Deckung“, „… Schuld ohne Gläubiger“ aus dem
  Automatik-Vorschlag. Sobald der Admin die Kasse anders verteilt (Σ `cashFromBox` ≠
  `cashBoxAfterPayouts`), stehen im eingefrorenen Bild aufaddierbare Zeilen und eine
  „Summe“, die nicht zusammenpassen, und es erscheinen ggf. sinnlose oder es
  verschwinden echte „Differenz“-Hinweise. Der Editor selbst ist ehrlich
  (`SettlementEditor.tsx:109–117` zeigt die echte Summe der Auszahlungen mit Hinweis) –
  nur die **finale** Ansicht ist widersprüchlich.
- Erwartet: Genau die vom Planer gestellte Design-Frage. Für `isManual` sollten die
  Kopf-Restfelder in der Anzeige entweder aus den editierten Zeilen berechnet
  (Summe = Σ `cashFromBox`) oder – wie der bereits ausgeblendete „Rechenweg“
  (`SettlementView.tsx:185`) – unterdrückt werden. So wie es ist, hat die Übernahme der
  Header-Restfelder aus der Automatik eine sichtbare Nebenwirkung auf die eingefrorene
  Anzeige; SPEC §6.1 verlangt „keine Reconciliation“ und bezeichnet diese Felder als
  bloße Orientierung, sie werden hier aber als maßgebliche „Summe“ und als
  „(Differenz)“-Warnung präsentiert. In einer Geld-Ansicht ist eine Summe, die nicht zu
  ihren eigenen Zeilen passt, ein echter Mangel.
- Reproduktion: Als Admin eine offene, vollständige Session → „Manuell bearbeiten“ →
  z. B. Alis „bekommt bar“ auf 0 € setzen, Rest unverändert → „Manuell abschließen“
  (Begründung) → abgeschlossene Session öffnen: Block „Aus der Kasse“ listet Zeilen, die
  in Summe ≠ der angezeigten „Summe“ (= `cashBoxAfterPayouts`) sind; die
  „(Differenz)“-Warnungen zeigen die Automatik-Reste, nicht die tatsächliche
  Handverteilung. (Datenebene in `tests/gaby/wp11-manual-settlement.gaby.test.ts`
  gezeigt: Σ editierter `cashFromBox` weicht bewusst von `cashBoxAfterPayouts` ab, beide
  landen unverändert im eingefrorenen Ergebnis.)

### F2 – Minor: Nicht-Integer bei Zeilenbeträgen wird von der RPC gerundet, nicht abgelehnt
- Wo: `supabase/migrations/0008_manual_settlement.sql:147–173` und `:197–216`
  (`jsonb_to_recordset(... integer ...)`).
- Beobachtet: Header- und Transfer-Beträge werden per `(... ->> '...')::integer`
  gecastet und würden bei „10.5“ mit einem Cast-Fehler abgewiesen. Die **Zeilen**-Beträge
  laufen über `jsonb_to_recordset` mit `integer`-Spalten; Postgres **rundet** hier einen
  gebrochenen JSON-Zahlwert auf die nächste Ganzzahl, statt ihn zu verwerfen. Ein direkter
  RPC-Aufruf mit z. B. `cashFromBox = 10.5` würde also still zu `11` gerundet.
- Erwartet: Die eigentliche Server-Grenze ist die Server-Action: `closeSessionManual`
  prüft mit Zod (`z.number().int()`) **und** `verifyManual` (`Number.isInteger`) vor dem
  RPC-Aufruf und lehnt Nicht-Integer sicher ab (in meinen Tests bestätigt). Damit greift
  die Grundintegrität serverseitig; der gespeicherte Wert bleibt in jedem Fall
  Integer-Cent, und der Manual-Pfad ist ohnehin admin-only mit frei wählbaren Beträgen.
  Das Runden statt Ablehnen im RPC-Direktpfad ist deshalb ungefährlich, aber inkonsistent
  zur Header-/Transfer-Behandlung. Hinweis, kein Blocker; live nicht prüfbar (DB nicht
  eingespielt).

### F3 – Minor: `docs/ARBEITSPAKETE.md` enthält keinen WP11-Abschnitt
- Wo: `docs/ARBEITSPAKETE.md` (endet bei WP10) vs. Code-Kommentare in
  `src/lib/settlement/verifyManual.ts:4`, `src/lib/validation/close.ts:50`,
  `src/components/settlement/SettlementEditor.tsx:12` u. a. („docs/ARBEITSPAKETE.md
  WP11, step 4/6“).
- Beobachtet: Der Code verweist mehrfach auf WP11-Schritte, die im Arbeitspaket-Dokument
  nicht existieren.
- Erwartet: `docs/ARBEITSPAKETE.md` wird vom Planer gepflegt; ein WP11-Abschnitt mit
  Implementation Plan/DoD/Testauftrag sollte dort ergänzt werden, damit Doc und Code
  nicht auseinanderklaffen. Geprüft habe ich gegen die Planer-Entscheidungen aus der
  Beauftragung. (Doc-Hoheit liegt beim Planer, daher Minor.)

## Bewertung der Design-Frage (Planer)

- Round-Trip (`toPersist`/`fromStoredRows`): **stimmig, ohne Nebenwirkung.** `isManual`
  und alle Felder werden verlustfrei geführt; `cashTier1 = cashFromBox`, `tier2/3 = 0`
  hält die Invariante `cashFromBox = Σ tiers` und der „Rechenweg“ ist ohnehin
  ausgeblendet, also unsichtbar und harmlos. `residual = claim − cashFromBox − creditIn`
  ist rein dekorativ (nur im ausgeblendeten Rechenweg), ohne Effekt auf gespeicherte
  Transfers/`netResult`.
- Eingefrorene Anzeige: **nicht ohne Nebenwirkung** – die aus der Automatik übernommenen
  Header-Restfelder (`cashBoxAfterPayouts`, `unallocatedCash`, `uncoveredClaims`,
  `uncoveredDebts`) werden in `SettlementView` als „Summe“ und „(Differenz)“-Warnungen
  angezeigt und können den handeditierten Zeilen widersprechen. Das ist F1.

## Nicht verifiziert

- **Live-DB / Migration 0008**: bewusst nur Datei, nicht eingespielt. `close_session_manual`,
  Spalte `is_manual`, die zwei Audit-Trigger und das tatsächliche Rundungs-/Ablehnverhalten
  von `jsonb_to_recordset` (F2) wurden **nur statisch** (SQL-Review) und logisch (TS-Nachbildung)
  geprüft, nicht im SQL-Editor ausgeführt. `npm run rls:smoke` entfällt laut Beauftragung.
- **Browser/UI**: Umschalter-Sichtbarkeit je Rolle, `ManualConfirmSheet`, die tatsächliche
  Darstellung von F1 im Closed-View und der Teilen-Text „(manuell bearbeitet)“ wurden aus dem
  Code gelesen, nicht im Browser abgenommen (Planer-Aufgabe). Für F1 bitte im Closed-View einer
  manuell abgeschlossenen Session prüfen, ob „Summe“ und „(Differenz)“-Warnungen zu den
  gelisteten Kasse-Zeilen passen.
- **Rolle serverseitig**: dass ein Editor den `close_session_manual`-Direktaufruf real mit
  `FORBIDDEN` erhält, ist nur aus dem SQL belegbar (DB nicht eingespielt).

## Runde 2

**Urteil Runde 2: FREIGEGEBEN**

Nachgeprüft Siri-Commit `534e062` („WP11: address Gaby round 1 (F1, F2)“) im selben
Worktree.

Durchgeführt:
- `npm run check`: grün, **1096 Tests** (1069 Basis + 27 Gaby-WP11-Tests), ~1,8 s.
- `npm run build`: grün.
- Gaby-Tests erweitert: `tests/gaby/wp11-manual-settlement.gaby.test.ts` jetzt 27 Tests
  (grün), davon 4 neue für Runde 2 (F1-Fixture + F2-SQL-Review).

- **F1: behoben ✔** — `src/components/settlement/SettlementView.tsx:41-42`:
  `cashSum = isManual ? Σ cashFromBox : cashBoxAfterPayouts`, die „Summe“ unter „Aus der
  Kasse“ nutzt `cashSum` (`:87`). Die drei „(Differenz)“-Warnungen sind bei `isManual`
  ausgeblendet (`:78`, `:120`, `:126` mit `!settlement.isManual`). Dieselbe Korrektur ist
  in `src/lib/settlement/shareText.ts` gespiegelt (Manual → Σ `cashFromBox`, keine
  Restfeld-Zeilen). Mit einer Fixture, deren Handverteilung (0 / 3000 / 1000 = 40,00 €)
  bewusst von der Automatik (`cashBoxAfterPayouts` = 200,00 €) abweicht, geprüft: der
  Teilen-Text zeigt „Summe: 40,00 €“, kein „200,00 €“, keine „Bleibt in der Kasse“/„ohne
  Deckung“/„ohne Gläubiger“-Zeile, und den Hinweis „(manuell bearbeitet)“. Gelistete
  Zeilen und Summe stimmen jetzt überein. Der Automatik-Pfad (`isManual === false`) zeigt
  weiterhin die Kasse und ihre Reste — als Regression mitgeprüft.
- **F2: behoben ✔** — `supabase/migrations/0008_manual_settlement.sql:147-189`: die
  Zeilen-Beträge werden in der Validierung als `numeric` extrahiert und per
  `<> floor(...)` auf Ganzzahligkeit geprüft; ein gebrochener Wert wird mit
  `SETTLEMENT_MISMATCH` abgelehnt statt still gerundet — konsistent zu Header/Transfer
  (Cast-Fehler). Der `insert` nutzt weiter `integer`, was nach bestandener Prüfung sicher
  ist. Statisch (SQL-Review) bestätigt; Migration bleibt bewusst nur Datei.
- **F3: nach Planer-Anweisung offen** — `docs/ARBEITSPAKETE.md` wird nicht im Worktree
  geändert (Doc-Hoheit Planer; WP11-Abschnitt liegt uncommittet auf `main`). Kein
  Nacharbeitsgrund.

Regression: TV1–TV12 und der komplette Automatik-Pfad sind unverändert (nicht im Diff
`47ac6b5..534e062`) und grün. Immutabilität/RLS, Rollen-Trennung, `is_manual`,
Audit-Trigger, `reopen` unverändert gegenüber Runde 1.

Nicht verifiziert (unverändert): Migration 0008 nur statisch geprüft (DB nicht
eingespielt); Browser/UI-Abnahme des Closed-Views und Teilen-Buttons bleibt Planer-Aufgabe.
