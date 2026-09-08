# WP2 – Übergabe Siri

**Datenbank weiterhin nicht eingespielt, Google-Provider nicht aktiv.** Alles ist trotzdem
fertig gebaut. Was ohne Provider passiert, ist bewusst gestaltet: die Login-Seite zeigt den
Satz „Der Google-Login ist in diesem Supabase-Projekt noch nicht aktiviert. Ein Admin muss ihn
unter Authentication → Providers → Google einschalten.“ statt einer rohen Supabase-Meldung.

## Umgesetzt

### Anmeldung

- **`src/app/login/page.tsx`** – Server-Komponente, zentrierte Karte, Titel „Poker-Kasse“,
  ein Button. Liest `?next=` (durch `safeNextPath` gefiltert) und `?error=` und rendert dazu
  den deutschen Satz aus `loginErrors.ts`.
- **`src/components/auth/GoogleSignInButton.tsx`** – Client-Komponente, `signInWithOAuth`
  mit `redirectTo = ${origin}/auth/callback?next=…`. Fehler werden über
  `loginErrorCodeFor()` klassifiziert und als deutscher Text unter dem Button gezeigt
  (`role="alert"`). Das ist die einzige Client-Komponente, die Supabase anfasst – und nur Auth,
  nie eine Tabelle.
- **`src/lib/auth/loginErrors.ts`** (+ Test) – sechs Codes (`provider_disabled`,
  `access_denied`, `missing_code`, `exchange_failed`, `config`, `unknown`) mit je einem
  deutschen Satz; `loginErrorCodeFor()` erkennt u. a. Supabases
  „Unsupported provider: provider is not enabled“.
- **`src/app/auth/callback/route.ts`** – `exchangeCodeForSession(code)`, danach Redirect auf
  `next` (nur `/`-relativ) bzw. `/`. Jeder Fehlerpfad endet auf `/login?error=<code>`;
  die rohe Meldung geht nur ins Serverlog.
- **`src/actions/auth.ts`** – Server Action `signOut()`: `supabase.auth.signOut()`,
  danach `redirect('/login')`.

### Proxy (ersetzt die Middleware)

- **`src/proxy.ts`** (neu) statt `src/middleware.ts` (gelöscht) – Export heißt `proxy`.
  Verifiziert an Next 16.3.4 selbst: `node_modules/next/dist/build/templates/middleware.js`
  wählt `isProxy ? mod.proxy : mod.middleware` (Fallback `default`) und wirft sonst
  `E394 … must export a function named 'proxy'`; `config.matcher` wird unverändert
  ausgewertet (`build/analysis/get-page-static-info.js`). Signatur ist identisch
  (`(request: NextRequest) => Promise<NextResponse>`). Die Deprecation-Warnung im Build
  ist damit weg.
- Regeln: kein Login + geschützter Pfad → `/login?next=<pfad>`; Login + `/login` → `next`
  bzw. `/`; öffentlich sind nur `/login`, `/auth/*`, `/favicon.ico`,
  `/manifest.webmanifest`, `/robots.txt`, `/sitemap.xml`, `/icons/*`.
  Der Matcher nimmt zusätzlich `_next/static`, `_next/image` und Bilddateien aus.
- **`src/lib/supabase/middleware.ts`** behält seinen Namen (so im Plan), liefert jetzt aber
  `{ response, user }` statt nur der Response, plus `withAuthCookies()`, damit ein Redirect
  die frisch rotierten Auth-Cookies nicht verliert. Die Pfadregeln liegen in
  `src/lib/auth/paths.ts`, damit sie unit-testbar sind.
- **`src/lib/auth/paths.ts`** (+ Test) – `isPublicPath`, `safeNextPath`, `loginPathFor`.
  `safeNextPath` ist der Open-Redirect-Schutz: nur `/`-relative Pfade überleben,
  abgewiesen werden absolute URLs, `//host`, `/\host`, Backslashes, Steuerzeichen,
  Überlängen und alles, was wieder in den Login-Fluss zeigt (Schleifenschutz).

### Rollen

- **`src/lib/auth/roles.ts`** (+ Test) – `Role` (aus `database.types.ts` abgeleitet, damit
  Enum und TypeScript nicht auseinanderlaufen), `canEdit`, `isAdmin`, `hasAtLeast`,
  `isRole`, `ROLE_LABELS` (Admin / Bearbeiter / Betrachter), `roleLabel`.
- **`src/lib/auth/getCurrentUser.ts`** – `React.cache()`-umhüllt, nutzt `auth.getUser()`
  (verifiziert das Token, vertraut nicht dem Cookie) und liest die `app_users`-Zeile.
  Liefert `{ id, email, displayName, avatarUrl, role }` oder `null`. Fehlt die Zeile
  (Migrationen noch nicht eingespielt), gilt konservativ `viewer`, und der Grund steht im
  Serverlog.
- **`src/lib/auth/requireRole.ts`** (+ Test) – `requireUser`, `requireEditor`, `requireAdmin`;
  werfen `AppError('FORBIDDEN' | 'UNAUTHENTICATED')` mit deutschem Text.
- **`src/lib/actions/result.ts`** (+ Test) – der im Plan genannte `actionResult()` samt
  `ActionResult<T>`, `AppError`, `ok()`, `fail()`. Übersetzt `AppError` in
  `{ ok:false, error:{ code, message } }`, loggt alles andere und antwortet generisch
  (nie eine Postgres-Meldung Richtung Browser); `redirect()`/`notFound()` dürfen
  durchfliegen.
- **`src/components/auth/RoleGate.tsx`** – rendert Kinder nur ab einer Mindestrolle,
  optional mit `fallback`. Reiner UI-Komfort, keine Sicherheitsgrenze.

### App-Shell

- **`src/app/(app)/layout.tsx`** – Kopfzeile (sticky) mit „Poker-Kasse“ links und
  Avatar + Name + Rollen-Badge rechts, Inhalt, untere Tab-Leiste. Ruft selbst
  `getCurrentUser()` und leitet ohne Session auf `/login` – zweites Schloss hinter dem Proxy.
- **`src/components/app/TabBar.tsx`** – Client-Komponente (braucht `usePathname` für den
  aktiven Tab): Sessions, Spieler, Log, und nur für Admins Admin. Tipp-Ziele 56 px hoch,
  `env(safe-area-inset-bottom)` schon berücksichtigt, Inline-SVG-Icons (keine UI-Bibliothek).
- **`src/components/app/UserMenu.tsx`** – Client-Komponente: Avatar (Google-Bild via
  `next/image` mit `unoptimized`, Fallback auf Initialen), Name, Rolle; Menü mit E-Mail,
  Rolle und „Abmelden“ (Form auf die Server Action). Schließt bei Klick außerhalb und mit Esc.
- **`src/app/(app)/page.tsx`** – vorläufige Startseite „Angemeldet“ mit Name, E-Mail,
  Rollen-Badge und einem `RoleGate`-Beispiel. `src/app/page.tsx` ist dafür entfallen
  (sonst zwei Seiten auf `/`).
- Platzhalterseiten `src/app/(app)/players/page.tsx`, `.../log/page.tsx`, `.../admin/page.tsx`
  – siehe „Abweichungen“.

### Datenbank

- **`supabase/migrations/0005_profile_sync.sql`** (neu) – `sync_auth_user_profile()` als
  `after update of raw_user_meta_data on auth.users` (mit `when (old… is distinct from new…)`),
  aktualisiert `app_users.display_name` und `avatar_url` mit derselben Fallback-Kette wie
  `handle_new_auth_user` – **nie** die Rolle. Meldet sich über
  `set_config('app.profile_sync','on', true)` an, analog zu `app.session_transition` bei den
  Session-RPCs. `revoke all on function … from public, anon, authenticated` am Ende.
- **`0002_functions_triggers.sql`**, zwei Änderungen (die Datenbank ist noch nicht
  eingespielt, deshalb direkt dort statt in einer weiteren Migration):
  - `protect_app_user_columns()` lässt den Profil-Sync-Pfad zu und erlaubt ihm ausschließlich
    `display_name`/`avatar_url`; ändert er `id`, `email`, `role` oder `created_at`, wirft er
    `FORBIDDEN` (kein neuer Fehlercode).
  - **Gaby-Finding F11**: `stamp_actor()` bekommt einen `UPDATE`-Zweig
    (`new.created_by := old.created_by; new.created_at := old.created_at` für `players` und
    `entries`; `settings.updated_by` bleibt wie bisher „wer zuletzt“), und die Trigger
    `stamp_players`/`stamp_entries` laufen jetzt `before insert or update`. Damit ist der
    PostgREST-`PATCH`-Weg auf einen fremden Erfasser zu.
- **`src/lib/database.types.ts` unverändert** (kein Schema-Wechsel).

### Konfiguration

- **`src/lib/env.ts`** (+ Test) – **WP0-Finding F6**: die drei Non-Null-Assertions auf
  `process.env` sind weg. `parseEnv()` ist eine reine, zod-validierte Funktion,
  `publicEnv()` validiert einmal pro Prozess und wirft sonst `EnvError` mit einer deutschen,
  handlungsfähigen Meldung („Die Konfiguration ist unvollständig: … Lege eine .env.local nach
  dem Muster von .env.example an …“). Alle drei Supabase-Helfer nutzen sie; zusätzlich sind
  sie jetzt mit `Database` typisiert (`createServerClient<Database>`).
  Damit daraus kein weißer 500er wird, fängt der Proxy `EnvError` ab und leitet auf
  `/login?error=config` – dort steht der Satz „Die App ist nicht vollständig konfiguriert …“.

## Abweichungen vom Plan

1. **Drei Platzhalterseiten** (`/players`, `/log`, `/admin`) sind zusätzlich entstanden.
   Der Plan verlangt in Schritt 7 eine Tab-Leiste mit genau diesen Zielen; ohne die Seiten
   führen drei von vier Tabs auf 404, und der Planer könnte die Shell nicht sinnvoll ansehen.
   Die Seiten sind je acht Zeilen („kommt mit einem späteren Paket“). `/admin` ist dabei
   schon **serverseitig** geschützt (`isAdmin`), nicht nur im Tab ausgeblendet – WP8 verlangt
   das ohnehin und erbt es so.
2. **`updateSession()` liefert jetzt `{ response, user }`** statt nur der Response, und die
   Redirect-Entscheidung steht in `src/proxy.ts`. Grund: die Pfadregeln sind so pure
   Funktionen und testbar (`src/lib/auth/paths.test.ts`), statt nur im Edge-Runtime prüfbar.
3. **F11 wird still korrigiert, nicht mit einem Fehler quittiert** (`new.created_by :=
   old.created_by`). Der Plan lässt beides zu und nennt genau diese Variante zuerst; ein
   neuer Fehlercode hätte eine deutsche Meldung gebraucht, die kein Nutzer je zu sehen
   bekommt, weil die App `created_by` nie mitschickt.
4. **Die Ausnahme für den Profil-Sync steht in `0002`, nicht in `0005`.** `0005` müsste
   sonst `protect_app_user_columns()` erneut definieren; zwei Definitionen derselben Funktion
   in zwei Dateien laufen früher oder später auseinander. Da nichts eingespielt ist, ist
   `0002` die ehrlichere Stelle. `0005` sagt im Kopfkommentar, dass es die WP2-Fassung von
   `0002` voraussetzt.
5. **`EnvError`-Abfangen im Proxy** ist im Plan nicht vorgesehen. Ohne das wäre bei fehlender
   `.env.local` jede Seite ein 500er – auch `/login`, wo die Erklärung stehen soll.
6. `src/actions/.gitkeep` und `src/lib/auth/.gitkeep` sind entfallen, weil in beiden Ordnern
   jetzt echte Dateien liegen. `src/components/ui/.gitkeep` bleibt (füllt WP4).
7. **Gabys Tests sind unangetastet** – auch `tests/gaby/wp1-schema.gaby.test.ts`. Die
   Zählwerte stimmen weiterhin: es kommt kein Trigger dazu (die beiden `stamp_*`-Trigger
   werden nur von `before insert` auf `before insert or update` erweitert), keine Funktion
   in `0002` und kein neuer Fehlercode. Der Test hat mich einmal zu Recht erwischt: mein
   neues `raise exception` stand über zwei Zeilen und fiel damit aus der Regel „jede
   Ausnahme mit `using errcode = 'P0001'` in einer Zeile“ – das SQL ist angepasst, nicht
   der Test.

## Offene Fragen an den Planer

1. **Der Profil-Sync greift erst beim *zweiten* Login.** `handle_new_auth_user` legt die Zeile
   an, `0005` aktualisiert sie, sobald Google beim nächsten Login geänderte Metadaten liefert.
   Wer sich einmal einloggt und seinen Google-Namen nie ändert, behält den Namen von damals –
   das ist identisch mit dem, was heute käme. Soll `0005` zusätzlich beim ersten Login
   einmal nachziehen (Trigger auch auf `insert`)? Konservativ ist die jetzige Fassung, weil
   sie SPEC §3 wörtlich umsetzt („bei jedem Login … Trigger auf `auth.users`-Update“).
2. **Konto-Löschung** (SPEC §3, letzter Absatz) ist unverändert dadurch abgedeckt, dass die
   `created_by`-FKs keine `on delete`-Regel haben (WP1, Zeile 39 der dortigen Tabelle). In
   WP2 war dazu nichts zu bauen; falls die App später eine verständliche Meldung dafür
   zeigen soll („Konto kann nicht gelöscht werden, bitte auf Betrachter setzen“), gehört das
   nach WP8.
3. **Sind die drei Platzhalterseiten so recht** (Abweichung 1), oder sollen die Tabs bis WP4
   lieber ins Leere zeigen?

## Neue Abhängigkeiten

Keine. `zod` (WP0), `@supabase/ssr` und `next/image` reichen; keine UI-Bibliothek.

## Prüfung

- `npm run check`: **grün** (2026-09-08, 18:16) – typecheck ok, ESLint ohne jede Ausgabe,
  **346 Tests in 17 Dateien** (davon 130 neu in diesem Paket: `env`, `paths`, `roles`,
  `loginErrors`, `requireRole`, `actions/result`, `proxy.matcher`).
- `npm run build`: **grün** – Routen `/`, `/admin`, `/auth/callback`, `/log`, `/login`,
  `/players` (alle dynamisch, weil die Shell Cookies liest), `/_not-found` statisch,
  `ƒ Proxy (Middleware)` aktiv. **Die `middleware`-Deprecation-Warnung aus WP0/WP1 ist weg.**
- `npm run rls:smoke`: nicht erneut ausgeführt – unverändert seit WP1 und ohne eingespielte
  Datenbank nicht aussagekräftig.
- **Nicht verifiziert**: der komplette Live-Pfad (Login, Callback, Rolle aus `app_users`,
  Avatar, Abmelden) – dafür braucht es die eingespielte Datenbank *und* den Google-Provider.
  Ebenso ungetestet gelaufen ist das SQL von `0005` und die zwei Änderungen in `0002`
  (weiterhin kein `psql`, kein Docker).
- Dev-Server nicht gestartet (Regel für Siri).

## So prüft man es

### Ohne Datenbank und ohne Google-Provider (geht sofort)

1. `npm run check` und `npm run build` → beide grün, keine Deprecation-Warnung mehr.
2. Dev-Server über das Browser-Pane (`.claude/launch.json`, Konfiguration `dev`),
   Mobile-Viewport 375 px.
3. **Redirects ohne Login**: `http://localhost:3000/` → landet auf `/login`.
   `http://localhost:3000/players` → `/login?next=%2Fplayers`.
   Ebenso `/log`, `/admin`, `/sessions/irgendwas`.
4. **Open-Redirect**: `http://localhost:3000/login?next=https://example.com` und
   `…?next=//example.com` → nach einem (später möglichen) Login würde daraus `/`; der
   Parameter darf nirgends als externe URL auftauchen. Statisch ist das in
   `src/lib/auth/paths.test.ts` abgedeckt.
5. **Login-Fehlertext ohne Provider**: auf `/login` „Mit Google anmelden“ tippen → der
   Button wird kurz zu „Weiterleitung zu Google …“ und darunter erscheint rot:
   „Der Google-Login ist in diesem Supabase-Projekt noch nicht aktiviert. Ein Admin muss ihn
   unter Authentication → Providers → Google einschalten.“ – **keine** englische
   Supabase-Meldung, kein Stacktrace.
6. **Konfigurationsfehler** (optional): `.env.local` kurz umbenennen, Server neu starten,
   irgendeine Seite aufrufen → Redirect auf `/login?error=config` mit dem Satz „Die App ist
   nicht vollständig konfiguriert (Supabase-Zugangsdaten fehlen). Bitte beim Admin melden.“,
   im Terminal die ausführliche deutsche Meldung aus `src/lib/env.ts`. Danach zurückbenennen.

### Sobald Migrationen eingespielt und der Provider aktiv ist

7. `0001` – `0004` wie in `qa/handoffs/WP1-siri.md` beschrieben einspielen, **danach `0005`**
   (neues Query-Fenster, `Success. No rows returned`). `0005` braucht dieselben Rechte wie
   `0002` (Trigger auf `auth.users`) – im SQL-Editor des Dashboards ist das der Standard.
8. Anmelden. Erwartet: Rücksprung auf `/`, Kopfzeile mit Google-Avatar, Google-Name und
   Rollen-Badge; auf der Startseite Name, E-Mail und Rolle.
9. `select email, role, display_name, avatar_url from public.app_users;` – Rolle laut
   `role_whitelist` (Admin für die Seed-Adressen, sonst `viewer`), Name und Bild gefüllt.
10. **Rolle**: mit einem Viewer-Konto anmelden → kein Admin-Tab, Startseite sagt „Als
    Betrachter kannst du alles lesen, aber nichts erfassen.“; `/admin` direkt aufrufen →
    „Kein Zugriff“ (serverseitig, nicht nur ausgeblendet).
11. **Abmelden**: Avatar antippen → Menü mit E-Mail, Rolle, „Abmelden“ → landet auf `/login`;
    danach `/` erneut aufrufen → wieder `/login`.
12. **Eingeloggt auf `/login`** → sofortiger Redirect auf `/`.
13. **Profil-Sync (0005)**: Google-Anzeigenamen oder -Bild ändern, neu anmelden, dann
    `select display_name, avatar_url, role from public.app_users where email = '…';`
    → Name/Bild neu, **Rolle unverändert**. Gegenprobe:
    `update public.app_users set role = 'admin' where …` als normaler Nutzer bleibt geblockt.
14. **F11**: als Editor eingeloggt einen Spieler anlegen, dann per PostgREST
    `patch /players?id=eq.<id>` mit `{"created_by":"<fremde-uuid>"}` schicken → die Antwort ist
    erfolgreich, aber `select created_by from public.players where id = …` zeigt weiterhin die
    eigene ID. Dasselbe für `entries`.

## Vorschläge (außerhalb des Pakets)

- **`src/lib/errors/de.ts`** (WP5, laut WP1-Handoff 22 Codes) kann `AppError` und
  `actionResult()` aus diesem Paket direkt benutzen: die Übersetzung gehört in eine
  `mapPostgresError()`, die vor `AppError` gehängt wird.
- **Toast/Fehleranzeige**: `actionResult` liefert schon `{ code, message }`; WP4 braucht dazu
  nur noch die UI-Komponente.
- **`scripts/rls-smoke.ts`** parst `.env.local` weiterhin selbst. Es könnte jetzt
  `parseEnv()` aus `src/lib/env.ts` benutzen (nur der Datei-Parser bleibt eigen, weil das
  Script ohne Next läuft).
- **Audit-Trigger auf `role_whitelist`** (aus WP1 offen) – gehört in WP8, wenn die Whitelist
  eine UI bekommt.
- **`updated_at` beim Profil-Sync**: `touch_updated_at` läuft mit, das ist gewollt. Wer später
  „zuletzt gesehen“ anzeigen will (WP8 hat es gestrichen, weil `auth.users.last_sign_in_at`
  nicht lesbar ist), hätte darin einen brauchbaren Ersatz.
