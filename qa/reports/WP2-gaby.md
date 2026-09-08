# WP2 – Prüfbericht Gaby

**Urteil: FREIGEGEBEN** (mit vier Minor-Hinweisen; keine Blocker, keine Major)

Geprüfter Stand: Commit `4de9bd1` „WP2: google auth, role plumbing, app shell“ auf `main`.
Gelesen: `docs/ARBEITSPAKETE.md` (Konventionen + WP2 Plan 1–13, DoD, Testauftrag),
`qa/handoffs/WP2-siri.md`, `docs/SPEC.md` §3, `docs/WORKFLOW.md`, der vollständige Diff und
alle 30 neuen bzw. geänderten Quelldateien.

---

## Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `git show 4de9bd1 --stat` | 37 Dateien, +2130/−43; `src/middleware.ts` gelöscht, `src/proxy.ts` neu |
| `npm run check` (vor meinen Tests) | **grün** – typecheck ok, ESLint ohne Ausgabe, 346 Tests in 17 Dateien, 0,99 s |
| `npm run build` | **grün** – Routen `/`, `/_not-found`, `/admin`, `/auth/callback`, `/log`, `/login`, `/players`; `ƒ Proxy (Middleware)` aktiv; **keine `middleware`-Deprecation-Warnung mehr** |
| `npm run check` (nach meinen Tests) | **grün** – **445 Tests in 19 Dateien**, 1,11 s |
| `npm run rls:smoke` | nicht ausgeführt (Datenbank nicht eingespielt – ohne Schema ohne Aussagekraft, unverändert seit WP1) |

Eigene Tests (neu, laufen bei `npm test` mit):

- **`tests/gaby/redirect.gaby.test.ts`** – 65 Tests. Prüft den Open-Redirect-Schutz nicht am
  Wortlaut der Hilfsfunktion, sondern an der Eigenschaft, auf die es ankommt: was am Ende in
  `new URL(next, base)` landet — genau die Auflösung, die `src/proxy.ts`,
  `src/app/auth/callback/route.ts` und `src/app/login/page.tsx` machen — bleibt auf der eigenen
  Herkunft. Der Weg geht dabei durch die echte Query-Dekodierung (`URLSearchParams`), weil
  `%2F%2F` erst dort wieder zu `//` wird.
  - 20 Angriffsmuster einzeln: `https://…`, `//host`, `%2F%2Fhost`, `%2f%2fhost`, `%5C%5Chost`,
    `/%09//host`, `/%0D%0A//host` (Header-Splitting), `/%00//host`, `////host`, `%20//host`,
    `javascript:`, `data:` — alle landen auf `/`.
  - Pfad-Normalisierung (`/..//host`, `/%2e%2e//host`, `/x/../..//host`): überlebt den Guard als
    echter Pfad, löst aber nachweislich zu `http://localhost:3000//host` auf — **gleiche
    Herkunft**, also kein Leck.
  - Drei Eigenschaftstests mit `fast-check`, zusammen 3 500 Durchläufe: für **jeden** String gilt
    `safeNextPath(x)` beginnt mit genau einem `/` und `new URL(…, base).origin` bleibt lokal;
    auch der komplette Weg Proxy → `/login?next=…` → Login-Seite → Auflösung bleibt lokal.
  - Dazu der Proxy-Matcher (Ausnahmen und Nicht-Ausnahmen) und `isPublicPath`.
- **`tests/gaby/wp2-auth.gaby.test.ts`** – 34 Tests. Rollenwächter über `actionResult`
  (viewer/editor/admin in allen Kombinationen), exakte Fehlerform, Nichtdurchreichen von drei
  echten Postgres-Meldungen, Login-Fehlertexte, `parseEnv`, sowie Repo-Zusagen
  (`process.env` nur in `env.ts`, kein Service-Role-Key, keine Tabellenzugriffe aus
  Client-Komponenten, `use server` in `src/actions/*`, Admin-Tab serverseitig) und die
  SQL-Eigenschaften von `0005` und der F11-Änderung in `0002`.

Beim Schreiben habe ich gezielt versucht, den Guard zu brechen. **Es ist mir nicht gelungen.**
Der einzige Weg, der `safeNextPath` passiert und trotzdem eine fremde Herkunft ergeben könnte,
wäre ein Tabulator oder Zeilenumbruch am Anfang (`new URL()` entfernt die stillschweigend:
`new URL('/\t//evil', base)` ergibt tatsächlich `http://evil/`) — genau das fängt die
Steuerzeichenprüfung in `paths.ts:59` ab, und die Prozentkodierung `%09` wird von
`searchParams.get()` vorher dekodiert, läuft also in dieselbe Sperre.

---

## DoD-Abgleich

| DoD-Punkt | Status | Anmerkung |
|---|---|---|
| Ohne Login landet jeder Pfad auf `/login` | ✔ statisch belegt | Matcher greift für alle App-Pfade; `proxy.ts:35–39` leitet ohne Session auf `loginPathFor(pfad)`. Zweites Schloss in `src/app/(app)/layout.tsx:17–18`. Live-Klick macht der Planer (unten). |
| Nach Login: `app_users`-Zeile, Rolle laut Whitelist, Name + Avatar, Abmelden | ⏸ nicht verifizierbar | Kein Google-Provider, keine eingespielte DB. Code-Weg ist vollständig und plausibel. |
| `npm run check` grün | ✔ | 445 Tests grün, ESLint ohne Ausgabe, typecheck ok |

### Testauftrag WP2 im Einzelnen

| Auftrag | Status | Beleg |
|---|---|---|
| 1a Matcher nimmt `/_next/*`, `/favicon.ico`, `/manifest.webmanifest`, `/icons/*` aus | ⚠ teilweise | `favicon.ico`, `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, `icons/`, Bilddateien ✔; von `/_next/*` nur `static` und `image` → **F1 (Minor)** |
| 1b `next` gegen Open Redirect, testbare Hilfsfunktion vorhanden | ✔ | `safeNextPath` in `src/lib/auth/paths.ts:49` – pure Funktion, kein Inline-Code im Proxy. `tests/gaby/redirect.gaby.test.ts` |
| 2 Callback: `exchangeCodeForSession`, Fehlerpfad, Redirect-Ziel validiert | ✔ | `route.ts:35` Austausch; `:20–27` Provider-Fehler, `:31` fehlender Code, `:37–40` Austausch-Fehler – **jeder** Pfad endet auf `/login?error=<code>`, die rohe Meldung nur im Serverlog (`:38`). Ziel läuft durch `safeNextPath` (`:16`) |
| 3 `getCurrentUser` mit `React.cache`, kein doppelter DB-Zugriff | ✔ | `getCurrentUser.ts:23` `cache(...)`; genau **ein** `.from('app_users')` im ganzen `src/`, Layout und Startseite teilen sich den Aufruf. `auth.getUser()` statt `getSession()` – Token wird verifiziert, nicht dem Cookie geglaubt |
| 4 `requireEditor`/`requireAdmin`/`actionResult` unit-getestet, Form `{ok:false,error:{code,message}}`, deutsch | ✔ | Siris `requireRole.test.ts`, `result.test.ts` + meine unabhängige Prüfung. `redirect()`/`notFound()` fliegen korrekt durch (`result.ts:54`) |
| 5 `env.ts` zod-validiert, verständliche Meldung, keine Non-Null-Assertions | ✔ | `grep -rn "process.env" src` → nur `src/lib/env.ts:82–83` (plus drei Kommentare); kein `!` mehr. WP0-Finding F6 damit erledigt |
| 6 Admin-Tab serverseitig, Abmelden als Server Action | ✔ | `layout.tsx:36` `showAdmin={isAdmin(user.role)}` – der Tab entsteht gar nicht erst, kein CSS-Trick; `/admin` prüft zusätzlich selbst (`admin/page.tsx:13`). `signOut` in `src/actions/auth.ts` mit `'use server'`, eingebunden als `<form action={signOut}>` |
| 7 `0005` + F11-Änderung in `0002` SQL-Review | ✔ | siehe unten |
| 8 Kein Service-Role-Key, keine Secrets, keine Client-Schreibzugriffe | ✔ | `grep -rn "from('" src` → **eine** Fundstelle: `getCurrentUser.ts:34` (Server). Die einzige Client-Komponente mit Supabase (`GoogleSignInButton`) fasst nur `auth` an. Kein `service_role`, kein JWT, kein `sb_secret_` im Repo |
| 9 `npm run check`, `npm run build` | ✔ | beide grün, kein `npm ci` ausgeführt |

### SQL-Review (Auftrag 7)

- **Profil-Sync setzt nie `role`.** `0005:60–66` schreibt ausschließlich `display_name` und
  `avatar_url`; mein Test zerlegt das `update`-Statement und prüft, dass **genau** diese zwei
  Spalten zugewiesen werden. Zusätzlich hält der Schutz-Trigger dagegen: im Sync-Zweig
  (`0002:151–164`) wirft er `FORBIDDEN`, sobald `id`, `email`, `role` oder `created_at`
  abweichen. Damit sind alle Spalten von `app_users` abgedeckt — `updated_at` bleibt bewusst
  offen, weil `touch_updated_at` mitläuft.
- **Schutz-Trigger-Pfad.** Die Anmeldung über `set_config('app.profile_sync','on',true)` ist
  transaktionslokal und spiegelt das bereits abgenommene Muster `app.session_transition` aus
  WP1. Ein `authenticated`-Client kann diese Einstellung über PostgREST nicht selbst setzen
  (`set_config` liegt in `pg_catalog` und ist nicht als RPC exponiert), also ist das kein
  Schlupfloch. `protect_last_admin` läuft weiter mit, stört aber nicht, weil die Rolle
  unverändert bleibt. `revoke all … from public, anon, authenticated` ist gesetzt.
- **`stamp_*` bei UPDATE hält `created_by`.** `0002:224–228` setzt für `players` und `entries`
  `new.created_by := old.created_by` und `new.created_at := old.created_at`; die Trigger laufen
  jetzt `before insert or update`. Der PostgREST-`PATCH`-Weg auf einen fremden Erfasser ist
  damit zu — **WP1-Finding F11 ist behoben.** `sessions` war schon über `IMMUTABLE_FIELD`
  (`0002:575–579`) dicht, `session_players` hat keine Update-Policy. Der frühe Ausstieg bei
  `auth.uid() is null` (`0002:220`) bleibt: er betrifft nur SQL-Editor/Seed, nicht den
  PostgREST-Weg, und ist im Kommentar begründet.
- **Mein `tests/gaby/wp1-schema.gaby.test.ts` ist unangetastet** (`git show 4de9bd1 -- tests/`
  liefert keinen Diff) und weiterhin grün. Es waren **keine** Zählwerte anzupassen: es kommt
  weder ein Trigger noch eine Funktion noch ein Fehlercode dazu. Dass Siri stattdessen das SQL
  an die Regel „jede Ausnahme mit `using errcode = 'P0001'` in einer Zeile“ angepasst hat,
  statt den Test aufzuweichen, ist genau richtig. **Akzeptabel — sogar besser als erlaubt.**

### Planer-Entscheidungen

Die beiden Vorgaben sind geprüft und passen zum Code: Der Profil-Sync nur bei `update of
raw_user_meta_data` ist korrekt umgesetzt (`0005:78–82`, mit `when`-Klausel, sodass ein bloßer
`last_sign_in_at`-Stempel den Rumpf nicht auslöst), und die drei Platzhalterseiten sind je acht
bis dreißig Zeilen ohne Nebenwirkung. Kein Finding daraus.

---

## Findings

### F1 – [Minor] Matcher nimmt von `/_next/*` nur `static` und `image` aus

- **Wo**: `src/proxy.ts:58`
- **Beobachtet**: Der Matcher schließt `_next/static` und `_next/image` aus, nicht `_next/`
  insgesamt. Ein Aufruf wie `/_next/webpack-hmr` läuft deshalb durch den Proxy und wird ohne
  Session auf `/login` umgeleitet.
- **Erwartet**: WP2 Testauftrag, erster Spiegelstrich, fragt nach `/_next/*` als Ganzes.
- **Auswirkung**: In der Produktion keine — dort existieren unter `/_next/` nur `static` und
  `image`. Betroffen ist der Entwicklungsbetrieb (HMR-Kanal auf der Login-Seite, solange man
  nicht angemeldet ist) und jeder künftige `_next`-Endpunkt.
- **Reproduktion**: `tests/gaby/redirect.gaby.test.ts`, Block „Proxy-Matcher“; dort ist der
  Matcher als Regex ausführbar: `matcher.test('/_next/webpack-hmr')` ergibt `true`.
- **Vorschlag**: `_next/static|_next/image` durch `_next/` ersetzen. Mein Test ist so
  geschrieben, dass er dadurch nicht rot wird (Kommentar in der Datei).

### F2 – [Minor] Callback verlässt sich auf `request.nextUrl.origin` (Risiko erst bei WP10)

- **Wo**: `src/app/auth/callback/route.ts:15`, `:42`, `:46`
- **Beobachtet**: Das Redirect-Ziel wird gegen `request.nextUrl.origin` gebaut. Hinter einem
  Load-Balancer kann `origin` die interne Adresse sein statt der öffentlichen; Supabases eigenes
  Next.js-Beispiel zieht deshalb `x-forwarded-host` heran.
- **Erwartet**: Nach dem Login landet der Nutzer auf der öffentlichen Domain (WP2 Plan 2).
- **Auswirkung**: Lokal keine. Kann beim Deployment (WP10) zu einem Login führen, der auf einer
  falschen Adresse endet.
- **Reproduktion**: Nicht lokal reproduzierbar; sichtbar erst hinter einem Proxy.
- **Vorschlag**: Nicht in WP2 ändern, sondern in WP10 als Prüfpunkt aufnehmen.

### F3 – [Minor] Avatar wird `unoptimized` von beliebiger Fremdadresse geladen

- **Wo**: `src/components/app/UserMenu.tsx:91–103`
- **Beobachtet**: `next/image` mit `unoptimized` umgeht bewusst die Host-Prüfung aus
  `next.config.ts`. Der Browser des Betrachters holt das Bild direkt von der Adresse, die in
  `app_users.avatar_url` steht.
- **Erwartet**: Bei Google-Login kommt dort eine Google-CDN-Adresse an, das ist harmlos. Die
  Begründung im Kommentar ist nachvollziehbar (verschiedene Google-Hosts).
- **Auswirkung**: Gering. Sollte später ein zweiter Provider oder eine editierbare Avatar-URL
  dazukommen, wird daraus ein Weg, die IP jedes Betrachters an einen fremden Server zu geben.
- **Vorschlag**: Entweder `remotePatterns` auf `lh3.googleusercontent.com` &
  `*.googleusercontent.com` setzen und `unoptimized` streichen, oder in `getCurrentUser` nur
  `https://`-URLs auf `googleusercontent.com` durchlassen. Nicht in WP2 nötig.

### F4 – [Minor] Direkter Aufruf von `/login` zeigt bei kaputter Konfiguration keinen Hinweis

- **Wo**: `src/proxy.ts:27`
- **Beobachtet**: Bei `EnvError` und `pathname === '/login'` liefert der Proxy `NextResponse.next()`
  ohne `?error=config`. Die Login-Seite erscheint dann ohne den erklärenden Satz; der kommt erst,
  wenn man den Button drückt (dort greift der `catch` in `GoogleSignInButton`), oder wenn man
  über eine geschützte Seite auf `/login?error=config` geleitet wurde.
- **Erwartet**: Laut Handoff („Konfigurationsfehler“) soll der Satz „Die App ist nicht vollständig
  konfiguriert …“ erscheinen. Für den häufigsten Fall (jemand ruft direkt `/login` auf) tut er
  das nicht sofort.
- **Reproduktion**: `.env.local` umbenennen, Server neu starten, direkt `http://localhost:3000/login`
  aufrufen → Karte ohne Fehlermeldung.
- **Vorschlag**: Statt `NextResponse.next()` auf `/login?error=config` umschreiben, wenn der
  Parameter noch fehlt (`NextResponse.rewrite`/`redirect` mit Schleifenschutz über die Prüfung
  `searchParams.get('error') !== 'config'`).

---

## Nicht verifiziert

- **Der komplette Live-Pfad**: Login, Callback, `app_users`-Zeile, Rolle aus der Whitelist,
  Avatar, Abmelden, Profil-Sync. Grund: die Migrationen sind nicht eingespielt und der
  Google-Provider ist nicht aktiv. Das gilt **nicht** stillschweigend als bestanden.
- **Das SQL von `0005` und die zwei Änderungen in `0002` sind nie gelaufen.** Kein `psql`, kein
  Docker, keine eingespielte Datenbank. Ich habe sie gelesen und die Eigenschaften als
  Textprüfung festgehalten, nicht ausgeführt. Beim Einspielen ist `0005` **nach** `0002` in der
  WP2-Fassung nötig; `0005` weist im Kopfkommentar darauf hin.
- **F11 in der Praxis**: dass ein `PATCH /players?id=eq.<id>` mit fremdem `created_by`
  wirkungslos bleibt, ist SQL-seitig korrekt gebaut, aber nicht gegen eine laufende Datenbank
  gezeigt.
- **`npm run rls:smoke`**: nicht ausgeführt, unverändert seit WP1 und ohne Schema ohne Aussage.
- **Browser**: ich starte keinen Dev-Server (Regel für Gaby). Siehe nächster Abschnitt.

---

## Was der Planer im Browser prüfen soll

Dev-Server über das Browser-Pane (`.claude/launch.json`, Konfiguration `dev`),
Mobile-Viewport 375 px. Ohne Datenbank und ohne Provider ist genau das hier sichtbar:

**1. Redirect ohne Login (DoD-Punkt 1).** Nacheinander aufrufen:

| Eingabe | Erwartete Adresszeile danach |
|---|---|
| `http://localhost:3000/` | `…/login` — **ohne** `?next=` |
| `http://localhost:3000/players` | `…/login?next=%2Fplayers` |
| `http://localhost:3000/log` | `…/login?next=%2Flog` |
| `http://localhost:3000/admin` | `…/login?next=%2Fadmin` |
| `http://localhost:3000/sessions/irgendwas` | `…/login?next=%2Fsessions%2Firgendwas` |
| `http://localhost:3000/players?sort=name` | `…/login?next=%2Fplayers%3Fsort%3Dname` |

Wichtig ist beides: dass umgeleitet wird **und** dass das Ziel gemerkt wird. Keine dieser Seiten
darf auch nur kurz Inhalt zeigen.

**2. Open Redirect (Gegenprobe zu meinen Tests, F-frei).** Aufrufen:
`http://localhost:3000/login?next=https://example.com`, dann `…?next=//example.com`,
dann `…?next=%2F%2Fexample.com`. Erwartet: Die Login-Karte erscheint normal, und in der
Seitenquelle bzw. im Netzwerk-Tab taucht **nirgends** `example.com` als Ziel auf. Der Parameter
wird verworfen, nicht übernommen. (Statisch ist das mit 3 500 Durchläufen abgedeckt; das hier
ist nur die Sichtprüfung, dass er nicht an anderer Stelle wieder auftaucht.)

**3. Login-Seite ohne aktiven Provider.** Auf `/login`:
- Zentrierte Karte, Titel **„Poker-Kasse“**, darunter „Melde dich mit deinem Google-Konto an.“,
  ein Button **„Mit Google anmelden“** mit Google-Logo, Höhe mindestens 52 px.
- Button antippen → Beschriftung wechselt kurz auf **„Weiterleitung zu Google …“**, dann
  erscheint darunter rot umrandet **genau dieser Satz**:
  „Der Google-Login ist in diesem Supabase-Projekt noch nicht aktiviert. Ein Admin muss ihn
  unter Authentication → Providers → Google einschalten.“
- **Nicht** erscheinen dürfen: eine englische Supabase-Meldung („Unsupported provider …“), ein
  Stacktrace, eine weiße Fehlerseite. Der Button muss danach wieder bedienbar sein.

**4. Nebenbei**: Auf `/login` darf **keine** untere Tab-Leiste und **kein** Avatar zu sehen sein
(die Shell liegt in `(app)`, die Login-Seite daneben).

Sobald Migrationen eingespielt und der Provider aktiv sind, gelten zusätzlich die Schritte 7–14
aus `qa/handoffs/WP2-siri.md`; besonders Schritt 10 (Viewer sieht keinen Admin-Tab **und** kommt
über die direkte Adresse `/admin` nur auf „Kein Zugriff“) und Schritt 13 (Profil-Sync ändert
Name und Bild, **nicht** die Rolle).

---

## Bewertung in einem Satz

Ein sauberes, defensiv gebautes Paket: der Open-Redirect-Schutz hält 3 500 zufälligen und 20
gezielten Angriffen stand, es gibt keinen einzigen Client-seitigen Tabellenzugriff und kein
Secret, die WP0- und WP1-Findings F6 und F11 sind mit erledigt, und `check` wie `build` sind
grün. Die vier Hinweise sind Kosmetik bzw. Vorarbeit für WP10 und rechtfertigen keine
Nacharbeitsrunde.
