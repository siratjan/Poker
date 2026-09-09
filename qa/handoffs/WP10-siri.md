# WP10 – Übergabe Siri

Umgesetzt ist alles, was **ohne** GitHub-Repo, Vercel-Konto und Produktions-URL machbar ist.
Alles, was Zugänge braucht, ist so vorbereitet und beschrieben, dass der Planer es abarbeiten
kann, ohne nachzufragen.

## Umgesetzt

**Doku**

- `docs/BETRIEB.md` (neu) — Betriebshandbuch:
  - Feste Werte + Rollenmodell in Kurzform, Platzhalter `<PROD_URL>` / `<REPO_URL>` markiert.
  - **1. Rollen pflegen**: Admin-Seite (Nutzer vs. Whitelist, inkl. der beiden Sicherungen
    „letzter Admin“ und „Whitelist wirkt nur beim ersten Login“), SQL-Fallback für den Fall
    ohne Admin, `supabase/seed.sql` beim Aufsetzen; am Ende eine Fünf-Zeilen-Kurzanleitung
    „neuen Editor freischalten“ (Gabys Testauftrag).
  - **2. Migration nachziehen**: Tabelle aller sieben Migrationen, Weg A SQL-Editor
    (Reihenfolge, einzeln), Weg B CLI (`link` + `db push`), Idempotenz erklärt, Prüfabfragen
    für Tabellen/Views/RLS, `npm run rls:smoke`, Verhalten bei Abbruch.
  - **3. Logs**: Vercel Functions/Runtime, Vercel Build, Supabase Auth/Postgres/API,
    App-Audit-Log (Tab „Log“), Browser-Konsole — je mit „wofür“ und Aufbewahrung.
  - **4. Die drei realen Stolpersteine**: „Provider nicht konfiguriert“, „View fehlt“
    (`session_overview` / `player_stats`, Migration 0006/0007), „viewer statt admin“ —
    jeweils Symptom → Ursache → Behebung mit fertigem SQL.
  - **5. URLs**: Supabase Site URL + Redirect URLs (inkl. Preview-Wildcard
    `https://*-<TEAM>.vercel.app/**` und localhost), Google-JavaScript-Ursprünge und die eine
    unveränderliche Weiterleitungs-URI; dazu warum die App selbst keine Site-URL-Variable hat.
  - **6. Kurz-Checkliste „es geht nicht“**.
- `docs/DEPLOY.md` (neu) — Schritt-für-Schritt-Checkliste für den Planer: `git remote add
  origin <REPO_URL>` + Push, Vercel-Import (Framework Next.js), Env-Variablen für Production
  **und** Preview, Supabase-URLs, Google-Ursprünge, Deployment Protection (Preview an,
  Production aus), Region, Migrationen, Smoke-Test, automatische Deploys; am Ende eine
  Abhak-Liste. Platzhalter `<REPO_URL>`, `<PROD_URL>`, `<TEAM>` durchgehend markiert.
- `qa/reports/WP10-smoke.md` (neu) — Vorlage mit Rahmen-Tabelle, den sechs Smoke-Schritten
  (Login, Session anlegen, Buy-in, Cash-out, Abschluss, Log) mit leeren Ergebnisfeldern,
  Zusatzprüfungen und Gesamturteil `OFFEN`.
- `README.md` — Dokumentenliste um SETUP-AUTH / DEPLOY / BETRIEB ergänzt, Befehlsliste um
  `rls:smoke`, `icons:generate`, `types:gen`, neuer Abschnitt „Datenbank und Deployment“ mit
  dem wichtigen Satz, dass ein Deploy keine Migrationen einspielt.
- `.env.example` — kommentiert (woher die Werte kommen, dass beide Variablen öffentlich sind,
  dass der Service-Role-Key nirgendwohin gehört, Verweis auf `docs/DEPLOY.md`); Variablennamen
  unverändert und vollständig.
- `.gitignore` — `!.env.example` als Ausnahme zu `.env*` ergänzt, damit die Musterdatei nicht
  versehentlich aus der Versionierung fällt.

**Konfiguration**

- `vercel.json` (neu): `{"regions": ["fra1"]}`. Begründung: Nutzer und Supabase-Projekt liegen
  in Europa, Vercels Standard ist `iad1` (Washington) — ohne die Angabe hängt an jedem
  serverseitigen Rendern ein Atlantik-Roundtrip zur Datenbank. Eine Region ist auch im
  Hobby-Tarif erlaubt. Sonst nichts in der Datei; Build-Kommandos bleiben Vercel-Standard.

**Code — Callback-Fix (Gaby WP2-F2)**

- `src/lib/auth/origin.ts` (neu): reine Funktion `publicOrigin(headers, fallbackOrigin,
  { trustForwardedHeaders })`. Nimmt **nur den Host** aus `x-forwarded-host` (erster Eintrag
  einer Kette), prüft ihn gegen ein striktes Host-Muster (Hostname + optionaler Port, max. 255
  Zeichen) und das Schema gegen `http`/`https`, sonst `https`. Alles andere — Pfad, Query,
  Fragment, `//`, `user@`, Backslash, Leerzeichen, Zeilenumbruch, Schema-Präfix, Überlänge —
  fällt auf `request.nextUrl.origin` zurück. Es kann also weder ein fremder Pfad noch ein
  fremdes Schema aus einem Header in die Redirect-URL geraten.
- `src/app/auth/callback/route.ts`: baut alle vier Redirects (Provider-Fehler, `missing_code`,
  `exchange_failed`, Erfolg) gegen diese öffentliche Herkunft statt gegen `nextUrl.origin`.
  Der `next`-Pfad geht unverändert durch `safeNextPath` — Host und Pfad sind getrennt
  abgesichert.
- `src/lib/env.ts`: neue Funktion `isDevelopment()`. Der Header wird nur dort ausgewertet, wo
  wirklich ein Proxy davorsteht; lokal (`next dev`) wird ein untergeschobener Header ignoriert.
- `src/lib/auth/origin.test.ts` (neu): 22 Tests — Fallback ohne Header, Host + Default-https,
  `http` mit Port, Komma-Ketten, unbekanntes Schema, „nicht vertrauenswürdig“, zwölf
  Angriffsmuster (Pfad, Schema, protokollrelativ, Userinfo, Backslash, Query, Fragment,
  Leerzeichen, Header-Injection per `\n`, Überlänge, leer, nur Leerzeichen), Host-Prüfer selbst.

## Abweichungen vom Plan

- **Plan 1–4, 6, 7 (Repo, Vercel, Supabase-URLs, Google, Smoke-Test, Deployment Protection)**
  sind nicht ausgeführt, sondern nur vorbereitet — Repo-URL und Konten liegen beim
  Auftraggeber. Siehe „Das kann nur der Auftraggeber/Planer“.
- **Plan 8** (`docs/BETRIEB.md`) ist auf zwei Dateien aufgeteilt: `BETRIEB.md` für den
  laufenden Betrieb, `DEPLOY.md` für das einmalige Aufsetzen. Auftragsgemäß und besser lesbar —
  wer einen Editor freischalten will, soll nicht durch die Vercel-Einrichtung blättern müssen.
- **Zusätzlich zum WP10-Plan**: der Callback-Fix aus Gaby WP2-F2, ausdrücklich beauftragt.
  `isDevelopment()` liegt in `src/lib/env.ts` statt im Route-Handler, weil
  `tests/gaby/wp2-auth.gaby.test.ts` `process.env` außerhalb von `src/lib/env.ts` verbietet.
- **`.gitignore`**-Ausnahme `!.env.example`: minimaler Eingriff, gehört zum DoD-Punkt
  „`.env.example` aktuell“.
- Die acht `supabase/**/*.sql` erscheinen im Worktree kurzzeitig als geändert (CRLF→LF, wie vom
  Planer angewiesen, damit `tests/gaby/wp1-schema.gaby.test.ts` grün ist). Wegen
  `core.autocrlf=true` ist der Git-Diff **leer** — es wird nichts an den Migrationen committet.

## Offene Fragen an den Planer

- Keine blockierenden. Zwei Werte müssen nach dem Deploy nachgetragen werden: `<PROD_URL>` und
  `<REPO_URL>` in `docs/BETRIEB.md`, Abschnitt „Feste Werte“ (steht dort als Hinweis und in der
  Abhak-Liste von `docs/DEPLOY.md`).
- Falls das Supabase-Projekt wider Erwarten nicht in der EU liegt: Region in `vercel.json`
  anpassen (in `docs/DEPLOY.md` Schritt 7 vermerkt).

## Neue Abhängigkeiten

- Keine.

## Prüfung

- `npm run check`: **grün** (09.09.2026, 20:13) — typecheck ok, ESLint ohne Ausgabe,
  **1042 Tests in 50 Dateien**, 1,6 s. Enthält die 22 neuen Tests aus `origin.test.ts`.
- `npm run build`: **grün** — 11 Routen, `ƒ /auth/callback`, `ƒ Proxy (Middleware)` aktiv.
- `npm run rls:smoke`: nicht ausgeführt (unverändert seit WP1: Datenbankstand hier nicht
  prüfbar, und der Worktree hat keine `.env.local`).
- `npm ci` lief ausschließlich im Worktree, nicht im Hauptordner.
- **Secret-Scan der gesamten Historie** (`git log -p --all`, alle Branches):
  - Muster `eyJ[A-Za-z0-9_-]{10,}`, `sb_secret_…`, `SUPABASE_SERVICE_ROLE_KEY=…`,
    `client_secret`, `GOCSPX-`, `password = "…"`: **ein einziger Treffer**, und der ist ein
    `sha512`-Integritätshash in `package-lock.json` — kein Geheimnis.
  - `service_role` und `sb_secret_`: Treffer nur in Prosa (`qa/reports/*.md`,
    Migrationskommentare), keine Werte.
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<wert>`, `sb_publishable_`: **kein** Treffer — auch
    der (harmlose) Publishable Key steht nirgends im Repo.
  - `@gmail.com`: nur Commit-Autorenzeilen und der UI-Platzhalter `name@gmail.com`. Keine
    echten Nutzeradressen, `supabase/seed.sql` enthält weiterhin nur `ADMIN_EMAIL_1/2/3`.
  - Verfolgte Env-Dateien: nur `.env.example` (ohne Werte). Keine `.env.local` in der Historie.
  - **Ergebnis: sauber.**

## So prüft man es

1. `npm ci`, `npm run check`, `npm run build` — grün.
2. `src/lib/auth/origin.ts` + `origin.test.ts` lesen: Kommt aus dem Header je etwas anderes als
   ein Hostname in die URL? Angriffsmuster ergänzen und laufen lassen.
3. `src/app/auth/callback/route.ts`: Alle vier Redirects nutzen `origin` aus `publicOrigin`;
   `next` weiterhin nur über `safeNextPath`.
4. `docs/BETRIEB.md` als fremde Person lesen: Reicht Abschnitt 1 aus, um einen neuen Editor
   freizuschalten (beide Fälle: schon angemeldet / noch nie angemeldet)? Reicht Abschnitt 2, um
   eine Migration einzuspielen, ohne den Rest des Projekts zu kennen?
5. `docs/DEPLOY.md` gegen `docs/ARBEITSPAKETE.md` WP10 Plan 1–7 abgleichen: jeder Planschritt
   hat einen Checklistenschritt.
6. Secret-Scan nachvollziehen:
   `git log -p --all | grep -niE "eyJ[A-Za-z0-9_-]{10,}|sb_secret_|service_role|GOCSPX-"`.
7. `vercel.json` ist gültiges JSON und enthält nur `regions`.

## Das kann nur der Auftraggeber/Planer

| # | Was | Wo beschrieben |
|---|---|---|
| 1 | **GitHub-Repo** privat anlegen, `git remote add origin <REPO_URL>`, `git push -u origin main` | `docs/DEPLOY.md` 1 |
| 2 | **Vercel-Import** des Repos (Framework Next.js, Standard-Buildkommandos) | `docs/DEPLOY.md` 2 |
| 3 | **Env-Variablen** `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` für **Production und Preview** setzen, dann deployen | `docs/DEPLOY.md` 3 |
| 4 | **Supabase**: Site URL = `<PROD_URL>`, Redirect URLs `<PROD_URL>/**`, `https://*-<TEAM>.vercel.app/**`, `http://localhost:3000/**` | `docs/DEPLOY.md` 4, `BETRIEB.md` 5a |
| 5 | **Google Cloud**: `<PROD_URL>` als autorisierten JavaScript-Ursprung ergänzen (Weiterleitungs-URI bleibt die Supabase-Adresse) | `docs/DEPLOY.md` 5, `BETRIEB.md` 5b |
| 6 | **Deployment Protection**: Preview geschützt, Production offen | `docs/DEPLOY.md` 6 |
| 7 | **Migrationen 0001–0007** in der Produktionsdatenbank einspielen bzw. nachziehen und Rolle `admin` für den Auftraggeber setzen | `docs/DEPLOY.md` 8, `BETRIEB.md` 1+2 |
| 8 | **Smoke-Test** auf dem Handy und Ausfüllen von `qa/reports/WP10-smoke.md` | `docs/DEPLOY.md` 9 |
| 9 | `<PROD_URL>` und `<REPO_URL>` in `docs/BETRIEB.md` „Feste Werte“ nachtragen | `docs/DEPLOY.md`, Abschluss-Checkliste |
| 10 | **Merge dieses Worktree-Branches** nach `main` (ich habe weder gepusht noch das Remote angefasst) | — |

Erst nach 1–8 ist der WP10-DoD („Produktions-URL funktioniert auf dem Handy mit Rolle Admin“,
„jeder Push auf `main` deployt“) belegbar. Vorher kann Gaby nur Dokumentation, Callback-Fix,
`vercel.json` und den Secret-Scan prüfen.

## Vorschläge (außerhalb des Pakets)

- Nach dem ersten echten Deploy: eine Zeile in `docs/STATUS.md` und die Produktions-URL in
  `CLAUDE.md` neben der Supabase-URL — dann steht sie an der Stelle, die jeder zuerst liest.
- `.gitattributes` mit `*.sql text eol=lf` würde die CRLF/LF-Reibung an den Migrationen
  dauerhaft beseitigen, die jeden Worktree-Lauf Zeit kostet. Kleiner Eingriff, aber er berührt
  Dateien aus WP1 und gehört deshalb in ein eigenes Paket.
- Ein GitHub-Actions-Workflow, der auf jeden Push `npm run check` fährt, würde rote Previews
  früher sichtbar machen als der Vercel-Build.
