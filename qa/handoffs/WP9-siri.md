# WP9 – Übergabe Siri

## Umgesetzt

### 1. PWA: Manifest, Icons, Apple-Meta

- `src/app/manifest.ts` – Next serviert es als `/manifest.webmanifest`.
  `name`/`short_name` „Poker-Kasse“, `display: standalone`, `orientation: portrait`,
  `start_url: '/'`, `scope: '/'`, `id: '/'`, `theme_color: #047857`,
  `background_color: #ffffff`, `lang: de`.
  **`start_url: '/'` ist mit dem Login-Redirect kompatibel** (geprüft am Produktions-Build):
  `GET /` ohne Session → `307` auf `/login` (`loginPathFor('/') === '/login'`, kein `next`,
  also keine Endlosschleife), nach Google zurück auf `/`. Eine installierte App startet damit
  auf der Session-Liste, solange die Session gilt, sonst auf dem Login – nie auf einer toten URL.
- `scripts/generate-icons.mjs` (+ npm-Script `npm run icons:generate`) erzeugt aus einem
  Chip-Motiv (Distanzfunktion, 4×4-Supersampling) vier PNGs **ohne Bildbibliothek** – reiner
  PNG-Encoder aus `node:zlib` + eigenem CRC32. Keine Binärdatei von Hand, keine Runtime-Abhängigkeit:
  - `public/icons/icon-192.png` (192×192, `any`, runde Platte)
  - `public/icons/icon-512.png` (512×512, `any`)
  - `public/icons/icon-maskable-512.png` (512×512, vollflächig, Motiv in der 80-%-Safe-Zone)
  - `public/icons/apple-touch-icon.png` (180×180, vollflächig – iOS ignoriert Alpha)
  - `public/icons/icon.svg` – dasselbe Motiv als lesbare Quelle, vom Skript mitgeschrieben.
  Nach jeder Motiv-Änderung: `npm run icons:generate`; die PNGs sind committet.
- `src/app/layout.tsx`: `manifest`, `icons` (inkl. `apple-touch-icon`), `appleWebApp`
  (`capable`, `title`, `statusBarStyle`) → Next rendert `mobile-web-app-capable`,
  `apple-mobile-web-app-title`, `apple-mobile-web-app-status-bar-style`;
  `themeColor` je Schema (`#ffffff` hell / `#0a0a0a` dunkel), `colorScheme: 'light dark'`,
  `viewportFit: 'cover'`, `formatDetection: { telephone: false }`.
- **Proxy-Ausnahmen geprüft und ergänzt** (`src/proxy.ts`): `manifest.webmanifest` und `icons/`
  waren schon draußen (auch in `isPublicPath`), der von `manifest.ts` erzeugte Pfad ist genau
  `/manifest.webmanifest` – passt. Zusätzlich **Gaby WP2-F1 miterledigt**:
  `_next/static|_next/image` → `_next/` als Ganzes. `/_next/webpack-hmr` lief bisher durch den
  Proxy und wurde nach `/login` umgeleitet. Verifiziert am laufenden Prod-Build:
  `/_next/some-endpoint` → `404` statt `307`.
- Tests: `src/app/manifest.test.ts` (Pflichtfelder, Icon-Größen, `purpose: maskable`,
  Icon-Dateien existieren und sind nicht leer, alle Icon-Pfade sind `isPublicPath`,
  `start_url` ist eine In-App-Route und nicht die Login-Seite);
  `src/proxy.matcher.test.ts` um `/_next/webpack-hmr`, `/_next/turbopack-hmr` und die vier
  Icon-Pfade erweitert.

### 2. Offline-Banner, kein Daten-Caching

**Kein Service Worker, kein Offline-Cache** – bewusst (SPEC: Beträge dürfen nicht veralten).
Die Installierbarkeit braucht auch keinen (siehe Lighthouse unten).

- `src/lib/connection/state.ts` – reine, getestete Funktion `deriveConnection({online, realtime})`.
  Regeln: offline schlägt alles („Keine Verbindung“, Schreiben blockiert, **kein** Neu-laden-Button,
  weil Neuladen ohne Netz nur eine Fehlerseite bringt); online + Realtime `disconnected` →
  „Verbindung getrennt“ mit „Neu laden“, Schreiben bleibt erlaubt (Server Actions gehen über HTTP);
  `connecting` erzeugt bewusst kein Banner, sonst blinkt es bei jeder Navigation.
  Tests: `src/lib/connection/state.test.ts`.
- `src/components/app/ConnectionProvider.tsx` – hält `navigator.onLine` (+ `online`/`offline`-Events)
  und den Realtime-Status, den die Session-Seite über `useReportRealtimeStatus` meldet.
  Erster Render ist optimistisch „online“ (Server hat kein `navigator`), der Effekt korrigiert –
  sonst blitzt das Banner bei jedem Seitenaufbau auf.
- `src/components/app/ConnectionBanner.tsx` – ein Banner für die ganze App, im Sticky-Header,
  `role="status"` / `aria-live="polite"`.
- `src/components/app/OfflineNote.tsx` – ein Satz unter jedem deaktivierten Knopf; ein grauer
  Button ohne Begründung ist ein Bugreport in Wartestellung.
- **Aktionen offline deaktiviert** (`useWritesBlocked()`), jeweils zusätzlich als Guard in der
  Submit-Funktion, nicht nur am `disabled`:
  `EntrySheets` (Buy-in bar/Liste, Stack eintragen/ändern, Auszahlung, Teilnehmer hinzufügen/neu
  anlegen, `ConfirmDeleteSheet`), `CloseSessionPanel` (Abschließen), `ClosedSessionSection`
  (Wieder öffnen), `PlayersManager` (Anlegen, Umbenennen), `UserRoleList` (Rollen-Select),
  `WhitelistManager` (Aufnehmen, Entfernen), `QuickAmountsEditor` (Speichern).
  „Abbrechen“ und das ✕ der Sheets bleiben **immer** aktiv – aus einem Sheet herauszukommen darf
  nie vom Netz abhängen.

### 3. Lade- und Fehlerzustände

- `loading.tsx` mit Skeletons je Route: `(app)/`, `(app)/players/`, `(app)/players/[id]/`,
  `(app)/log/`, `(app)/admin/`, `(app)/sessions/new/`, `(app)/sessions/[id]/`, `login/`.
  Jedes in der Form des echten Bildschirms, damit beim Eintreffen der Daten nichts springt.
- `src/components/ui/Skeleton.tsx` – `Skeleton`, `SkeletonCard`, `SkeletonList`, `SkeletonScreen`.
  Die Boxen sind `aria-hidden`; der Bereich meldet einmal `aria-busy` + „… wird geladen“, statt
  einem Screenreader ein Dutzend leerer Kästen vorzulesen.
- `error.tsx` mit „Erneut versuchen“: `(app)/error.tsx` (Gruppe, Shell bleibt stehen),
  `(app)/sessions/[id]/error.tsx` (eigener Text: „Es ist nichts verloren gegangen“ – ein Renderfehler
  am Tisch sieht sonst aus wie ein verlorener Buy-in), `src/app/error.tsx` (Root, u. a. Login).
- `src/app/global-error.tsx` – ersetzt das Root-Layout, stylt sich deshalb **inline** und importiert
  außer React nichts; was kaputt sein könnte, darf es nicht brauchen.
- `src/app/not-found.tsx` – deutsche 404 (`notFound()` aus Session- und Spieler-Detail landet hier).
- `src/components/ui/ErrorState.tsx` – ein deutscher Satz, „Erneut versuchen“, `error.digest` klein
  darunter für den Abgleich mit dem Server-Log. Die Original-Fehlermeldung geht in die Konsole,
  nicht auf den Bildschirm (kann Tabellennamen verraten und sagt einem Spieler nichts).

### 4. Dark Mode und Kontrast (WCAG AA)

`prefers-color-scheme` war schon durchgezogen; **die Plus-Farbe fiel in Hell durch**.

- `src/lib/ui/amountTone.ts` – eine Stelle für die Beträge-Farben, mit gemessenen Werten;
  benutzt von `NetAmount`, `ParticipantCard`, `SettlementView`.
- `src/lib/ui/amountTone.test.ts` rechnet die Kontraste **im Test** nach WCAG 2.1 nach
  (relative Luminanz, `(L1+0.05)/(L2+0.05)`) und lässt sie durchfallen, falls jemand die Tokens
  ändert. Gegen `#ffffff` (hell) bzw. `#0a0a0a` (dunkel):

  | Rolle | Hell | Ratio | Dunkel | Ratio |
  |---|---|---|---|---|
  | Plus | `emerald-700` `#047857` | **5,55:1** | `emerald-400` `#34d399` | **10,33:1** |
  | Minus | `red-700` `#b91c1c` | **6,49:1** | `red-400` `#f87171` | **7,16:1** |
  | vorher Plus hell | `emerald-600` `#059669` | **3,77:1** ✗ | – | – |

  Weitere angefasste Stellen: aktiver Tab `emerald-600` → `emerald-700` (gleiche Rechnung),
  Differenz-Zeile in `ClosedNotice` `red-600` → `red-700`, und alle Text-`opacity-50`
  (`#171717` @ 50 % auf Weiß = 3,41:1 ✗) auf `opacity-60`/`opacity-70` (4,77:1 ✓) angehoben:
  `NetAmount`, `ParticipantCard`, `PlayersManager`, `players/[id]/page.tsx`, `TabBar`.
  Lighthouse `color-contrast`: 1,0 (siehe unten).
- `globals.css`: `color-scheme: light dark` auf `:root` und `prefers-reduced-motion`-Block
  (die Skeletons pulsen).

### 5. Safe-Area-Insets

- `globals.css`: `--safe-top/bottom/left/right` aus `env(safe-area-inset-*, 0px)` plus
  `--tabbar-height: 56px`; Utilities `.pb-safe` / `.px-safe`.
- `TabBar`: Padding unten **und** links/rechts (gerundete Ecken im Querformat), Höhe über
  `--tabbar-height`.
- `(app)/layout.tsx`: `main` bekommt
  `padding-bottom: calc(var(--tabbar-height) + var(--safe-bottom) + 1.5rem)` statt des festen
  `pb-28`; der schwebende „Neue Session“-Knopf rechnet genauso.
- `viewport-fit=cover` war schon gesetzt (`src/app/layout.tsx`), `Sheet` hatte seine Safe-Area
  schon aus WP4.

### 6. Zahlenformatierung

- `tabular-nums` ergänzt, wo Beträge stehen und noch keins war: Session-Karte (Buy-ins),
  `ParticipantCard` (Buy-in-/Stack-Zeilen), `BuyInSheet` („Bisher …“), `CashOutSheet`
  („Bereits bar erhalten“), `PayoutSheet` (Kasse/Stack/Auszahlung), `ClosedNotice` (Differenz),
  `QuickAmountsEditor` (Vorschau). `Tile`, `SettlementView`, `HistoryList`, `NetAmount` und die
  Spieler-Detail-`dl` hatten es schon.
- **Echtes Minuszeichen (U+2212) in `formatCents`: nicht geändert.** Gabys Tests erwarten
  ausdrücklich ASCII-Bindestrich: `tests/gaby/money.gaby.test.ts:128,131,134`
  (`[-1, '-0,01 €']`, `[-100, '-1,00 €']`, `[-123456789, '-1.234.567,89 €']`) und
  `tests/gaby/wp6-close.gaby.test.ts:214-215,244-246,302,328` (`'- Can: -40,00 €'`,
  `'Differenz -10,00 €'`). Zusätzlich hängt der WhatsApp-Share-Text daran
  (`src/lib/settlement/shareText.ts`) – ein U+2212 dort wäre in manchen Tastaturen und
  Kopier-Workflows lästig. **Planer-Entscheidung nötig** (siehe „Offene Fragen“).

### 7. Bestätigung vor destruktiven Aktionen

- `ConfirmDeleteSheet` (`src/components/sessions/EntrySheets.tsx`) ist das eine Muster:
  Bottom-Sheet, Folge in Klartext, roter Knopf oben, „Abbrechen“ darunter. Neu:
  `confirmLabel` / `pendingLabel`, damit der Knopf sagt, was passiert.
  - **Teilnehmer entfernen** → „Entfernen“ / „Entfernt …“ (vorher generisch „Löschen“).
  - **Eintrag löschen** → „Löschen“ / „Löscht …“.
- **Wieder öffnen** (`ClosedSessionSection`) geprüft: Sheet, roter Knopf, Pflichtgrund – passt zum
  Muster, nur Offline-Guard ergänzt. **Session abschließen** (`CloseSessionPanel`) ebenso.
- **Session löschen (`deleteOpenSession`, WP4)**: die Server Action existiert
  (`src/actions/sessions.ts:67`), hat aber **in der ganzen App keinen Aufrufer** – es gibt keinen
  UI-Pfad dorthin. Ich habe keinen gebaut: eine neue Funktion wäre Scope-Creep in WP4-Gebiet.
  Siehe „Offene Fragen“.

### 8. Lighthouse (mobil, Produktions-Build)

`npm run build` + `npx next start -p 3100`, dann Lighthouse gegen `http://localhost:3100/login`
(die einzige Seite ohne Session) in echtem Headless-Chrome, Form-Faktor **mobile**:

| Kategorie | Score |
|---|---|
| Performance | **98** |
| Accessibility | **100** |
| Best Practices | **100** |
| SEO | **100** |

Details: FCP 0,8 s · LCP 2,4 s · TBT 20 ms · CLS 0 · Speed Index 0,8 s ·
`color-contrast` 1,0 · `target-size` 1,0 · `viewport` 1,0 · `html-has-lang` 1,0.

Lighthouse 12 hat die **PWA-Kategorie entfernt**, deshalb ein zweiter Lauf mit Lighthouse 11.7.1
nur für `--only-categories=pwa`:

| Audit | Ergebnis |
|---|---|
| PWA-Gesamt | **1,0 (100)** |
| `installable-manifest` | ✓ |
| `maskable-icon` | ✓ |
| `splash-screen` | ✓ |
| `themed-omnibox` | ✓ |
| `content-width` | ✓ |
| `viewport` | ✓ |

Also **installierbar ohne Service Worker** – von echtem Chrome bestätigt, nicht behauptet.

Artefakte: `qa/reports/WP9-lighthouse.json` (LH 12.8.2, vier Kategorien),
`qa/reports/WP9-lighthouse.html` (derselbe Lauf, lesbar),
`qa/reports/WP9-lighthouse-pwa.json` (LH 11.7.1, PWA-Kategorie).
Der Server auf :3100 ist wieder beendet; auf :3000 lief nichts.

## Abweichungen vom Plan

1. **Ein Banner statt zwei.** Der Plan wollte in WP9 ein Offline-Banner, WP5 hatte auf der
   Session-Seite schon ein eigenes „Verbindung getrennt“-Kästchen (`RealtimeNotice`). Zwei Banner
   übereinander helfen niemandem, also meldet die Session-Seite ihren Realtime-Status jetzt in die
   Shell (`useReportRealtimeStatus`) und `ConnectionBanner` zeigt beide Fälle mit klarer Rangfolge
   (offline schlägt Kanal tot). Wortlaut und der „Neu laden“-Knopf aus WP5 sind unverändert
   übernommen, `RealtimeNotice` in `SessionDetailClient.tsx` ist entfallen.
2. **Icons per eigenem PNG-Encoder statt `sharp`.** Der Plan erlaubte eine devDependency; das Motiv
   sind aber drei Kreise und acht Kerben, dafür lohnt keine 30-MB-Nativ-Abhängigkeit, die auf jeder
   Maschine und auf Vercel bauen muss. Ergebnis: **null neue Abhängigkeiten.**
3. **`not-found.tsx` zusätzlich.** Nicht im Plan, aber `notFound()` wird aus zwei Seiten aufgerufen
   und landete sonst auf Next' englischer Default-Seite. Zwanzig Zeilen, deutsch.
4. **Minuszeichen nicht umgestellt** – begründet oben (Punkt 6), auf Anweisung des Auftrags.

## Offene Fragen an den Planer

1. **Echtes Minuszeichen (U+2212)?** Gabys Tests fixieren den ASCII-Bindestrich (Stellen oben),
   deshalb unverändert. Wenn du es willst: das ist eine Änderung an `formatCents` **und** am
   Share-Text, und Gaby müsste ihre Erwartungen anpassen – also deine Entscheidung, nicht meine.
   Mein Vorschlag: **so lassen.** Der Share-Text geht in WhatsApp, und ein U+2212 ist dort mehr
   Risiko als Gewinn; in der UI fällt der Unterschied bei `tabular-nums` kaum auf.
2. **`deleteOpenSession` ohne UI.** Die Action aus WP4 ist implementiert und getestet, aber
   unerreichbar. Soll ich in einer Nacharbeitsrunde einen Einstieg bauen (mein Vorschlag: nur für
   Admins, auf der Session-Detailseite einer **offenen** Session, im `ConfirmDeleteSheet` mit
   Pflicht-Bestätigung des Datums), oder gehört das in ein eigenes Paket? Ich habe es hier
   nicht gebaut, um nicht in WP4 hineinzuregieren.
3. **Whitelist-Eintrag entfernen** (`WhitelistManager`) ist destruktiv, aber ohne Bestätigung und
   mit grauem statt rotem Knopf. Steht nicht in der WP9-Liste des Plans, ist trivial umkehrbar
   (neu aufnehmen) – ich habe es deshalb gelassen. Sag Bescheid, wenn es ins Muster soll.

## Neue Abhängigkeiten

- **Keine.** Weder Runtime noch Dev. Die Icons entstehen aus `node:zlib` und `node:crypto`,
  Lighthouse lief einmalig über `npx` und steht nicht in der `package.json`.
- Neues npm-Script: `icons:generate` → `node scripts/generate-icons.mjs`.

## Prüfung

- `npm run check`: **grün** – 46 Testdateien, **916 Tests**, 09.09.2026, 20:01.
  Neu von mir: 3 Dateien mit 31 Tests (`src/lib/connection/state.test.ts`,
  `src/lib/ui/amountTone.test.ts`, `src/app/manifest.test.ts`) plus 6 zusätzliche Fälle in
  `src/proxy.matcher.test.ts`; Basis war 43 Dateien / 879 Tests.
- `npm run build`: **grün** (Next 16.3.4, Turbopack). `/manifest.webmanifest` wird statisch
  vorgerendert.
- Lighthouse mobil gegen den Produktions-Build auf **Port 3100**: 98 / 100 / 100 / 100,
  PWA 100 (LH 11). Server danach beendet. Port 3000 wurde nie belegt.
- Manuell am laufenden Prod-Build mit `curl` verifiziert:
  `/login` → 200 · `/` ohne Session → 307 auf `/login` · `/manifest.webmanifest` → 200 mit
  korrektem JSON · `/icons/icon-192.png` und `/icons/apple-touch-icon.png` → 200 ·
  `/_next/some-endpoint` → 404 (kein Redirect mehr).
- **Worktree-Hinweis:** `supabase/**/*.sql` musste lokal auf LF normalisiert werden, sonst
  scheitern drei Snapshot-Tests in `tests/gaby/wp1-schema.gaby.test.ts`. `git diff` auf diese
  Dateien ist **leer** (`core.autocrlf=true` normalisiert beim Commit ohnehin) – am Inhalt der
  Migrationen ändert sich nichts. `tests/gaby/**` wurde nicht angefasst.

## So prüft man es

1. `npm ci`, dann `npm run check` und `npm run build` – beides grün.
2. **Manifest:** `npm run build && npx next start -p 3100`, dann
   `curl -s localhost:3100/manifest.webmanifest` – Pflichtfelder, Icons 192/512 + maskable.
   `curl -s -o /dev/null -w "%{http_code}" localhost:3100/icons/icon-192.png` → 200 ohne Session.
   `curl -sI localhost:3100/` → `307` nach `/login` (Login-Redirect ↔ `start_url` kompatibel).
3. **Icons reproduzieren:** `npm run icons:generate` – die vier PNGs müssen byte-identisch bleiben
   (`git status` sauber). Das Skript gibt die SHA-256-Präfixe aus.
4. **Lighthouse nachfahren:**
   `npx lighthouse http://localhost:3100/login --only-categories=performance,accessibility,best-practices,seo --output=json --output-path=… --chrome-flags="--headless=new"`.
   Für die PWA-Kategorie `npx lighthouse@11 … --only-categories=pwa` (LH 12 hat sie entfernt).
5. **Kontrast:** `npx vitest run src/lib/ui/amountTone.test.ts` – rechnet die Ratios selbst nach.
   Im Browser zusätzlich Hell/Dunkel umschalten (DevTools → Rendering → `prefers-color-scheme`)
   und eine Spieler-Liste mit Plus- und Minus-Beträgen ansehen.
6. **Offline-Banner (braucht den Browser, Planer):** eingeloggt eine Session öffnen, in den
   DevTools → Network → „Offline“. Erwartet: rotes Banner „Keine Verbindung“ unter dem Header,
   Buy-in-/Stack-/Auszahlungs-Knöpfe grau mit Begründung darunter, „Abbrechen“ und ✕ weiter
   benutzbar. Zurück auf „Online“: Banner verschwindet, Knöpfe leben wieder.
   Realtime-Fall: Supabase-Websocket blockieren → nach ~10 s gelbes „Verbindung getrennt“ mit
   „Neu laden“, Schreiben bleibt möglich.
7. **Lade-/Fehlerzustände:** Netzwerk auf „Slow 3G“ und zwischen den Tabs wechseln – jede Route
   zeigt ihr Skelett in der Form des echten Bildschirms. Fehlerfall: in `getSessionDetail` kurz ein
   `throw` einbauen → `(app)/sessions/[id]/error.tsx` mit „Erneut versuchen“.
8. **Safe Area / Tab-Leiste:** DevTools-Geräteemulation „iPhone 14 Pro“, ganz nach unten scrollen –
   die Tab-Leiste sitzt über dem Home-Indikator, der Inhalt verschwindet nicht darunter.
9. **Installation (Handy, Planer):** Android Chrome → Menü → „App installieren“; iOS Safari →
   Teilen → „Zum Home-Bildschirm“. Erwartet: Chip-Icon, Start ohne Browser-Leiste.

## Vorschläge (außerhalb des Pakets)

- **WP10:** die `start_url`-Prüfung nach dem Deploy einmal auf der echten HTTPS-URL wiederholen –
  Installierbarkeit hängt an HTTPS, `localhost` ist die einzige Ausnahme.
- Ein Screenshot-Feld (`screenshots` im Manifest, `form_factor: narrow`) macht den Chrome-Install-
  Dialog hübscher. Rein kosmetisch, gehört eher zu WP10.
- `deleteOpenSession` entweder verdrahten (siehe Offene Frage 2) oder entfernen – toter, aber
  scharfer Code ist auf Dauer die schlechtere Variante.
- Der Realtime-Status hängt jetzt in der Shell; damit ließe sich das Banner in einer späteren
  Runde auch auf der Session-Liste zeigen, wenn dort einmal ein Kanal dazukommt.
