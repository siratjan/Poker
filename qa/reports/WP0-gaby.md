# WP0 – Prüfbericht Gaby

**Urteil: FREIGEGEBEN** (Runde 2, geprüfter Stand Commit `49bc81f`) – mit zwei Hinweisen, die keine Nacharbeit auslösen.

Runde 1 (Commit `9eb77db`) endete mit **NACHARBEIT**: ein Major (F1), fünf Minor (F2–F6), kein
Blocker, kein Fund mit falschem Geld. Siri hat F1, F3, F4 und F5 in Commit `49bc81f` behoben; F2
und F6 hat der Planer bewusst nach WP5 bzw. WP2 verschoben und sie zählen hier nicht als offen.
Alle vier bearbeiteten Findings sind nachgeprüft und geschlossen – Einzelheiten unten unter
„Runde 2".
Umgebung: Windows 11, Node v24.14.1, npm 11.11.0.

_Alles bis zum Abschnitt „Runde 2" ist der unveränderte Bericht aus Runde 1._

## Durchgeführt

| Befehl | Ergebnis | Dauer |
|---|---|---|
| `npm ci` (frische Installation, `.next` vorher gelöscht) | **grün** – 413 Pakete, 0 vulnerabilities | 14 s |
| `npm run check` (Stand Siri) | **grün** – typegen ok, ESLint ohne Befund, 24 Tests in 1 Datei | 27 s |
| `npm run build` | **grün** – `/` und `/_not-found` statisch, `Proxy (Middleware)` aktiv | 9 s |
| `npx tsc --noEmit` **ohne** vorherigen `next typegen`, `.next` gelöscht | **rot** – `src/app/layout.tsx(15,50): error TS2304: Cannot find name 'LayoutProps'` (bestätigt Siris Abweichung 1) | – |
| `npm run check` (mit meinen Tests) | **grün** – 62 Tests in 2 Dateien | 5 s |
| `npx vitest run --coverage` | läuft; `src/lib/money.ts` 98,24 % Statements, 100 % Functions, 100 % Lines | – |
| `git status --short` | nur `M docs/ARBEITSPAKETE.md` (Änderung des Planers, WP2 Schritt 3) und meine neue Testdatei. Keine `.env.local`, kein `node_modules`, kein `.next` | – |
| `git check-ignore -v .env.local` | `.gitignore:34:.env*` → erfasst | – |

**Eigene Tests**: `tests/gaby/money.gaby.test.ts` – 38 Tests, grün. Deckt ab:
mehr als zwei Nachkommastellen (`100,555`, `0,001`, `1.000,001`, `1.234.567,891` → `null`),
Whitespace (`" 100 "`, Tab/Newline, geschütztes Leerzeichen U+00A0 → `10000`),
lange Gruppierungen (`"1.234.567,89"` → `123456789`, `"100.000.000,00"` → `10000000000`),
Angriffseingaben (Whitespace **im** Betrag, arabisch-indische und vollbreite Ziffern,
`1e3` / `0x10` / `Infinity` / `1_000` / `+100`, Währungszeichen, hängende und doppelte
Trennzeichen, kaputte Tausendergruppen), führende Nullen, Safe-Integer-Grenze
(`"90071992547409,91"` → `MAX_SAFE_INTEGER`, `"90071992547409,92"` → `null`), Reinheit,
`formatCents` inklusive `-0`, sowie ein verlustfreier Roundtrip `formatCents → parseEuroInput`
über alle Centbeträge 0–5000 und die klassischen Float-Fallen (`8,20`, `29,97`, `1.000,07`).
Die Datei ist neu und **noch nicht committet** – bitte beim Nacharbeits-Commit mitnehmen.

## Handrechnung `money.ts`

Alle neun Pflichtfälle aus WP0 Schritt 6 sind in `src/lib/money.test.ts:6-18` als
`it.each`-Tabelle vorhanden und stimmen mit meiner Handrechnung überein:
`"100"`→10000, `"100,5"`→10050, `"100.50"`→10050, `"1.000,00"`→100000, `"1,000.50"`→100050,
`"abc"`→null, `"-5"`→null, `""`→null, `"0"`→0. Kein Fall fehlt, keiner ist falsch erwartet.
Die Cent-Berechnung ist ganzzahlig (`euros * 100 + fraction`), keine Float-Division im
Rechenpfad; `formatCents` gruppiert per Regex, nicht per `toLocaleString`, ist also
locale-unabhängig und deterministisch.

## Bewertung von Siris vier Abweichungen

| # | Abweichung | Begründet? | Harmlos? | Prüfung durch mich |
|---|---|---|---|---|
| 1 | `typecheck` = `next typegen && tsc --noEmit` | **ja** | **ja** | Nachgestellt: ohne `typegen` bricht `tsc` mit `TS2304 Cannot find name 'LayoutProps'` ab, weil `src/app/layout.tsx:15` den von Next 16 generierten globalen Typ `LayoutProps<'/'>` nutzt und `tsconfig.json` `.next/types/**/*.ts` einbindet. `typegen` schreibt nur nach `.next/` (gitignored), verschmutzt den Arbeitsbaum also nicht. |
| 2 | `vitest.config.mts` statt `.ts` | **ja** | **ja** | `package.json` hat kein `"type": "module"`; `.mts` ist der von Vite empfohlene Weg für eine ESM-Config. Die Datei wird von `tsconfig.json` (`**/*.mts`) typgeprüft und von ESLint erfasst – beides grün. Der Dateiname ist im Plan nicht tragend. |
| 3 | `@types/node` von `^20` auf `^24` | **ja** | **ja** | `npm view vitest@5.0.0 peerDependencies` liefert `"@types/node": "^22.0.0 \|\| >=24.0.0"`. Mit `^20` ist `npm ci` nicht auflösbar. Laufende Node-Version ist 24.14.1, `npm ci` und Build sind grün. |
| 4 | Google-Fonts (Geist) entfernt, System-Font-Stack | **ja** | **ja**, mit Nebenwirkung | Kein `next/font`-Import mehr in `src/`, Stack steht in `src/app/globals.css:22-30`. Der Build braucht damit kein Netz zu `fonts.googleapis.com`. SPEC schreibt keine Schrift vor. Nebenwirkung: `README.md` behauptet weiterhin das Gegenteil → F4. |

Alle vier Abweichungen sind sachlich begründet und harmlos. Keine davon führt zu Nacharbeit.

## DoD-Abgleich

| DoD-Punkt | Status | Anmerkung |
|---|---|---|
| `npm run dev` zeigt die Platzhalterseite unter `http://localhost:3000` | **nicht verifiziert** | Ich starte laut Rolle keinen Dev-Server. Statisch geprüft: `/` wird gebaut, `src/app/page.tsx` rendert „Poker-Kasse" / „Setup OK", `layout.tsx` setzt `lang="de"` und den Viewport-Export. Konkrete Sichtprüfung siehe „Nicht verifiziert". |
| `npm run check` grün | **erfüllt** | Selbst ausgeführt, zweimal (vor und mit meinen Tests). |
| `npm run build` grün | **erfüllt** | Selbst ausgeführt. Einzige Ausgabe ist die `middleware`-Deprecation-Warnung, kein Fehler. |
| Keine Secrets im Repo | **erfüllt** | `.env.local` ist ignoriert und nicht getrackt; enthält ausschließlich `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Repo-weite Suche nach `service_role`, `SERVICE_ROLE`, `sb_secret` und dem JWT-Präfix `eyJhbGciOi`: keine Treffer. `.env.example` ist committet und wertfrei. |
| Übergabe in `qa/handoffs/WP0-siri.md` | **erfüllt** | Vollständig nach Vorlage, Abweichungen und offene Fragen benannt. |
| Ordnerstruktur laut Plan Schritt 8 | **erfüllt** | `src/actions/`, `src/components/ui/`, `src/lib/settlement/`, `src/lib/auth/`, `supabase/migrations/`, `tests/gaby/` – alle vorhanden und mit `.gitkeep` getrackt. |
| Scripts laut Plan Schritt 7 | **erfüllt** | `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:watch`, `check` vorhanden; `check` ruft typecheck → lint → test in dieser Reihenfolge. |
| Vitest-Config laut Plan Schritt 7 | **teilweise** | `environment: 'node'` und beide `include`-Muster stimmen. Der Import-Alias `@/*` fehlt → F1. |
| `.gitignore` deckt `.env.local` ab | **erfüllt** | `.env*` (Zeile 34), `!.env.example` (Zeile 44) hebt gezielt wieder auf – der letzte Treffer gewinnt, `.env.example` ist getrackt. `.vercel` und `/qa/tmp` sind ebenfalls drin. |
| Abhängigkeiten laut Plan Schritt 3 | **erfüllt** | `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `clsx` als Runtime; `vitest`, `@vitest/coverage-v8`, `fast-check`, `@types/node` als dev (sinnvoller als im Plan, im Handoff genannt). Keine ungenannte Abhängigkeit. |
| Kein `any`, ESLint sauber | **erfüllt** | Keine `any`, keine `eslint-disable`, keine `@ts-ignore` / `@ts-expect-error` in `src/`, `tests/` und den Config-Dateien. |

## Findings

### F1 – [Major] Der Import-Alias `@/*` ist in Vitest nicht auflösbar

- **Wo**: `vitest.config.mts:3-11` (kein `resolve.alias`), Bezug `tsconfig.json:24-26` (`"@/*": ["./src/*"]`)
- **Beobachtet**: Eine Testdatei, die Produktivcode über den projektweiten Alias importiert,
  bricht beim Laden ab:
  `Error: Cannot find package '@/lib/money' imported from C:/Users/sirat/Poker_App/tests/gaby/_probe.test.ts`.
  Das gilt für jeden Ort – `tests/**` wie `src/**`. Heute fällt es nicht auf, weil die einzige
  bestehende Testdatei relativ importiert (`src/lib/money.test.ts:2`) und die einzige Datei mit
  Alias-Import (`src/middleware.ts:2`) nicht unter Test steht.
- **Erwartet**: Der Alias, den WP0 Schritt 2 ausdrücklich einrichtet (`--import-alias "@/*"`) und
  den der Produktivcode benutzt, muss auch im Testlauf gelten. WP0 Schritt 7 verlangt eine
  Vitest-Config, die `tests/**/*.test.ts` einschließt, und Schritt 8 legt `tests/gaby/` als festen
  Testort an – von dort ist ein relativer Import nach `src/` (`../../src/lib/...`) derzeit die
  einzige Möglichkeit, was der Konvention widerspricht. Der eigentliche Schaden entsteht
  spätestens in WP3: sobald ein getestetes Modul den Alias intern benutzt (z. B.
  `src/lib/settlement/format.ts` → `formatCents` aus `@/lib/money`), scheitern **alle** Tests,
  die dieses Modul laden – auch die in `src/`.
- **Reproduktion**:
  1. `cd C:\Users\sirat\Poker_App`
  2. Datei `tests/gaby/_alias.test.ts` anlegen mit
     `import { formatCents } from '@/lib/money';` und einem trivialen `it(...)`.
  3. `npx vitest run tests/gaby/_alias.test.ts` → `Cannot find package '@/lib/money'`.
  4. Datei wieder löschen.
- **Vorschlag** (ohne neue Abhängigkeit), in `vitest.config.mts`:
  `import { fileURLToPath } from 'node:url';` und im Config-Objekt
  `resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },`.
  Alternativ `vite-tsconfig-paths` – dann aber als neue Abhängigkeit im Handoff nennen.
  Nach dem Fix bitte `npm run check` erneut laufen lassen. Meine Tests dürfen unverändert
  relativ importieren; ich stelle sie in einer späteren Runde selbst um.

### F2 – [Minor] „100.555" wird zu 100.555,00 € – korrekt, aber ein stiller Faktor 1000

- **Wo**: `src/lib/money.ts:79-83` (`pickDecimalSeparator`, Regel „einzelner Punkt vor genau drei Ziffern = Tausendertrenner")
- **Beobachtet**: `parseEuroInput('100.555')` → `10055500` (= 100.555,00 €). Ebenso
  `'1.234'` → `123400` und `'2.500'` → `250000`. Gleichzeitig gilt `'1.23'` → `123` und
  `'100.50'` → `10050`; der Punkt ist also mal Dezimal-, mal Tausendertrenner.
- **Erwartet**: Sachlich ist das **richtig** – deutsche Notation, und WP0 Schritt 6 verlangt
  ausdrücklich sowohl `"100.50"` → 10050 als auch `"1.000,00"` → 100000, was diese Doppelrolle
  erzwingt. Die WP0-Regel „mehr als zwei Nachkommastellen → `null`" ist nicht verletzt, weil
  `100.555` unter dieser Lesart null Nachkommastellen hat (mit Komma geschrieben, `'100,555'`,
  liefert die Funktion korrekt `null`). Kein Fehler, aber die einzige Stelle im Paket, an der
  eine Eingabe stillschweigend um Faktor 1000 anders gelesen werden kann als vom Tippenden
  gemeint.
- **Reproduktion**: `parseEuroInput('100.555')` → `10055500`. In
  `tests/gaby/money.gaby.test.ts` als bewusster Regressions-Pin festgehalten, damit die Regel
  nicht unbemerkt kippt.
- **Empfehlung an den Planer**: Die Trennzeichen-Regel gehört in `docs/SPEC.md`, nicht nur in den
  Doc-Kommentar. Und in WP5 sollte das Buy-in-Sheet den geparsten Betrag vor dem Eintragen über
  `formatCents()` zurückspiegeln („Eintragen: 100.555,00 €") – dann kann ein Vertipper am Tisch
  nicht unbemerkt in die Kasse laufen.

### F3 – [Minor] `formatCents` schluckt `NaN`, `Infinity` und Nicht-Ganzzahlen

- **Wo**: `src/lib/money.ts:11-13`
- **Beobachtet**: `formatCents(NaN)` → `"0,00 €"`, `formatCents(Infinity)` → `"0,00 €"`,
  `formatCents(10.5)` → `"0,11 €"` (stillschweigend gerundet).
- **Erwartet**: Bei Geld ist ein `NaN` immer ein Programmierfehler. Ihn als „0,00 €" anzuzeigen
  ist die gefährlichste aller Anzeigen: am Tisch sieht niemand, dass etwas kaputt ist. Die
  eiserne Regel in `CLAUDE.md` lautet „Geld = Integer-Cent, nie Float" – ein nicht-ganzzahliger
  Eingabewert sollte auffallen, nicht gerundet werden.
- **Reproduktion**: `formatCents(NaN)` in einer Testdatei aufrufen.
- **Empfehlung**: `if (!Number.isInteger(cents)) throw new Error(...)` oder ein sichtbarer
  Platzhalter („—"). Die Entscheidung liegt beim Planer; ich habe das aktuelle Verhalten in
  meinen Tests **nicht** festgeschrieben, damit eine Verschärfung keinen Test bricht.

### F4 – [Minor] `README.md` und Generator-Reste widersprechen dem Projektstand

- **Wo**: `README.md` (unverändertes create-next-app-Template), insbesondere `README.md:21`
- **Beobachtet**: Zeile 21 behauptet, das Projekt nutze `next/font` und die Schrift Geist – die
  wurde laut Abweichung 4 gerade entfernt. Der Rest der Datei erklärt `create-next-app`,
  Vercel-Deploy und `app/page.tsx` (falscher Pfad, das Projekt nutzt `src/`). Ebenfalls unbenutzt
  im Repo: `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`,
  `public/window.svg` sowie das Vercel-Standard-`src/app/favicon.ico`.
- **Erwartet**: Das README ist die erste Datei, die eine fremde Person öffnet; WP10 verlangt
  ohnehin Betriebsdoku. Ein kurzer projektbezogener Text (Zweck, Stack, `npm run check`, Verweis
  auf `CLAUDE.md` und `docs/`) statt der Vorlage. Die Standard-SVGs und das Favicon spätestens
  in WP9 durch das eigene Chip-Motiv ersetzen.
- **Reproduktion**: `head -25 README.md`.

### F5 – [Minor] Kein `test:coverage`-Script, obwohl WP3 Coverage verlangt

- **Wo**: `package.json:5-14`
- **Beobachtet**: `@vitest/coverage-v8` ist installiert und die Coverage-Config steht in
  `vitest.config.mts:7-10`, aber es gibt kein Script dafür. `npx vitest run --coverage`
  funktioniert (selbst geprüft: `src/lib/money.ts` 98,24 % Statements, 100 % Lines).
- **Erwartet**: WP3 DoD fordert „Coverage für `src/lib/settlement/**` ≥ 95 % Zeilen". Ein
  `"test:coverage": "vitest run --coverage"` macht die Zahl reproduzierbar prüfbar, statt sie
  jedes Mal von Hand zusammenzusetzen.
- **Reproduktion**: `npm run test:coverage` → `Missing script`.

### F6 – [Minor] Non-Null-Assertions auf die Env-Variablen

- **Wo**: `src/lib/supabase/client.ts:8-9`, `src/lib/supabase/server.ts:12-13`, `src/lib/supabase/middleware.ts:16-17`
- **Beobachtet**: Alle drei Helfer greifen mit `process.env.NEXT_PUBLIC_...!` zu. Fehlt oder
  vertippt sich die `.env.local`, kommt kein verständlicher Fehler, sondern ein Absturz aus dem
  Supabase-Client heraus – in `middleware.ts` auf **jedem** Request, weil der Matcher alles außer
  statischen Assets erfasst. Der Build bleibt davon unberührt (die Helfer laufen zur Buildzeit
  nicht), der Fehler zeigt sich erst zur Laufzeit.
- **Erwartet**: Ein zod-validierter Zugriff (`src/lib/env.ts`) mit klarer deutscher Meldung.
  Siri schlägt genau das im Handoff selbst vor.
- **Reproduktion**: Code-Review; nicht ausgeführt, weil ich die `.env.local` des Planers nicht anfasse.
- **Einordnung**: gehört fachlich in WP2, hier nur als Notiz festgehalten. Kein Nacharbeitsgrund für WP0.

## Nicht verifiziert

- **Sichtprüfung im Browser** (DoD-Punkt 1). Ich starte keinen Dev-Server. Bitte durch den
  Planer: Browser-Pane mit Konfiguration `dev` aus `.claude/launch.json`, dann
  `http://localhost:3000` – erwartet: Überschrift „Poker-Kasse", darunter „Setup OK",
  Tab-Titel „Poker-Kasse", `<html lang="de">`, bei 375 px Breite kein horizontales Scrollen,
  Dark Mode folgt `prefers-color-scheme` (`src/app/globals.css:13-18`).
- **Supabase-Verbindung**. Die drei Client-Helfer wurden nie gegen das echte Projekt ausgeführt;
  ohne Schema (WP1) und ohne Login (WP2) gibt es nichts zu lesen. Nur Code-Review: `client.ts`
  ist Browser-only, `server.ts` liest die Cookies über `await cookies()` und fängt den
  Server-Component-Schreibfall ab, `middleware.ts` ruft `supabase.auth.getUser()` und schreibt
  die rotierten Cookies auf die Response zurück – entspricht der Supabase-Vorlage für Next.
- **Middleware-Matcher gegen `/manifest.webmanifest` und `/icons/*`**. Beides existiert noch nicht
  (WP9); der Matcher in `src/middleware.ts:9-13` nimmt sie aktuell **nicht** aus. Für WP0 ist das
  in Ordnung, gehört aber in den WP2-Testauftrag (dort ausdrücklich gefordert).
- **Verhalten ohne `.env.local`** – nicht getestet, siehe F6.

## Hinweise zu den offenen Fragen aus dem Handoff

- **`middleware.ts` → `proxy.ts`**: Der Build gibt die Deprecation-Warnung aus („The 'middleware'
  file convention is deprecated. Please use 'proxy' instead."), bricht aber nicht ab; die
  Route-Tabelle zeigt bereits `Proxy (Middleware)`. Der Planer hat `docs/ARBEITSPAKETE.md`
  WP2 Schritt 3 inzwischen auf `src/proxy.ts` umgestellt (Änderung liegt uncommitted im
  Arbeitsbaum). Damit ist die Frage beantwortet: Umbenennung in WP2, für WP0 kein Finding.
- **Obergrenze für `parseEuroInput`**: WP5 Testauftrag nennt bereits 1.000.000 Cent als
  Obergrenze mit Meldung. Die gehört in die Zod-Schemas der Server Actions, nicht in
  `parseEuroInput` – die Funktion soll parsen, nicht fachlich begrenzen. Aus meiner Sicht ist
  `Number.isSafeInteger` hier die richtige und einzige Grenze.

## Was Siri für Runde 2 tun muss

1. **F1** beheben (Alias in `vitest.config.mts`), danach `npm run check` und `npm run build`
   erneut grün melden.
2. Optional in derselben Runde, weil billig: **F5** (`test:coverage`-Script) und **F4** (README).
3. **F2**, **F3**, **F6** brauchen eine Entscheidung des Planers – nicht ungefragt umsetzen.
4. `tests/gaby/money.gaby.test.ts` mitcommitten (neu, bisher untracked).

## Runde 2 – Nachprüfung

Geprüfter Stand: Commit `49bc81f` („WP0: address review findings (round 2)"), 2026-09-08.
Der Arbeitsbaum war vor meiner Prüfung sauber (`git status --short` ohne Ausgabe); die
Planer-Änderung an `docs/ARBEITSPAKETE.md` liegt inzwischen als `43d51a9` im Repo.
Auf Anweisung des Planers **kein** `npm ci` und kein Löschen von `node_modules`, weil parallel
ein zweiter Agent im selben Ordner arbeitet.

### Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `git show --stat 49bc81f` | 10 Dateien, +524/−29. Produktivcode nur in `vitest.config.mts`, `eslint.config.mjs`, `package.json`, `src/lib/money.ts` (dazu zwei Testdateien, README, qa-Dokumente). Kein Griff in fremde Bereiche. |
| `git show 49bc81f -- vitest.config.mts eslint.config.mjs package.json src/lib/money*.ts` | vollständig gelesen, Bewertung je Finding unten |
| `npm run check` | **grün** – typegen ok, ESLint **ohne jede Ausgabe**, 65 Tests in 3 Dateien. Deckt sich exakt mit Siris Angabe im Handoff. |
| `npx vitest run tests/gaby/alias.gaby.test.ts` (meine neue Datei) | **grün** – 2 Tests |
| `npm run test:coverage` | **grün** – 67 Tests in 4 Dateien; `src/lib/money.ts` 98,27 % Stmts, 95,83 % Branch, 100 % Funcs, **100 % Lines**. Die drei Supabase-Helfer stehen erwartungsgemäß bei 0 % (kein Test, kein Login – WP1/WP2). |
| `npx eslint coverage/block-navigation.js` | „File ignored because of a matching ignore pattern" – die neue Ignore-Regel greift |
| `npx eslint qa/tmp/coverage/probe.js` (Wegwerf-Datei, danach gelöscht) | **wird gelintet** – die Regel ist also am Projektstamm verankert und schluckt keinen gleichnamigen Unterordner |
| `git status --short` | nur `?? tests/gaby/alias.gaby.test.ts` (meine neue Datei). Kein `coverage/`, kein `node_modules`, kein `.next` im Status. |
| `npm run check` (erneut, mit meiner neuen Testdatei) | **grün** – 67 Tests in 4 Dateien, Lint weiterhin ohne Ausgabe |
| `npm run build` | **nicht ausgeführt** (Vorgabe des Planers, paralleler Agent im Ordner). Siri meldet grün; keine der vier Änderungen berührt den Build-Pfad – `formatCents` wird außerhalb von `src/lib/money.ts` und den Testdateien repo-weit noch nirgends aufgerufen. |

### Findings aus Runde 1

| # | Grad | Status | Begründung |
|---|---|---|---|
| **F1** | Major | **✔ behoben** | `vitest.config.mts:4-10` mappt `'@'` per `fileURLToPath(new URL('./src', import.meta.url))` – ohne neue Abhängigkeit, exakt wie vorgeschlagen. Von beiden Seiten nachgeprüft: Siris Wächter `src/lib/money.alias.test.ts` und meine neue `tests/gaby/alias.gaby.test.ts` importieren über `@/lib/money` und laufen grün. Meine Datei prüft zusätzlich `formatCents === relative.formatCents`, d. h. Alias- und Relativ-Import liefern **dieselbe Modulinstanz**; es entsteht kein zweiter Modulgraph. Der Alias greift präfixgenau, `@supabase/...` bleibt unberührt (Testlauf grün). |
| **F2** | Minor | **— verschoben** | Punkt-Ambiguität, laut Planer nach **WP5** (Rückspiegelung des geparsten Betrags über `formatCents` im Buy-in-Sheet). `src/lib/money.ts` ist in diesem Punkt unverändert; mein Regressions-Pin in `tests/gaby/money.gaby.test.ts` hält die aktuelle Regel fest. Nicht als offen gewertet. |
| **F3** | Minor | **✔ behoben** | `src/lib/money.ts:14-17` wirft jetzt `Error("formatCents expects integer cents, received: …")`; das stille `Math.round`/`Number.isFinite`-Fallback auf `0` ist entfernt. Von Hand nachgerechnet: `Number.isInteger(-0)` ist `true` und `-0 < 0` ist `false` → `formatCents(-0)` bleibt `"0,00 €"`, kein `"-0,00 €"`. `NaN`, `±Infinity`, `10.5`, `-0.01` werfen. `src/lib/money.test.ts:74-84` deckt genau diese fünf Fälle plus `-0` ab. Kein Aufrufer bricht dadurch: `formatCents` wird außerhalb der Tests noch nirgends benutzt. |
| **F4** | Minor | **✔ behoben** | `README.md` vollständig ersetzt: Zweck, Verweise auf `CLAUDE.md` und die fünf `docs/`-Dateien, Stack, Einrichtung (`npm ci`, `.env.example` → `.env.local`), Befehlsliste inkl. `test:coverage`, Integer-Cent-Hinweis. Suche nach `geist`/`next/font` in `README.md` und `src/`: **keine Treffer**, die falsche Schrift-Aussage ist weg. Die Generator-SVGs in `public/` und das Vercel-Favicon bleiben wie vorgesehen liegen – WP9, hier kein Mangel. |
| **F5** | Minor | **✔ behoben** | `package.json:13` enthält `"test:coverage": "vitest run --coverage"`. Selbst ausgeführt, läuft durch, Tabelle für `src/lib/**` wie oben. Damit ist die WP3-Forderung („Coverage für `src/lib/settlement/**` ≥ 95 % Zeilen") reproduzierbar prüfbar. |
| **F6** | Minor | **— verschoben** | Non-Null-Assertions auf die Env-Variablen, laut Planer nach **WP2** (`src/lib/env.ts`, zod-validiert). Die drei Supabase-Helfer sind unverändert. Nicht als offen gewertet. |

### Bewertung: `coverage/**` in `eslint.config.mjs`

**Korrekt und minimal.** Die Ergänzung steht in `eslint.config.mjs:15-16` innerhalb desselben
`globalIgnores`-Aufrufs, der die Defaults von `eslint-config-next` nachbildet – der einzige
richtige Ort, denn ein `globalIgnores` **ersetzt** diese Defaults, statt sie zu erweitern.
Drei Punkte nachgeprüft:

1. **Nötig?** Ja. ESLint ignoriert per Default nur `node_modules/` und `.git/`; die Flat Config
   liest `.gitignore` nicht. Ohne die Regel lintet `npm run lint` den v8-Report und meldet – wie
   von Siri beschrieben – eine Warnung aus `coverage/block-navigation.js`. Ausgelöst hat das erst
   F5: ohne die Ergänzung macht der neue Befehl `npm run test:coverage` den nächsten
   `npm run check` warnend. Der Folgefix gehört sachlich zu F5, ist also kein Scope-Creep.
2. **Wirksam?** Ja – `npx eslint coverage/block-navigation.js` meldet „File ignored because of a
   matching ignore pattern"; nach einem Coverage-Lauf ist `npm run lint` ohne jede Ausgabe.
3. **Zu breit?** Nein. Ein Muster mit `/` in der Mitte ist in der Flat Config am Projektstamm
   verankert. Gegenprobe mit einer Wegwerf-Datei `qa/tmp/coverage/probe.js`: die wird **gelintet**
   (Warnung `no-unused-vars`), die Regel verschluckt also keinen gleichnamigen Unterordner in
   `src/`. Datei danach gelöscht. Deckungsgleich mit `.gitignore:14` (`/coverage`, ebenfalls nur
   Stamm) und mit dem Standard-Ausgabeordner von `@vitest/coverage-v8`.

Alternative wäre `coverage/` statt `coverage/**` gewesen (spart ESLint das Betreten des Ordners);
der Unterschied ist Laufzeit, nicht Verhalten. Kein Einwand.

### Meine neue Testdatei

`tests/gaby/alias.gaby.test.ts` (2 Tests, grün) – Alias-Wächter **aus `tests/gaby/` heraus**, also
von genau dem Ort, der in Runde 1 gebrochen war (Siris Wächter liegt in `src/`). Prüft zusätzlich,
dass Alias- und Relativ-Import dieselbe Modulinstanz liefern. Die Datei ist neu und **noch nicht
committet** – bitte beim nächsten Commit mitnehmen. `tests/gaby/money.gaby.test.ts` hat Siri
unverändert übernommen: 38 Tests, kein `skip`, kein `only`, keine abgeschwächte Erwartung.

### Hinweise (kein Nacharbeitsgrund)

- **`Number.isInteger` statt `Number.isSafeInteger` in `formatCents`** (`src/lib/money.ts:15`):
  Die neue Schranke lässt unsichere Ganzzahlen durch. `formatCents(1e23)` liefert
  `"999.999.999.999.999.900.000,92 €"`, `formatCents(Number.MAX_VALUE)` sogar
  `"1.7.976.931.348.623.156e+306,68 €"` – die Gruppierungs-Regex zerlegt die
  Exponentialschreibweise. Erreichbar ist das weder über `parseEuroInput` (kappt bei
  `Number.isSafeInteger`) noch aus einer Integer-Spalte, und es ist keine Regression – der alte
  Code tat via `Math.round` dasselbe. Ein Wort Änderung schließt die Lücke; Vorschlag für WP3,
  sobald `src/lib/settlement/**` Summen bildet.
- **ESLint lintet `qa/tmp/`**: Der Ordner ist in `.gitignore` als Ablage vorgesehen, für ESLint
  aber gewöhnlicher Quellcode – meine Wegwerf-Datei tauchte prompt in `npm run lint` auf. Solange
  dort nur Markdown liegt, passiert nichts; sobald ein Agent eine `.js`/`.ts`-Notiz ablegt, wird
  `npm run check` grundlos rot. `"qa/tmp/**"` in derselben `globalIgnores`-Liste wäre konsequent.
  Kosmetik, gehört nicht in WP0.

### Weiterhin nicht verifiziert

Unverändert gegenüber Runde 1: die Sichtprüfung im Browser (DoD-Punkt 1, macht der Planer über
`.claude/launch.json`, Konfiguration `dev`), die Supabase-Verbindung, der Middleware-Matcher gegen
`/manifest.webmanifest` und `/icons/*` (WP2/WP9) sowie das Verhalten ohne `.env.local` (F6, WP2).
Neu in Runde 2: `npm run build` habe ich diesmal **nicht** selbst laufen lassen (Vorgabe des
Planers wegen des parallel arbeitenden Agenten). In Runde 1 war er grün, und keine der vier
Änderungen berührt den Build-Pfad.
