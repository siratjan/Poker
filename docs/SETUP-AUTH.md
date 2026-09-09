# Anleitung: Supabase + Google-Login einrichten

Schritt-für-Schritt, damit der „Mit Google anmelden"-Button in der App wirklich
funktioniert. Reihenfolge einhalten — Teil A (Datenbank) muss vor Teil C
(Rollen) laufen.

**Feste Werte für dieses Projekt:**

| Was | Wert |
|---|---|
| Supabase-Projekt-Ref | `vcyqzqgybjggoreffwjc` |
| Supabase-Dashboard | https://supabase.com/dashboard/project/vcyqzqgybjggoreffwjc |
| Google → erlaubte Redirect-URI | `https://vcyqzqgybjggoreffwjc.supabase.co/auth/v1/callback` |
| App-Callback (lokal) | `http://localhost:3000/auth/callback` |
| Site-URL (lokal) | `http://localhost:3000` |

---

## Teil A — Datenbank-Migrationen einspielen (falls noch nicht geschehen)

Laut STATUS ist der DB-Push von WP1 noch offen. Ohne die Tabellen
(`app_users`, `role_whitelist`, …) kann sich niemand mit Rolle anmelden.

Einfachster Weg ist der **SQL-Editor** im Dashboard (kein CLI nötig):

1. Öffne **Dashboard → SQL Editor → New query**.
2. Spiele die Dateien **in dieser Reihenfolge** ein, jede einzeln
   (Inhalt reinkopieren → **Run**):
   1. `supabase/migrations/0001_schema.sql`
   2. `supabase/migrations/0002_functions_triggers.sql`
   3. `supabase/migrations/0003_rls.sql`
   4. `supabase/migrations/0004_realtime.sql`
   5. `supabase/migrations/0005_profile_sync.sql`
3. Jede muss ohne Fehler durchlaufen („Success. No rows returned" ist ok).

> Alternative per CLI: `npx supabase login`, dann
> `npx supabase link --project-ref vcyqzqgybjggoreffwjc`, dann
> `npx supabase db push`. Der SQL-Editor ist für den ersten Mal aber die
> sichere Variante.

**Seed noch NICHT einspielen** — der kommt in Teil C, wenn die echten
Gmail-Adressen feststehen.

---

## Teil B — Google-OAuth einrichten

### B.1 Google-Cloud-Projekt + OAuth-Zustimmungsbildschirm

1. Gehe zu https://console.cloud.google.com/ und melde dich mit dem Google-Konto
   an, dem die App „gehören" soll.
2. Oben links ein **Projekt anlegen** (z. B. „Poker-Kasse") oder ein
   bestehendes wählen.
3. Links im Menü **APIs & Dienste → OAuth-Zustimmungsbildschirm**
   (*OAuth consent screen*).
   - **User Type: Extern** wählen → **Erstellen**.
   - App-Name: `Poker-Kasse`, Support-E-Mail: deine Adresse, Entwickler-Kontakt:
     deine Adresse. Rest leer lassen → **Speichern und fortfahren**.
   - **Scopes/Berechtigungen:** nichts hinzufügen. Die App nutzt nur die
     Basis-Scopes (E-Mail, Profil) — die brauchen **keine** Google-Prüfung.
4. **Wichtig — App veröffentlichen, damit jeder mit dem Link rein darf:**
   Auf dem Zustimmungsbildschirm den **Veröffentlichungsstatus** von
   *Testing* auf **In Produktion** stellen (**App veröffentlichen** /
   *Publish app* → bestätigen).
   - Damit kann sich **jedes** Google-Konto anmelden — keine Testnutzer-Liste
     nötig, niemand muss vorher eingetragen werden.
   - Weil nur Basis-Scopes verwendet werden, ist **kein** Google-Verifizierungs-
     verfahren nötig und es erscheint auch kein „nicht bestätigt"-Warnschirm.
   - Jeder neue Login wird automatisch **`viewer`** und darf nur lesen
     (per RLS erzwungen) — genau das gewünschte „ansehen, aber nicht ändern".
     Editieren kann nur, wer in der Whitelist (Teil C) `editor`/`admin` ist.

### B.2 OAuth-Client-ID erstellen

1. **APIs & Dienste → Anmeldedaten** (*Credentials*).
2. **+ Anmeldedaten erstellen → OAuth-Client-ID**.
3. **Anwendungstyp: Webanwendung**.
4. Name: z. B. `Poker-Kasse Web`.
5. Unter **Autorisierte Weiterleitungs-URIs** (*Authorized redirect URIs*)
   **genau diese eine URI** hinzufügen (das ist Supabase, NICHT localhost):

   ```
   https://vcyqzqgybjggoreffwjc.supabase.co/auth/v1/callback
   ```

6. **Erstellen**. Es erscheinen **Client-ID** und **Client-Secret** —
   beide Fenster offen lassen / kopieren, gleich in B.3 gebraucht.

### B.3 Provider in Supabase aktivieren

1. **Supabase-Dashboard → Authentication → Sign In / Providers**
   (früher „Providers").
2. **Google** auswählen und **einschalten** (*Enable*).
3. **Client ID** und **Client Secret** aus B.2 einfügen.
4. **Save**.

### B.4 Redirect-URLs in Supabase erlauben

1. **Authentication → URL Configuration**.
2. **Site URL** setzen auf:
   ```
   http://localhost:3000
   ```
3. Unter **Redirect URLs** hinzufügen (**Add URL**):
   ```
   http://localhost:3000/**
   ```
4. **Save**.

> Später fürs Deployment (WP10) kommen hier die echte Vercel-Domain als Site-URL
> und `https://<deine-domain>/**` als weitere Redirect-URL dazu.

---

## Teil C — Rollen (Admin / Editor) festlegen

Jedes neue Google-Konto bekommt beim **ersten Login** automatisch die Rolle
`viewer`. Wer `admin` oder `editor` sein soll, muss **vorher** in der
`role_whitelist` stehen.

1. Öffne `supabase/seed.sql` und ersetze die Platzhalter
   `ADMIN_EMAIL_1/2/3` durch die echten Admin-Gmail-Adressen. Nicht benötigte
   Zeilen löschen. Editoren durch Auskommentieren-Entfernen ergänzen.

   > Echte Adressen **nicht** committen. Entweder nur im SQL-Editor bearbeiten,
   > oder eine Kopie `supabase/seed.local.sql` anlegen (steht in `.gitignore`).

2. Den angepassten Inhalt im **SQL-Editor** ausführen (**Run**).

3. **Reihenfolge wichtig:** Steht die Adresse *vor* dem ersten Login in der
   Whitelist, greift die Rolle automatisch. Hat sich jemand *schon* eingeloggt,
   bevor die Whitelist stand, per SQL nachziehen:
   ```sql
   update public.app_users set role = 'admin'
   where email = lower('deine-adresse@gmail.com');
   ```

4. Kontrolle:
   ```sql
   select email, role from public.app_users order by role, email;
   ```

---

## Teil D — Testen

1. Dev-Server läuft (`npm run dev`) → http://localhost:3000
2. Auf **Mit Google anmelden** klicken.
3. Google-Kontoauswahl → Zustimmung → landet wieder in der App, eingeloggt.
4. Ausloggen und mit einem Nicht-Admin-Konto testen → sollte als `viewer`
   reinkommen.

### Wenn etwas schiefgeht

| Symptom | Ursache / Fix |
|---|---|
| „Unsupported provider" | Google-Provider in Supabase noch nicht aktiviert (B.3). |
| `redirect_uri_mismatch` (Google) | In B.2 muss **exakt** `…supabase.co/auth/v1/callback` stehen — nicht localhost. |
| Login klappt, aber landet auf `/login` mit Fehler | Redirect-URL fehlt in Supabase (B.4). |
| Access blocked / „App not verified" | App steht noch auf *Testing* — in Produktion veröffentlichen (B.1, Schritt 4). |
| Eingeloggt, aber falsche Rolle | Whitelist vor erstem Login? Sonst per UPDATE nachziehen (Teil C.3). |

---

*Kurzform der Reihenfolge:* Migrationen (A) → Google-Client + Supabase-Provider
(B) → Whitelist/Seed (C) → Testen (D).
