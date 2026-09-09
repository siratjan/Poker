# Deployment-Checkliste (einmalig)

Von „läuft nur lokal“ zu „läuft unter einer öffentlichen Adresse“. Abzuarbeiten vom Planer bzw.
Auftraggeber, Schritt für Schritt, von oben nach unten. Der laufende Betrieb danach steht in
`docs/BETRIEB.md`.

**Platzhalter, die unterwegs ersetzt werden:**

| Platzhalter | Bedeutung | Steht fest nach |
|---|---|---|
| `<REPO_URL>` | GitHub-Repo, z. B. `https://github.com/sirat/poker-kasse.git` | Schritt 1 |
| `<PROD_URL>` | Produktions-Adresse ohne Schrägstrich am Ende, z. B. `https://poker-kasse.vercel.app` | Schritt 3 |
| `<TEAM>` | Vercel-Konto- bzw. Team-Slug (steht in den Preview-URLs) | Schritt 3 |

Sobald `<REPO_URL>` und `<PROD_URL>` feststehen: in `docs/BETRIEB.md`, Abschnitt „Feste Werte“,
eintragen.

---

## Schritt 1 — GitHub-Repo (privat)

1. Auf GitHub ein **leeres, privates** Repo anlegen (ohne README, ohne `.gitignore`, ohne
   Lizenz — das Projekt bringt alles mit).
2. Im Projektordner `C:\Users\sirat\Poker_App`:

   ```bash
   git remote add origin <REPO_URL>
   git branch -M main
   git push -u origin main
   ```

3. Kontrolle: `git remote -v` zeigt `origin`; auf GitHub sind alle Dateien da und **keine**
   `.env.local` (die steht in `.gitignore`).

> Falls schon ein `origin` existiert: `git remote set-url origin <REPO_URL>`.

---

## Schritt 2 — Vercel-Projekt anlegen

1. https://vercel.com → **Add New… → Project** → GitHub verbinden → das Repo importieren.
2. **Framework Preset:** *Next.js* (wird automatisch erkannt). Build Command, Output Directory
   und Install Command **unverändert** lassen — die Standardwerte sind richtig.
3. **Root Directory:** Projektwurzel, nicht ändern.
4. **Node-Version:** Standard (aktuelle LTS) genügt.
5. Noch **nicht** deployen — erst die Env-Variablen in Schritt 3 setzen; sonst ist der erste
   Build rot bzw. die App meldet „Die Konfiguration ist unvollständig“.

---

## Schritt 3 — Umgebungsvariablen

Vercel → Projekt → **Settings → Environment Variables**. Beide Variablen jeweils für
**Production** *und* **Preview** anlegen (Development ist optional):

| Name | Wert | Umgebungen |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vcyqzqgybjggoreffwjc.supabase.co` | Production, Preview |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Wert aus **Supabase → Project Settings → API** (Feld *Publishable key* / *anon key*) | Production, Preview |

Die Werte stehen lokal in `.env.local`; Muster in `.env.example`.

Beide sind `NEXT_PUBLIC_*` und damit **öffentlich** — sie landen im Browser-Bundle. Das ist so
vorgesehen: Der Publishable Key ist kein Geheimnis, die Rechte erzwingt RLS in der Datenbank.
Der **Service-Role-Key gehört nirgendwohin** — nicht ins Repo, nicht zu Vercel.

Dann **Deploy** auslösen. Nach dem ersten erfolgreichen Deploy steht `<PROD_URL>` fest
(Vercel → Projekt → **Domains**).

> Env-Variablen wirken erst beim **nächsten** Build. Wer sie nachträglich ändert, muss unter
> **Deployments → … → Redeploy** neu bauen.

---

## Schritt 4 — Supabase-URLs eintragen

Dashboard → **Authentication → URL Configuration**:

- **Site URL:** `<PROD_URL>`
- **Redirect URLs** (jede einzeln über *Add URL*):
  - `<PROD_URL>/**`
  - `https://*-<TEAM>.vercel.app/**` — Preview-Deploys, deren Adresse sich bei jedem Push ändert
  - `http://localhost:3000/**` — lokale Entwicklung

**Save**. Wirkt sofort, kein Deploy nötig. Details und Fallstricke: `docs/BETRIEB.md` 5a.

---

## Schritt 5 — Google-Cloud-Ursprünge ergänzen

Google Cloud Console → **APIs & Dienste → Anmeldedaten** → den OAuth-Client der App öffnen:

- **Autorisierte JavaScript-Ursprünge:** `<PROD_URL>` ergänzen (`http://localhost:3000` bleibt).
- **Autorisierte Weiterleitungs-URIs:** unverändert
  `https://vcyqzqgybjggoreffwjc.supabase.co/auth/v1/callback` — **nicht** die Vercel-Adresse.

**Speichern.** Google braucht gelegentlich ein paar Minuten, bis die Änderung greift.

---

## Schritt 6 — Deployment Protection für Previews

Vercel → **Settings → Deployment Protection**:

- **Vercel Authentication: an**, Geltungsbereich **Preview** (bzw. „Standard Protection“:
  Previews geschützt, Production offen).
- **Production: nicht** schützen — dort schützt der Google-Login der App selbst, und der
  Auftraggeber soll ohne Vercel-Konto aufs Handy kommen.

Ergebnis: Preview-URLs sind nur für angemeldete Team-Mitglieder erreichbar, die Produktion für
jeden — der aber ohne Google-Login und passende Rolle nichts sieht und nichts ändern kann.

---

## Schritt 7 — Region

`vercel.json` im Projekt setzt `"regions": ["fra1"]` (Frankfurt). Begründung: Nutzer und
Supabase-Projekt liegen in Europa; ohne Angabe rendert Vercel standardmäßig in Washington
(`iad1`), was jedem Seitenaufruf einen Atlantik-Hin-und-Rückweg zur Datenbank kostet.

Nichts zu tun — außer das Supabase-Projekt liegt wider Erwarten **nicht** in der EU
(Dashboard → Project Settings → General → *Region*). Dann die Region in `vercel.json` auf die
nächstgelegene Vercel-Region umstellen und neu deployen.

---

## Schritt 8 — Datenbank auf Stand bringen

**Ein Deploy spielt keine Migrationen ein.** Vor dem Smoke-Test prüfen, ob alle Dateien aus
`supabase/migrations/` in der Datenbank sind — Anleitung und Prüfabfrage in `docs/BETRIEB.md`
Abschnitt 2. Fehlen `0006`/`0007`, bleiben Session-Liste und Spieler-Übersicht leer.

Ebenfalls jetzt: Rollen setzen, damit der Auftraggeber `admin` ist — `docs/BETRIEB.md` 1a/1b.

---

## Schritt 9 — Smoke-Test in Produktion

`qa/reports/WP10-smoke.md` öffnen und die sechs Schritte auf dem Handy des Auftraggebers
durchgehen: Login, Session anlegen, Buy-in, Cash-out, Abschluss, Log. Ergebnisse direkt in die
Vorlage eintragen und die Datei committen.

---

## Schritt 10 — Automatische Deploys prüfen

Nach dem Import gilt automatisch:

- Push auf `main` → Production-Deploy.
- Push auf jeden anderen Branch / jeder Pull Request → Preview-Deploy.

Kontrolle: eine Kleinigkeit auf einem Branch pushen und in Vercel → **Deployments** sehen, dass
ein Preview entsteht. Ein roter Build blockiert nichts Bestehendes — die alte Version bleibt
online, bis ein Deploy grün ist.

---

## Abschluss-Checkliste

- [ ] Repo auf GitHub, privat, ohne `.env.local`
- [ ] Vercel-Projekt importiert, Framework Next.js
- [ ] Beide Env-Variablen für Production **und** Preview
- [ ] Erster Deploy grün, `<PROD_URL>` notiert
- [ ] Supabase Site URL + drei Redirect-URLs
- [ ] Google JavaScript-Ursprung `<PROD_URL>`
- [ ] Deployment Protection: Preview an, Production aus
- [ ] Migrationen 0001–0007 eingespielt, Views vorhanden
- [ ] Auftraggeber hat Rolle `admin`
- [ ] Smoke-Test grün, `qa/reports/WP10-smoke.md` ausgefüllt
- [ ] `<REPO_URL>` und `<PROD_URL>` in `docs/BETRIEB.md` eingetragen
