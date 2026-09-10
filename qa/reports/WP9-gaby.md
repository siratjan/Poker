# WP9 – Prüfbericht Gaby

**Urteil: NACHARBEIT** (2 Major, 7 Minor, 0 Blocker)

Geprüfter Stand: `488ac03` („WP9: PWA and mobile polish“), gemerged als `a4cb930` auf `main`.
Der Merge ist sauber: `git diff 9208997 a4cb930` und `git diff 7139a56 488ac03` sind identisch —
die WP8-Korrekturen (F1–F3) und die Gaby-Tests aus WP7/WP8 sind durch den Merge **nicht**
verloren gegangen (das war meine erste Sorge, weil Siri von `7139a56` und damit vor
`3fac0ed`/`cba47c4`/`9208997` abgezweigt hat).

Kein Produktivcode wurde von mir angefasst; neu ist ausschließlich
`tests/gaby/wp9-pwa.gaby.test.ts` (87 Tests).

## Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `npm run check` (vor meinen Tests, 20:06) | **grün** – 49 Dateien, 1021 Tests, ~1,7 s. Lint: 0 Errors, **4 Warnungen** (siehe unten) |
| `npm run build` | **grün** – Next 16.3.4/Turbopack, `/manifest.webmanifest` statisch vorgerendert |
| `npm run check` (mit meinen Tests, 20:15) | **grün** – 50 Dateien, **1114 Tests**, Lint **0 Errors / 0 Warnungen** |
| `npx vitest run tests/gaby/wp9-pwa.gaby.test.ts` | **grün** – 87 Tests |
| `npm run icons:generate` | **reproduzierbar**: alle vier PNG byte-identisch (SHA-256-Präfixe wie im Handoff). Einziger Diff war `public/icons/icon.svg` mit LF/CRLF – reiner `core.autocrlf`-Effekt, Inhalt gleich; ich habe die Datei mit `git checkout --` zurückgesetzt, Arbeitsbaum ist sauber |
| Eigene PNG-Analyse (Signatur/IHDR/CRC/Pixel) | **grün**, siehe unten |
| Eigene WCAG-Rechnung (sRGB **und** Tailwind-v4-oklch) | **grün**, alle ≥ 4,5:1 |
| `rls:smoke` | nicht gelaufen (WP9 fasst weder DB noch Policies an; keine SQL-Datei im Diff) |

**Zu den 4 Lint-Warnungen:** Sie stammen **nicht** aus WP9. Alle vier lagen in
`tests/gaby/wp8-admin-audit.gaby.test.ts` (Zeilen 33/46/48/51, ungenutzte Importe
`isAuditCursorTimestamp`, `auditListKey`, `NO_AUDIT_FILTERS`, `AuditFilters`) — also im
Arbeitsstand der parallel laufenden WP8-Runde-2-Prüfung, der zu diesem Zeitpunkt als
`M tests/gaby/wp8-admin-audit.gaby.test.ts` im Arbeitsbaum lag. Nachdem diese Session fertig
war, meldet `npm run lint` wieder **0 Warnungen**. Kein WP9-Befund.

### Eigene Tests: `tests/gaby/wp9-pwa.gaby.test.ts` (87 Tests, grün)

1. **Icons wirklich gelesen**, nicht nur benannt: PNG-Signatur, IHDR (Breite/Höhe/Bittiefe/
   Farbtyp/Interlace), **CRC jedes Chunks selbst nachgerechnet**, Chunk-Reihenfolge
   IHDR…IDAT…IEND, `inflate` der IDAT und Prüfung, dass jede Zeile Filtertyp 0 hat.
   Ergebnis: 192×192, 512×512, 512×512, 180×180, alle RGBA8, nicht interlaced, **keine
   fehlerhafte CRC**. Maskable: alle vier Ecken deckend, und außerhalb der 80-%-Safe-Zone
   steht ausschließlich die Plattenfarbe (0 Motivpixel im Beschnittbereich, Raster 2 px).
   Apple-Touch-Icon: 0 transparente Pixel. Manifest-`sizes` == echte Pixelmaße.
2. **Manifest**: Pflichtfelder, 192/512/maskable, alle `image/png`, `scope` deckt `start_url`,
   `start_url` ist nicht öffentlich, `loginPathFor('/') === '/login'` (kein `next`, also keine
   Redirect-Schleife), Manifest und alle Icon-Pfade sind `isPublicPath` **und** fallen aus dem
   Proxy-Matcher.
3. **Proxy-Matcher (Gaby WP2-F1)**: `/_next/webpack-hmr`, `/_next/turbopack-hmr`,
   `/_next/static/...` laufen nicht mehr durch den Proxy; `/`, `/login`, `/sessions/*`,
   `/admin`, `/players`, `/log` weiterhin schon.
4. **Kontrast, zweite unabhängige Rechnung** – inkl. eigener oklch→sRGB-Konvertierung, weil
   Tailwind v4 die Palette in **oklch** ausliefert und der Browser nicht die v3-Hexwerte malt.
5. **`deriveConnection`**: Rangfolge, „offline blockiert immer und bietet nie Neu laden“,
   „toter Kanal = Verbindung getrennt + Neu laden, Schreiben erlaubt“, „geblockt ⇒ immer ein
   Banner“ (kein stummes Sperren), 10-Sekunden-Regel aus WP5 noch im Hook, Realtime-Status
   wird beim Verlassen der Seite zurückgesetzt, Event-Listener werden abgemeldet.
6. **Offline-Sperren**: jede der sieben gesperrten Schreibkomponenten prüft `useWritesBlocked`
   **und** hat den Guard zusätzlich in der Submit-Funktion (nicht nur `disabled`);
   „Abbrechen“ trägt kein `disabled`; `Sheet.tsx` kennt `useWritesBlocked` gar nicht.
7. **Kein Offline-Cache**: kompletter Scan von `src/`, `public/`, `scripts/` auf
   `navigator.serviceWorker`, `workbox`, `caches.open|match|keys|delete`; kein `public/sw.js`.
8. **Routen**: alle 8 Routen haben `loading.tsx`; jede liegt unter einer `error.tsx`; jede
   `error.tsx` ist `'use client'`, ruft `reset` und zeigt **nicht** `error.message`;
   `global-error.tsx` importiert nur `react`; 404 ist deutsch.
9. **Lighthouse-Artefakte**: echte Läufe (`requestedUrl`, `fetchTime` parsebar,
   `formFactor: mobile`), jede Kategorie ≥ 0,9, kein JWT/`service_role`/`sb_secret` in
   JSON und HTML.
10. **Geld/Abhängigkeiten**: Dependency-Liste eingefroren (7 Pakete, unverändert), kein
    `sharp`/`jimp`/`canvas`/`pngjs`/`next-pwa`, `icons:generate` vorhanden; in den neuen
    WP9-Dateien kein `parseFloat`/`toFixed`/`/ 100` und kein `any`.
11. Drei `describe`-Blöcke **F1/F2/F3 (offen)** halten den Ist-Zustand der Findings fest.
    Sie werden rot, sobald Siri die Findings behebt — dann sind sie in Runde 2 in die
    positiven Erwartungen umzuschreiben (Hinweis steht im Testkommentar).

### Kontrast von Hand nachgerechnet

Relative Luminanz nach WCAG 2.1, `(L1+0,05)/(L2+0,05)`, Hintergründe `#ffffff` / `#0a0a0a`
aus `globals.css`:

| Rolle | Farbe (v3-Hex, so rechnet Siris Test) | meine Ratio | Siris Angabe | Tatsächlich gerendert (v4-oklch) | meine Ratio |
|---|---|---|---|---|---|
| Plus hell | `#047857` | **5,48** | 5,55 | `oklch(50.8% .118 165.612)` ≈ `#007a55` | **5,37** |
| Plus dunkel | `#34d399` | **10,30** | 10,33 | `oklch(76.5% .177 163.223)` ≈ `#00d492` | **10,24** |
| Minus hell | `#b91c1c` | **6,47** | 6,49 | `oklch(50.5% .213 27.518)` ≈ `#c10007` | **6,42** |
| Minus dunkel | `#f87171` | **7,16** | 7,16 | `oklch(70.4% .191 22.216)` ≈ `#ff6467` | **6,85** |
| Plus hell **vorher** | `#059669` | **3,77** ✗ | 3,77 ✗ | `oklch(59.6% .145 163.225)` | **3,67** ✗ |

**AA (≥ 4,5:1) ist in beiden Farbräumen erfüllt** – die Umstellung emerald-600 → 700 war
sachlich richtig und nachvollziehbar. Die genannten Einzelwerte stimmen aber nicht ganz
(siehe F4).

Abgeschwächte Texte (Kompositing wie im Browser):

| Deckkraft | `#171717` auf Weiß | `#ededed` auf `#0a0a0a` | auf `bg-black/5`-Karte |
|---|---|---|---|
| 50 % (alt) | **3,41** ✗ | 4,71 | – |
| 60 % | **4,69** ✓ | 6,38 ✓ | 4,52 ✓ (knapp) |
| 70 % | **6,63** ✓ | 8,41 ✓ | 6,29 ✓ |
| 80 % | – | – | 8,88 ✓ |

Verbindungs-Banner: `red-800` auf `red-600/12` = **6,76**, Beschreibung mit `opacity-90` =
**5,90**; `amber-900` auf `amber-500/15` = **8,09** (Beschreibung 6,38); dunkel `red-200` =
**12,15**, `amber-100` = **14,25**. Alles deutlich über AA.

## DoD-Abgleich

| DoD-Punkt | Status | Anmerkung |
|---|---|---|
| „Zum Home-Bildschirm“ auf Android Chrome und iOS Safari, Start ohne Browser-Leiste | ✔ (Code + Lighthouse), **Gerät offen** | Manifest vollständig, `display: standalone`, `installable-manifest`/`maskable-icon`/`splash-screen`/`themed-omnibox` je 1,0 (LH 11.7.1); `appleWebApp` rendert die drei iOS-Tags. Auf echten Geräten kann ich es nicht prüfen (siehe „Nicht verifiziert“) |
| Alle Seiten haben Lade- und Fehlerzustand | ✔ | 8 Routen, 8 `loading.tsx`; Fehlergrenzen `src/app/error.tsx`, `(app)/error.tsx`, `(app)/sessions/[id]/error.tsx` decken jede Route ab; zusätzlich `global-error.tsx` und deutsche `not-found.tsx`. Alle mit „Erneut versuchen“ |
| Lighthouse-Werte dokumentiert (`qa/reports/WP9-lighthouse.json`) | ✔ | 98/100/100/100 (LH 12.8.2) + PWA 1,0 (LH 11.7.1), beide mobil gegen `http://localhost:3100/login`, `fetchTime` 2026-09-09T17:59/18:00Z. Plausibel, keine Secrets |
| Plan 1 – Manifest, Icons 192/512, Apple-Meta, `theme-color` | ✔ | Icons selbst dekodiert und vermessen |
| Plan 2 – kein Daten-Caching, Offline-Banner, Aktionen deaktiviert | **teilweise** | Kein SW/Cache ✔, Banner ✔, aber „Session anlegen“ ist nicht gesperrt (**F1**) und ein Abbruch *während* einer Aktion friert den Knopf ein (**F3**) |
| Plan 3 – `loading.tsx` je Route, `error.tsx` mit „Erneut versuchen“ | ✔ | zusätzlich `not-found.tsx` (begründete Erweiterung) |
| Plan 4 – Dark Mode, Kontrast geprüft | ✔ | `prefers-color-scheme` im gebauten CSS bestätigt; AA nachgerechnet (F4 nur Dokumentation) |
| Plan 5 – Safe-Area-Insets | ✔ (Code) | `--safe-*`, `--tabbar-height`, `.pb-safe`/`.px-safe` im gebauten CSS vorhanden; TabBar und `main` rechnen damit. Optik am Gerät: Planer |
| Plan 6 – `tabular-nums`, echtes Minuszeichen | **teilweise** | `tabular-nums` überall nachgezogen ✔; Minuszeichen bewusst ASCII (**F8**, Entscheidung Planer) |
| Plan 7 – einheitliche Bestätigung vor destruktiven Aktionen | ✔ mit Hinweis | `ConfirmDeleteSheet` mit `confirmLabel`/`pendingLabel`, Wieder-öffnen und Abschließen im selben Muster. Whitelist-Entfernen ohne Bestätigung (siehe „Offene Fragen“) |
| Plan 8 – Lighthouse ≥ 90 in Performance/A11y/Best Practices, PWA installierbar | ✔ | siehe oben |
| Geld = Integer-Cent, kein `any`, Lint sauber, UI Deutsch | ✔ | WP9 fasst keine Geldlogik an; keine Float-Rechnung, kein `any` |
| Keine neuen Abhängigkeiten | ✔ | `package.json`-Diff: **eine** Zeile, das Script `icons:generate` |
| `tests/gaby/**` unangetastet | ✔ | `git diff 7139a56 488ac03 -- tests/gaby` ist leer |
| `npm run check` + `npm run build` grün | ✔ | auch mit meinen 87 zusätzlichen Tests |

## Findings

### F1 – [Major] „Session anlegen“ ist die einzige Schreibaktion ohne Offline-Sperre
- Wo: `src/components/sessions/NewSessionForm.tsx:23–42,67` (kein `useWritesBlocked`, kein
  `OfflineNote`, `disabled={pending}`)
- Beobachtet: Alle anderen Schreibpfade (EntrySheets, CloseSessionPanel, ClosedSessionSection,
  PlayersManager, WhitelistManager, UserRoleList, QuickAmountsEditor) sind offline gesperrt und
  begründen es. `/sessions/new` nicht. Offline getippt: `createSession` wirft im Browser, die
  Ausnahme wird in `onSubmit` nicht gefangen, `setPending(false)` in Zeile 36 wird nie erreicht
  → der Knopf bleibt dauerhaft auf „Wird angelegt …“, es erscheint keine Meldung, und die
  Seite ist nur per Neuladen wieder benutzbar.
- Erwartet: WP9 Schritt 2 – „Offline-Banner … Aktionen währenddessen deaktiviert“. Also
  `const offline = useWritesBlocked();`, `disabled={pending || offline}`, `if (offline) return;`
  in `onSubmit` und ein `<OfflineNote />` unter dem Knopf – genau das Muster, das Siri in den
  sieben anderen Komponenten selbst gesetzt hat.
- Reproduktion: eingeloggt `/sessions/new` öffnen, DevTools → Network → „Offline“,
  „Session anlegen“ tippen. Erwartet: grauer Knopf + Begründung. Beobachtet: aktiver Knopf,
  danach Dauerzustand „Wird angelegt …“.
- Test: `tests/gaby/wp9-pwa.gaby.test.ts` → „WP9 · F1 (offen) – NewSessionForm ohne Offline-Sperre“.

### F2 – [Minor] Sheets geben den Fokus beim Schließen nicht zurück und halten ihn nicht fest
- Wo: `src/components/ui/Sheet.tsx:28–51` (Effekt ohne gemerktes Vorher-Element),
  `Sheet.tsx:56–62` (Backdrop-Button vor dem Dialog im DOM)
- Beobachtet: Beim Öffnen wandert der Fokus korrekt ins Panel, Escape schließt, `role="dialog"`,
  `aria-modal="true"` und ein Name über `aria-label={title}` sind da. Aber: (a) beim Schließen
  geht der Fokus an `document.body` – ein Tastatur- oder Screenreader-Nutzer beginnt nach jedem
  Buy-in wieder ganz oben; (b) es gibt keinen Focus-Trap und der Hintergrund ist nicht `inert`,
  Tab läuft also aus dem Dialog in die Teilnehmerliste dahinter, obwohl `aria-modal="true"`
  genau das ausschließt.
- Erwartet: WP9-Testauftrag „Fokus-Reihenfolge und Labels der Sheets (Screenreader-Basis)“ —
  Fokus beim Öffnen ins Sheet ✔, Escape ✔, **Fokus kehrt beim Schließen zum auslösenden
  Element zurück** ✘, Tab bleibt im Dialog ✘. Zehn Zeilen: `document.activeElement` beim Öffnen
  merken, im Cleanup `.focus()`, plus ein `key === 'Tab'`-Zweig oder `inert` auf dem Hintergrund.
- Reproduktion: `/sessions/<id>`, mit Tab auf eine Teilnehmerkarte, Enter → Sheet öffnet.
  Weiter Tab drücken: der Fokus verlässt das Sheet. Escape → Fokus ist auf `body`, weiteres Tab
  beginnt beim ersten Element der Seite.
- Kein Blocker: `aria-label` ist als Name gleichwertig zu `aria-labelledby`, die Bedienung per
  Touch ist unbeeinträchtigt, und Lighthouse (das nur `/login` sah) misst das nicht.
- Test: „WP9 · F2 (offen) – Sheet ohne Fokus-Rückgabe und ohne Trap“.

### F3 – [Major] Netzabbruch *während* einer Schreibaktion friert den Knopf ein
- Wo: `src/components/sessions/SessionDetailClient.tsx:176–186` (`run`), `:196–240`
  (`submitBuyIn`), `src/components/sessions/NewSessionForm.tsx:28`,
  `src/components/players/PlayersManager.tsx:207`, `src/components/admin/WhitelistManager.tsx:59,126`
- Beobachtet: Kein einziger Aufruf einer Server Action ist in `try/catch`. Bricht die
  Verbindung *nach* dem Antippen ab – der häufige Fall am Tisch: WLAN weg, Zug, Funkloch;
  `navigator.onLine` merkt das oft gar nicht oder erst Sekunden später –, dann rejectet der
  Aufruf im Browser. Danach wird `setPending(false)` nie erreicht: der Knopf bleibt auf
  „Speichert …“/„Schließt ab …“, es gibt **keinen** Toast, und beim optimistischen Buy-in
  (`submitBuyIn`) bleibt zusätzlich die vorläufige Zeile stehen – auf dem Bildschirm sieht das
  aus wie ein gebuchter Buy-in, der nie in der Datenbank landete. Genau dieses Bild soll WP9
  verhindern („Ziel: … verzeiht schlechte Verbindung“), und `OfflineNote` verspricht dem Nutzer
  wörtlich „Sobald das Netz zurück ist, geht es weiter“.
- Erwartet: jeder Action-Aufruf in `try/catch/finally` – `finally { setPending(false) }`, im
  `catch` der bestehende `showError(...)` mit einem deutschen Satz („Keine Verbindung zum
  Server. Der Eintrag wurde **nicht** gespeichert.“) und beim Buy-in das Zurückrollen der
  optimistischen Zeile wie im `!result.ok`-Zweig. (WP9 Ziel + Schritt 2; die Konvention
  „Server Actions werfen nie Richtung Client“ aus den projektweiten Konventionen gilt für den
  Serverfehler, nicht für den Transportfehler – der bleibt hier ungefangen.)
- Reproduktion: `/sessions/<id>`, Buy-in-Sheet öffnen, Betrag eintippen; DevTools → Network auf
  „Offline“ stellen und *erst danach* „Bar“ tippen (oder Netzwerkkabel/WLAN im richtigen Moment
  ziehen). Beobachtet: Knopf bleibt „Speichert …“, kein Toast, vorläufige Zeile bleibt.
- Test: „WP9 · F3 (offen) – Schreibaktionen fangen keinen Netzwerkfehler“.

### F4 – [Minor] Die dokumentierten Kontrastwerte gelten für Hexfarben, die der Browser nicht malt
- Wo: `src/lib/ui/amountTone.test.ts:13–20` (`HEX`), `src/lib/ui/amountTone.ts:9–18`
  (Tabelle im Kommentar), `qa/handoffs/WP9-siri.md:97–106`
- Beobachtet: Der Test rechnet gegen die Tailwind-**v3**-Hexwerte (`#047857`, `#34d399`, …).
  Das Projekt benutzt Tailwind v4; `node_modules/tailwindcss/theme.css` liefert
  `--color-emerald-700: oklch(50.8% 0.118 165.612)` ≈ `#007a55`. Die geprüften Zahlen sind
  also nicht die gerenderten, und die genannten Werte stimmen auch für die Hexfarben nicht
  ganz (5,55 → **5,48**; 6,49 → **6,47**; 10,33 → **10,30**). Ebenso im Kommentar:
  „`opacity-70` = 4,77:1 auf Weiß“ – 4,77 ist der Wert für **opacity-60** (genau: 4,69),
  `opacity-70` liegt bei 6,63.
- Erwartet: Die Werte, die geprüft und dokumentiert werden, sollten die sein, die der Browser
  malt. Sachlich ist nichts kaputt – ich habe alle acht Kombinationen in beiden Farbräumen
  nachgerechnet, **AA hält überall** (schlechtester Wert 5,37) –, aber der Test hat als
  Regressionsbremse eine Lücke: würde jemand die Tokens in `@theme` überschreiben, merkte er
  es nicht. Vorschlag: die oklch-Tripel aus `theme.css` in `HEX` ergänzen (meine
  `fromOklch`-Umrechnung in `tests/gaby/wp9-pwa.gaby.test.ts` lässt sich übernehmen) und die
  Zahlen in Kommentar und Handoff korrigieren.
- Reproduktion: `grep "color-emerald-700" node_modules/tailwindcss/theme.css` und
  `grep "text-emerald-700" .next/static/chunks/*.css` → `color: var(--color-emerald-700)`.

### F5 – [Minor] `global-error.tsx` ignoriert den Dark Mode
- Wo: `src/app/global-error.tsx:31–33` (`background: '#ffffff'`, `color: '#171717'`)
- Beobachtet: Die letzte Auffangseite ist fest hell. Wer nachts am Tisch im Dunkelmodus sitzt,
  bekommt im Absturzfall eine weiße Vollbildfläche.
- Erwartet: WP9 Schritt 4 („Dark Mode über `prefers-color-scheme`“) gilt auch hier. Ohne
  `globals.css` geht das inline über `colorScheme: 'light dark'` plus `background: 'Canvas'` /
  `color: 'CanvasText'` (Systemfarben, brauchen keine Datei) – zwei Zeilen, keine neue Abhängigkeit.
- Reproduktion: DevTools → Rendering → `prefers-color-scheme: dark`, im Root-Layout einen
  `throw` einbauen.

### F6 – [Minor] Zwei graue Knöpfe ohne Begründung im Admin-Bereich
- Wo: `src/components/admin/WhitelistManager.tsx:108,146` (Aufnehmen/Entfernen),
  `src/components/admin/UserRoleList.tsx:82` (Rollen-Select)
- Beobachtet: Beide sind offline korrekt gesperrt, aber ohne `<OfflineNote />`. Das Banner steht
  zwar oben im Header; Siris eigene Begründung („ein grauer Button ohne Begründung ist ein
  Bugreport in Wartestellung“, `OfflineNote.tsx:5–8`) gilt hier genauso, und die Admin-Seite
  ist lang genug, dass das Banner weggescrollt sein kann.
- Erwartet: Konsistenz mit den übrigen sieben Stellen – je ein `<OfflineNote />` unter der
  Gruppe (beim Select z. B. „Rollen lassen sich ohne Verbindung nicht ändern.“).
- Reproduktion: `/admin` offline, ganz nach unten scrollen.

### F7 – [Minor] Gaby WP7-F6 bleibt offen: Zurück-/Abbrechen-Links unter 44 px
- Wo: `src/app/(app)/players/[id]/page.tsx:47` („← Alle Spieler“, `text-sm` ohne Mindesthöhe),
  zusätzlich `src/app/(app)/sessions/new/page.tsx:35` („Abbrechen“, ebenfalls `text-sm` ohne
  Mindesthöhe, dazu `opacity-60`)
- Beobachtet: WP9 hat an der Stelle nur die Deckkraft von 50 % auf 70 % angehoben (Kontrast),
  das Tippziel bleibt bei ~20 px Höhe. F6 aus `qa/reports/WP7-gaby.md:153` ist damit **nicht**
  erledigt – WP9 wäre das Paket dafür gewesen („Mobile-Polish“).
- Erwartet: ≥ 44 px Tippziel wie überall sonst (`min-h-[44px]` + `inline-flex items-center`,
  ggf. `-mx-2 px-2`). Lighthouse `target-size` = 1,0 sagt dazu nichts: gemessen wurde nur
  `/login`.
- Reproduktion: `/players/<id>` und `/sessions/new` im 375-px-Viewport, oben links bzw. rechts.

### F8 – [Minor] Plan-Schritt 6 „Minus mit echtem Minuszeichen“ nicht umgesetzt (Entscheidung Planer)
- Wo: `src/lib/money.ts:19` (`const sign = cents < 0 ? '-' : ''`)
- Beobachtet: bewusst ASCII-Bindestrich, begründet im Handoff (Punkt 6 und Offene Frage 1).
- Erwartet: `docs/ARBEITSPAKETE.md` WP9 Schritt 6 nennt ausdrücklich „Minus mit echtem
  Minuszeichen“. Solange der Plan das sagt und der Code es nicht tut, klaffen Dokument und
  Code auseinander – eines von beidem muss der Planer bewegen.
- **Meine Empfehlung: ASCII beibehalten und stattdessen den Plansatz streichen.** Gründe:
  (a) `formatCents` speist auch `src/lib/settlement/shareText.ts`, und dieser Text geht per
  Copy-Paste nach WhatsApp – ein U+2212 überlebt UTF-8 zwar problemlos, ist aber in Suchen,
  Tabellen-Imports und beim Zurücktippen lästig; (b) mit `tabular-nums` ist der optische
  Gewinn minimal, weil die Ziffernbreite ohnehin fest ist; (c) ein Wechsel nur für die Anzeige
  bräuchte eine zweite Formatierfunktion neben `formatCents` – eine Codestelle mehr, an der
  Geld formatiert wird, und das ist mir die Typografie nicht wert.
  **Falls der Planer trotzdem U+2212 will:** dann nur in einer reinen Anzeigefunktion, der
  Share-Text bleibt ASCII, und ich passe `tests/gaby/money.gaby.test.ts:128,131,134` sowie
  `tests/gaby/wp6-close.gaby.test.ts:214–215,244–246,302,328` in derselben Runde an. Ohne
  ausdrückliche Anweisung des Planers ändere ich meine Erwartungen **nicht** – sie sind seit
  WP0 die Referenz für das Format.

### F9 – [Minor] `theme_color` im Manifest und `theme-color`-Meta widersprechen sich
- Wo: `src/app/manifest.ts:31` (`theme_color: '#047857'`) gegen `src/app/layout.tsx:26–29`
  (`themeColor` `#ffffff` hell / `#0a0a0a` dunkel)
- Beobachtet: Der Splash-Screen der installierten App und die Chrome-Adressleiste beim ersten
  Aufruf ziehen das grüne `theme_color`, die laufende App die weiße/schwarze Meta-Farbe. Beim
  Start blitzt also Grün auf, bevor die App weiß/schwarz wird. Zusätzlich ist
  `background_color: '#ffffff'` fix – im Dunkelmodus ist der Splash weiß.
- Erwartet: Eine bewusste Entscheidung, die auch so im Manifest-Kommentar steht. Fachlich
  richtig wäre entweder `theme_color: '#ffffff'` (nahtlos) oder die grüne Marke bewusst als
  Splash-Farbe – aber dann bitte im Kommentar begründet, weil sonst der nächste die Meta-Tags
  „korrigiert“.
- Reproduktion: Android Chrome installieren und starten (Planer).

## Bewertung der drei offenen Fragen aus Siris Übergabe

1. **Minuszeichen**: siehe F8. Empfehlung **ASCII beibehalten**, Plansatz in
   `docs/ARBEITSPAKETE.md` WP9 Schritt 6 entsprechend anpassen. Kein Nacharbeitsauftrag an Siri.
2. **`deleteOpenSession` ohne UI**: **kein Sicherheitsproblem** – ich habe es angesehen
   (`src/actions/sessions.ts:67–87`): `requireAdmin()` davor, danach die Delete-Policy aus
   `0003`, die auf offene Sessions ohne Abrechnung begrenzt; selbst ein direkt abgesetzter
   Action-Aufruf käme an RLS nicht vorbei. In `docs/SPEC.md` steht kein Anspruch auf einen
   UI-Pfad zum Löschen einer Session. Meine Empfehlung an den Planer: **in WP9 nichts bauen**
   (Siri hat richtig gehandelt, das wäre WP4-Gebiet), sondern als eigenen Punkt hinter WP10
   entscheiden – entweder verdrahten oder entfernen. Toter, aber scharfer Code ist auf Dauer
   eine Stolperfalle, aktuell aber ungefährlich.
3. **Whitelist-Entfernen ohne Bestätigung**: **kein Nacharbeitsgrund.** `role_whitelist` wirkt
   laut `docs/SPEC.md:49` nur beim **ersten** Login; wer schon eingeloggt war, behält seine
   Rolle in `app_users`. Ein Fehlgriff kostet also nichts als ein erneutes Aufnehmen, und der
   Eintrag steht im Audit-Log. Schritt 7 des Plans zielt auf Aktionen, die Daten vernichten.
   Wenn der Planer Einheitlichkeit will: roter Knopf ja, Bestätigungs-Sheet nein.

## Für den Planer: Browser- und Handy-Prüfungen

Diese Punkte kann ich nicht ausführen; sie stehen bis dahin unter „Nicht verifiziert“:

1. **Installation Android Chrome**: Menü → „App installieren“. Erwartet: Chip-Icon (grüne
   Platte, cremefarbener Ring mit acht Kerben), Name „Poker-Kasse“, Start ohne Adressleiste,
   Splash grün (siehe F9).
2. **Installation iOS Safari**: Teilen → „Zum Home-Bildschirm“. Erwartet: quadratisches,
   deckendes Icon (kein schwarzer Rand – das PNG ist vollflächig, das habe ich geprüft),
   Start ohne Safari-Leiste, Statusleiste lesbar.
3. **Start nach Ablauf der Session**: App vom Home-Bildschirm starten, während die
   Supabase-Session abgelaufen ist. Erwartet: Login-Seite **innerhalb** der installierten App,
   danach Sessions-Liste – keine Schleife, keine Rückkehr in den Browser. (Der Redirect-Pfad
   ist getestet, die Standalone-Variante nur am Gerät sichtbar.)
4. **Dark Mode**: DevTools → Rendering → `prefers-color-scheme: dark`, dann `/players` und eine
   abgeschlossene Session ansehen: Plus grün, Minus rot, beide gut lesbar; anschließend hell.
5. **Offline-Banner**: eingeloggt, Session offen, DevTools → Network → „Offline“. Erwartet:
   rotes Banner „Keine Verbindung“ unter dem Header, Buy-in/Stack/Auszahlung grau mit
   Begründung, **„Abbrechen“ und ✕ weiter benutzbar**. Bitte zusätzlich `/sessions/new`
   ansehen – dort erwarte ich laut **F1** das Gegenteil.
6. **Netzabbruch mitten in der Aktion** (F3): Buy-in-Sheet öffnen, Betrag tippen, *dann*
   offline schalten, *dann* „Bar“ tippen. Erwartet wäre eine Fehlermeldung; ich erwarte einen
   dauerhaft hängenden Knopf.
7. **Safe Area**: Geräteemulation „iPhone 14 Pro“, ganz nach unten scrollen – Tab-Leiste über
   dem Home-Indikator, „Neue Session“ über der Tab-Leiste, im Querformat nichts hinter den
   runden Ecken.
8. **Skelette**: Netzwerk „Slow 3G“, zwischen den Tabs wechseln – jede Route zeigt ihr
   Skelett in der Form des echten Bildschirms, nichts springt beim Eintreffen der Daten.
9. **Tippziele** (F7): `/players/<id>` und `/sessions/new` im 375-px-Viewport.

## Nicht verifiziert

- **Echte Installation auf Android/iOS** und das Verhalten im Standalone-Modus (kein Gerät,
  kein Browser in meiner Umgebung). Lighthouse bescheinigt die Installierbarkeit; das ist eine
  starke, aber keine vollständige Zusage.
- **Optik**: Dark Mode, Safe-Area am Notch-Gerät, Skelett-Sprünge, das Icon in echter Größe.
  Ich habe die Pixel gerechnet, nicht gesehen.
- **Lighthouse nur gegen `/login`.** Die Werte für `color-contrast`, `target-size` und
  Accessibility 100 beziehen sich ausschließlich auf die Login-Seite. Alle Bildschirme mit
  Beträgen, Sheets und Tab-Leiste hat Lighthouse nie gesehen – meine Kontrastrechnung und F2/F7
  ersetzen das nur teilweise. Ein Lauf hinter dem Login (mit gesetzten Cookies) wäre in WP10
  sinnvoll.
- **Realtime-Fall am lebenden System**: dass nach ~10 s tatsächlich „Verbindung getrennt“ im
  neuen Shell-Banner erscheint, habe ich nur am Code und an den Unit-Tests geprüft
  (`DISCONNECT_HINT_MS = 10_000` unverändert, `useReportRealtimeStatus` meldet in die Shell,
  Cleanup setzt auf `null`). Zwei Tabs + blockiertes WebSocket: Planer.
- **`npm run rls:smoke`** nicht ausgeführt – WP9 fasst weder Migrationen noch Policies an.
- **Kein `npm ci`** aus frischem `node_modules` (Zeitgründe); `npm run check` und
  `npm run build` liefen gegen den vorhandenen Baum.
- **Die drei geprüften Lighthouse-Artefakte** habe ich nicht selbst nachgefahren (kein
  Headless-Chrome in meiner Umgebung). Geprüft habe ich Herkunft, Zeitstempel, Form-Faktor,
  Kategorie-Scores und die Abwesenheit von Secrets – nicht, dass die Zahlen reproduzierbar sind.

## Runde 2 (nach Nacharbeit auszufüllen)

- F1: offen
- F2: offen
- F3: offen
- F4–F9: offen
