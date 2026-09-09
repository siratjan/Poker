# Betriebshandbuch Poker-Kasse

Was man wissen muss, um die laufende App zu betreuen: Rollen vergeben, Migrationen nachziehen,
Logs finden, typische Störungen beheben, URLs richtig setzen.

Diese Anleitung setzt **kein** Vorwissen über das Projekt voraus. Wer neu ist, liest zuerst
„Feste Werte“ und dann den Abschnitt, der zum Problem passt.

Verwandte Dokumente:

- `docs/DEPLOY.md` — einmaliges Aufsetzen von GitHub, Vercel, Supabase-URLs.
- `docs/SETUP-AUTH.md` — erstmalige Einrichtung von Google-OAuth und Datenbank.
- `docs/SPEC.md` — was die App fachlich tut (Rollenrechte, Abrechnung).

---

## Feste Werte

| Was | Wert |
|---|---|
| Supabase-Projekt-Ref | `vcyqzqgybjggoreffwjc` |
| Supabase-Dashboard | https://supabase.com/dashboard/project/vcyqzqgybjggoreffwjc |
| Supabase-URL (öffentlich) | `https://vcyqzqgybjggoreffwjc.supabase.co` |
| Google → autorisierte Redirect-URI | `https://vcyqzqgybjggoreffwjc.supabase.co/auth/v1/callback` |
| Produktions-URL der App | `<PROD_URL>` (nach dem Vercel-Import eintragen) |
| GitHub-Repo | `<REPO_URL>` (nach dem Anlegen eintragen) |

> `<PROD_URL>` und `<REPO_URL>` sind Platzhalter. Sobald sie feststehen, hier eintragen —
> dann stimmt der Rest der Anleitung wörtlich.

Rechte-Modell in einem Satz: **Jedes neue Google-Konto wird beim ersten Login automatisch
`viewer`** (darf nur lesen); `editor` und `admin` bekommt nur, wer vorher in der
`role_whitelist` steht oder nachträglich hochgestuft wird.

| Rolle | Darf |
|---|---|
| `viewer` | alles ansehen, nichts ändern |
| `editor` | Sessions, Spieler, Buy-ins, Cash-outs erfassen; Session ohne Differenz abschließen |
| `admin` | zusätzlich: Rollen und Whitelist pflegen, Schnellauswahl-Beträge ändern, mit Differenz abschließen, löschen |

Durchgesetzt wird das in der Datenbank (RLS + Trigger), nicht in der Oberfläche. Wer die
Oberfläche austrickst, kommt trotzdem nicht weiter.

---

## 1. Rollen pflegen

Drei Wege, in dieser Reihenfolge auszuprobieren.

### 1a. Der Normalfall: Admin-Seite in der App

Voraussetzung: Man ist selbst mit einem Konto angemeldet, das Rolle `admin` hat.

1. In der App auf **Admin** (Tab-Leiste unten; nur Admins sehen den Tab).
2. **Abschnitt „Nutzer“** — listet alle Konten, die sich schon einmal angemeldet haben.
   Rolle im Auswahlfeld ändern, fertig. Wirkt sofort; der Betroffene muss die Seite neu laden.
3. **Abschnitt „Whitelist“** — für Leute, die sich **noch nie** angemeldet haben:
   E-Mail-Adresse und gewünschte Rolle eintragen, **Hinzufügen**. Beim ersten Login bekommt
   dieses Konto automatisch die hinterlegte Rolle.

Merksatz: **Wer schon da ist → „Nutzer“. Wer noch kommt → „Whitelist“.**

Zwei Sicherungen, die absichtlich eingebaut sind:

- Der **letzte Admin** kann sich nicht selbst herabstufen. Sonst käme niemand mehr an die
  Admin-Seite. Erst einen zweiten Admin anlegen, dann herabstufen.
- Ein Eintrag aus der Whitelist zu löschen **entzieht keine bestehende Rolle**. Die Whitelist
  wirkt nur beim allerersten Login. Bestehende Rollen ändert man unter „Nutzer“.

### 1b. Wenn es keinen Admin (mehr) gibt: SQL-Fallback

Klassischer Fall: Beim allerersten Aufsetzen hat sich der Auftraggeber angemeldet, **bevor**
seine Adresse in der Whitelist stand — er ist jetzt `viewer` und kommt nicht an die Admin-Seite.

1. **Dashboard → SQL Editor → New query**.
2. Diese Abfrage ausführen und die eigene Adresse einsetzen:

   ```sql
   update public.app_users
      set role = 'admin'
    where email = lower('vorname.nachname@gmail.com');
   ```

3. Kontrolle:

   ```sql
   select email, role from public.app_users order by role, email;
   ```

4. In der App abmelden und neu anmelden (oder Seite neu laden).

Analog für `editor`. Die Rolle liegt in **einer** Spalte, `public.app_users.role`, Werte
`'admin' | 'editor' | 'viewer'`.

Whitelist-Eintrag per SQL (für Konten, die es noch nicht gibt):

```sql
insert into public.role_whitelist (email, role, note)
values (lower('neue.person@gmail.com'), 'editor', 'per SQL nachgetragen')
on conflict (email) do update set role = excluded.role, note = excluded.note;
```

### 1c. Beim Aufsetzen: Whitelist aus `supabase/seed.sql`

`supabase/seed.sql` enthält Platzhalter `ADMIN_EMAIL_1/2/3`. Inhalt in den SQL-Editor kopieren,
Platzhalter durch echte Adressen ersetzen, nicht benötigte Zeilen löschen, **Run**.

> **Echte Adressen nie committen.** Entweder nur im SQL-Editor bearbeiten oder eine Kopie
> `supabase/seed.local.sql` anlegen — die steht in `.gitignore`.

### Kurzanleitung „neuen Editor freischalten“

Der häufigste Handgriff im Alltag, in fünf Zeilen:

1. Hat die Person sich schon einmal angemeldet? → App → **Admin** → **Nutzer** → Rolle auf
   `editor` stellen. **Fertig.**
2. Noch nie angemeldet? → App → **Admin** → **Whitelist** → Adresse + Rolle `editor` →
   **Hinzufügen**. Die Person meldet sich mit Google an und ist sofort Editor.
3. Kein Zugang zur Admin-Seite? → SQL-Fallback aus 1b.
4. Kontrolle: `select email, role from public.app_users order by role, email;`
5. Änderung steht im Audit-Log der App (Tab **Log**).

---

## 2. Eine Migration nachziehen

Migrationen liegen in `supabase/migrations/` und sind **nummeriert**. Sie werden **in
aufsteigender Reihenfolge** eingespielt und sind idempotent geschrieben (`create table if not
exists`, `create or replace view`, `drop policy if exists` …), das heißt: **ein zweiter Lauf
derselben Datei schadet nicht.** Wer unsicher ist, ob eine Datei schon lief, spielt sie
einfach noch einmal ein.

Aktueller Stand:

| Datei | Inhalt |
|---|---|
| `0001_schema.sql` | Tabellen, Enums, Indizes |
| `0002_functions_triggers.sql` | Funktionen und Trigger (Rollenschutz, Audit-Log, Abschluss) |
| `0003_rls.sql` | Row-Level-Security-Policies |
| `0004_realtime.sql` | Realtime-Publication |
| `0005_profile_sync.sql` | Profilabgleich beim Login (Name, Avatar) |
| `0006_session_overview.sql` | View `session_overview` (Session-Liste) |
| `0007_player_stats.sql` | View `player_stats` (Spieler-Übersicht) |

### Weg A — SQL-Editor (immer möglich, kein Werkzeug nötig)

1. **Dashboard → SQL Editor → New query**.
2. Den **vollständigen Inhalt** der neuen Migrationsdatei hineinkopieren.
3. **Run**. „Success. No rows returned“ ist der Normalfall und bedeutet: hat geklappt.
4. Mehrere neue Dateien: **einzeln und in Nummernreihenfolge**, nie zwei auf einmal.
5. Danach die Prüfabfrage aus „Kontrolle“ unten ausführen.

### Weg B — Supabase-CLI (bequemer, wenn öfter)

Im Projektordner:

```bash
npx supabase login                                  # einmalig, öffnet den Browser
npx supabase link --project-ref vcyqzqgybjggoreffwjc # einmalig pro Rechner
npx supabase db push                                 # spielt alle noch fehlenden Migrationen ein
```

`db push` merkt sich in der Tabelle `supabase_migrations.schema_migrations`, was schon lief,
und spielt nur Neues ein.

> **Vorsicht:** `npx supabase db reset` löscht die Datenbank. Nie gegen die Produktion.

### Kontrolle nach dem Einspielen

```sql
-- Tabellen und Views vorhanden?
select table_name, table_type
  from information_schema.tables
 where table_schema = 'public'
 order by table_name;

-- RLS überall an?
select relname, relrowsecurity
  from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r'
 order by relname;
```

Erwartet: unter anderem `app_users`, `role_whitelist`, `players`, `sessions`, `entries`,
`settlements`, `settings`, `audit_log` als `BASE TABLE` sowie `session_overview` und
`player_stats` als `VIEW`; `relrowsecurity = true` bei allen Tabellen.

Zusätzlich vom Projektordner aus:

```bash
npm run rls:smoke   # prüft ohne Login, dass RLS wirklich alles blockt
```

### Wenn eine Migration mittendrin abbricht

Postgres führt jede Anweisung einzeln aus; ein Abbruch kann einen Halbzustand hinterlassen.
Vorgehen: Fehlermeldung lesen, Ursache beheben (meist eine fehlende Vorgänger-Migration),
**dieselbe Datei komplett erneut ausführen** — sie ist idempotent. Nie einzelne Zeilen aus der
Mitte herauspicken.

---

## 3. Wo die Logs liegen

| Log | Wo | Wofür |
|---|---|---|
| **Vercel Functions** | Vercel → Projekt → **Logs** (bzw. Deployment → **Runtime Logs**) | Alles, was serverseitig läuft: Server Actions, `/auth/callback`, der Proxy. Hier stehen die `console.error`-Zeilen der App, z. B. `[auth] exchangeCodeForSession: …` und `[proxy] …`. Erste Anlaufstelle bei „Login geht nicht“ und „Speichern schlägt fehl“. |
| **Vercel Build Logs** | Vercel → Deployment → **Building** | Warum ein Deploy rot ist (Typfehler, Lint, fehlende Env-Variable). |
| **Supabase Logs** | Dashboard → **Logs** → *Auth* / *Postgres* / *API* | *Auth*: abgelehnte Redirects, Provider-Fehler, Token-Tausch. *Postgres*: SQL-Fehler, RLS-Ablehnungen. *API*: die HTTP-Aufrufe von PostgREST. |
| **App-Audit-Log** | In der App, Tab **Log** (nur admin) | Fachliche Spur: wer hat wann welchen Buy-in, Cash-out, Abschluss, welche Rollenänderung gemacht. Liegt in der Tabelle `public.audit_log` und wird von Datenbank-Triggern geschrieben — auch dann, wenn jemand am UI vorbei schreibt. |
| **Browser-Konsole** | F12 beim Betroffenen | Nur für reine Anzeigefehler. Geldbeträge und Rechte niemals hier debuggen — die Wahrheit liegt in der Datenbank. |

Aufbewahrung: Vercel- und Supabase-Logs sind je nach Tarif nach Stunden bis Tagen weg. Das
App-Audit-Log bleibt dauerhaft und ist die einzige revisionssichere Spur.

---

## 4. Die drei realen Stolpersteine

Genau diese drei sind bei der Abnahme aufgetreten. Symptom → Ursache → Behebung.

### 4a. „Provider nicht konfiguriert“ / „Unsupported provider“

**Symptom:** Klick auf „Mit Google anmelden“ endet sofort wieder auf `/login`, mit dem Hinweis,
dass der Anmeldedienst nicht eingerichtet ist.

**Ursache:** Der Google-Provider ist im Supabase-Projekt aus (oder ohne Client-ID/Secret
gespeichert). Die App kann daran nichts ändern — das ist eine Einstellung im Dashboard.

**Behebung:**

1. **Dashboard → Authentication → Sign In / Providers → Google**.
2. **Enable** einschalten.
3. **Client ID** und **Client Secret** aus der Google Cloud Console eintragen
   (Anlegen siehe `docs/SETUP-AUTH.md` Teil B.2). **Save**.
4. In der Google Cloud Console muss unter **Autorisierte Weiterleitungs-URIs** exakt
   `https://vcyqzqgybjggoreffwjc.supabase.co/auth/v1/callback` stehen — **nicht** die
   Vercel-URL, **nicht** localhost.
5. Erneut anmelden. Zur Kontrolle: **Supabase → Logs → Auth**.

**Verwandt:** `redirect_uri_mismatch` von Google bedeutet dasselbe Feld, aber falscher Wert —
siehe Schritt 4.

### 4b. „View fehlt“ (`relation "public.session_overview" does not exist`)

**Symptom:** Die Session-Liste oder die Spieler-Übersicht bleibt leer bzw. zeigt einen Fehler;
in den Vercel-Runtime-Logs oder Supabase-API-Logs steht `relation "public.session_overview"
does not exist` oder dasselbe mit `player_stats`.

**Ursache:** Die Migrationen `0006` bzw. `0007` wurden nie eingespielt. Typisch, wenn die
Datenbank früh von Hand über den SQL-Editor aufgesetzt und später nicht nachgezogen wurde.

**Behebung:** Abschnitt 2, Weg A: `supabase/migrations/0006_session_overview.sql` und danach
`0007_player_stats.sql` im SQL-Editor ausführen. Beide sind `create or replace view`, laufen
also gefahrlos auch mehrfach. Danach:

```sql
select table_name from information_schema.views where table_schema = 'public';
```

Erwartet: `session_overview`, `player_stats`. Anschließend Seite neu laden.

**Vorbeugung:** Nach jedem Deploy, das neue Migrationsdateien mitbringt, `npx supabase db push`
oder den SQL-Editor-Weg ausführen. **Ein Vercel-Deploy spielt keine Migrationen ein** — das ist
immer ein getrennter, manueller Schritt.

### 4c. „viewer statt admin“

**Symptom:** Man ist angemeldet, sieht aber keinen Admin-Tab, oder alle Bearbeiten-Knöpfe
fehlen; auf `/admin` steht „Kein Zugriff“.

**Ursache:** Das Konto hat Rolle `viewer`. Fast immer, weil die Anmeldung **vor** dem
Whitelist-Eintrag passiert ist: Die Whitelist wirkt ausschließlich beim allerersten Login.
Ein nachträglicher Whitelist-Eintrag ändert eine bestehende Rolle **nicht**.

**Behebung:**

1. Rolle prüfen:

   ```sql
   select email, role, created_at from public.app_users order by created_at;
   ```

2. Hochstufen — über die Admin-Seite (1a), wenn es noch einen Admin gibt, sonst per SQL (1b):

   ```sql
   update public.app_users set role = 'admin' where email = lower('adresse@gmail.com');
   ```

3. In der App neu laden. Der Tab **Admin** erscheint.

**Nicht wundern:** Die App verweigert es absichtlich, den letzten Admin herabzustufen, und ein
Trigger lässt an `app_users` nur die Rollenspalte ändern — Name, E-Mail und Avatar kommen vom
Login und sind gegen Änderung von außen geschützt.

---

## 5. URLs und Ursprünge (Supabase + Google)

Drei Stellen müssen zusammenpassen. Wenn eine fehlt, endet der Login mit einer Fehlermeldung
statt in der App.

### 5a. Supabase → Authentication → URL Configuration

| Feld | Wert |
|---|---|
| **Site URL** | `<PROD_URL>` — z. B. `https://poker-kasse.vercel.app`. Ohne Schrägstrich am Ende. |
| **Redirect URLs** | `<PROD_URL>/**`  <br> `https://*-<team>.vercel.app/**` (Preview-Deploys; `<team>` ist der Vercel-Team- bzw. Konto-Slug) <br> `http://localhost:3000/**` (lokale Entwicklung) |

Hinweise:

- Der Platzhalter `**` deckt jeden Pfad ab, also auch `/auth/callback?next=…`. Ohne ihn wird der
  Rücksprung mit Query-Parametern abgelehnt.
- Preview-Deploys haben **jedes Mal eine neue Adresse**. Ohne die Wildcard-Zeile funktioniert der
  Login nur in der Produktion. Supabase erlaubt genau einen `*` je Namensabschnitt — deshalb
  `https://*-<team>.vercel.app/**` und nicht `https://*.vercel.app/**`.
- **Site URL** ist der Rückfall, wenn eine angefragte Redirect-URL nicht erlaubt ist. Steht dort
  noch `http://localhost:3000`, landen Produktionsnutzer nach dem Login auf ihrem eigenen Rechner
  — der klassische „Login klappt, aber Seite lädt ewig“-Fehler.

### 5b. Google Cloud Console → APIs & Dienste → Anmeldedaten → OAuth-Client

| Feld | Wert |
|---|---|
| **Autorisierte JavaScript-Ursprünge** | `<PROD_URL>` <br> `http://localhost:3000` |
| **Autorisierte Weiterleitungs-URIs** | `https://vcyqzqgybjggoreffwjc.supabase.co/auth/v1/callback` — **nur diese eine**, sie ändert sich nie |

Die Weiterleitungs-URI zeigt auf **Supabase**, nicht auf die App. Der Ablauf ist:
App → Supabase → Google → Supabase → `<PROD_URL>/auth/callback`. Wer hier die Vercel-Adresse
einträgt, bekommt von Google `redirect_uri_mismatch`.

Preview-Deploys brauchen in Google **keinen** eigenen Eintrag, solange sie über Supabase gehen.

### 5c. Die App selbst

Die App muss nicht wissen, unter welcher Adresse sie läuft: Der OAuth-Rücksprung wird aus
`window.location.origin` gebaut, und der Server-Callback (`src/app/auth/callback/route.ts`)
liest hinter dem Vercel-Proxy `x-forwarded-host` / `x-forwarded-proto`, damit der Nutzer auf der
öffentlichen Adresse landet und nicht auf einer internen. Es gibt deshalb **keine**
`NEXT_PUBLIC_SITE_URL`-Variable zu pflegen.

Änderungen an Supabase- oder Google-Einstellungen brauchen **kein** neues Deploy — sie wirken
sofort.

---

## 6. Kurz-Checkliste bei „Es geht nicht“

1. **Deploy grün?** Vercel → Deployments. Rot → Build-Logs lesen.
2. **Env-Variablen gesetzt?** Vercel → Settings → Environment Variables, für *Production*
   **und** *Preview*. Zeigt die App „Die Konfiguration ist unvollständig“, fehlt genau hier
   etwas — danach **neu deployen**, Env-Änderungen wirken erst beim nächsten Build.
3. **Login-Fehler?** → 4a, dann Supabase → Logs → Auth.
4. **Seite leer oder Fehler beim Laden von Listen?** → 4b, Migrationen nachziehen.
5. **Knöpfe fehlen?** → 4c, Rolle prüfen.
6. **Schreiben schlägt fehl, obwohl die Rolle stimmt?** Session ist wahrscheinlich abgeschlossen
   — abgeschlossene Sessions sind unveränderlich (`docs/SPEC.md`). Prüfen:
   `select id, status from public.sessions order by created_at desc limit 5;`
7. **Nichts davon?** Vercel-Runtime-Logs zum Zeitpunkt des Fehlers lesen; die App protokolliert
   jeden serverseitigen Fehler mit Präfix `[auth]`, `[proxy]` oder dem Namen der Server Action.
