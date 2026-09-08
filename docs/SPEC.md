# Poker-App – Fachliche Spezifikation (v1)

Stand: 2026-09-08. Diese Datei ist die verbindliche Quelle für alle fachlichen Entscheidungen.
Änderungen nur durch den Planer (Sirat) nach Rücksprache mit dem Auftraggeber.

## 1. Zweck

Pokerabende mit Freunden dokumentieren: Wer hat wann wie viel eingekauft (bar oder auf Liste),
mit welchem Stack ist er ausgestiegen, und wer bekommt am Ende aus der Kasse was bzw. wer
schuldet wem wie viel. Die App ist der Ort der Wahrheit; das Bezahlen der Schulden passiert
außerhalb der App.

## 2. Stack (entschieden)

| Bereich | Entscheidung |
|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS |
| Backend | Supabase: Postgres, Auth (nur Google), Realtime, Row-Level-Security |
| Hosting | Vercel (Frontend), Supabase Cloud (DB) |
| Supabase-Projekt | `https://vcyqzqgybjggoreffwjc.supabase.co` (Publishable Key in `.env.local`) |
| Lokale DB | keine (kein Docker). Entwicklung direkt gegen das Cloud-Projekt |
| Sprache UI | Deutsch |
| Währung | Euro, gespeichert als Integer-Cent (`amount_cents`) |
| Gerät | Mobile-first (Handy hochkant am Tisch), Desktop zweitrangig, als PWA installierbar |
| Tests | Vitest für den Abrechnungs-Algorithmus (Pflicht) und Hilfsfunktionen |

## 3. Nutzer, Spieler, Rollen

**Spieler** und **Nutzer** sind getrennt:

- **Spieler** = Eintrag mit Namen. Sitzt am Tisch, hat Buy-ins und Stack. Braucht keinen Login.
- **Nutzer** = Google-Konto, das sich einloggt. Hat genau eine Rolle.

Rollen:

| Rolle | Darf |
|---|---|
| `viewer` | alles lesen (Sessions, Spieler, Abrechnungen, Audit-Log). Nichts schreiben. |
| `editor` | zusätzlich: Spieler anlegen/umbenennen, Sessions anlegen, Buy-ins/Stacks/Auszahlungen erfassen, ändern, löschen (nur in offenen Sessions), Session abschließen (nur ohne Differenz). |
| `admin` | zusätzlich: Session mit Differenz abschließen (Kommentar Pflicht), Session wieder öffnen, Rollen anderer Nutzer ändern, Schnellauswahl-Beträge pflegen. |

Zugang:

- Login ausschließlich per Google (Supabase Auth Provider Google).
- **Jedes Google-Konto wird nach dem ersten Login automatisch `viewer`.** Das ist eine bewusste Entscheidung des Auftraggebers (Frage 9 → A). Konsequenz: Jeder mit Google-Konto und URL kann mitlesen.
- Admin- und Editor-Adressen stehen vorab in der Tabelle `role_whitelist`. Beim ersten Login greift die dort hinterlegte Rolle.
- Admins ändern Rollen in der App. Der letzte verbleibende Admin kann sich nicht selbst degradieren (DB-Trigger).
- Ohne Login sieht man nichts außer der Login-Seite.

## 4. Datenmodell (fachlich)

- **Session**: Datum, optionaler Name, Status `open` | `closed`. Bei Abschluss: Zeitpunkt, wer, Differenz in Cent, Kommentar. Wiederöffnen nur Admin.
- **Session-Teilnehmer**: Welche Spieler an einer Session teilnehmen (Reihenfolge = Beitrittsreihenfolge).
- **Eintrag** (`entries`) in einer Session, immer mit Zeitstempel und erfassendem Nutzer:
  - `buy_in`: Betrag, Zahlungsart `cash` (bar) oder `credit` (auf Liste). Beträge sind variabel.
  - `cash_out`: End-Stack eines Spielers. Genau einer pro Spieler und Session. Nach dem Cash-out kein weiterer Buy-in für diesen Spieler, außer der Cash-out wird gelöscht.
  - `payout`: Bar-Auszahlung aus der Kasse an einen Frühgeher. Voraussetzung: Spieler hat bereits einen `cash_out`, Betrag ≤ Stack, Betrag ≤ aktueller Kassenstand. Ob der Frühgeher berechtigt ist, entscheidet die Gruppe; die App dokumentiert und zeigt zur Orientierung an, was er nach der Bar-zuerst-Regel bekäme.
- **Abrechnung** (`settlements`): Wird beim Abschließen berechnet und eingefroren gespeichert (pro Spieler die Zeile, plus Überweisungsliste). Ändert sich nie nachträglich, auch nicht bei Algorithmus-Änderungen. Bei Wiederöffnen wird sie gelöscht und beim erneuten Abschließen neu berechnet.
- **Einstellungen**: Schnellauswahl-Beträge für Buy-ins (Default 50 / 100 / 200 €), pflegbar durch Admin.
- **Audit-Log**: Jede schreibende Aktion (Insert/Update/Delete auf Sessions, Teilnehmern, Einträgen, Spielern, Nutzerrollen, Einstellungen) mit Zeitpunkt, Nutzer (ID + E-Mail), Tabelle, Datensatz, Aktion, alten und neuen Werten. Wird per DB-Trigger geschrieben, ist für alle eingeloggten Nutzer lesbar und für niemanden änderbar oder löschbar.

## 5. Session-Ablauf

1. Editor legt Session an (Datum, optional Name). Status `open`.
2. Editor fügt Spieler hinzu (bestehende auswählen oder neu anlegen) und erfasst Buy-ins: Spieler antippen → Betrag (Schnellauswahl oder frei) → bar/Liste. Drei Tipps.
3. Steigt ein Spieler aus, wird sein End-Stack als `cash_out` erfasst. Nimmt er Bargeld mit, wird zusätzlich ein `payout` erfasst.
4. Haben alle Teilnehmer einen `cash_out`, kann abgeschlossen werden. Die App zeigt vorher: Summe Buy-ins, Summe Stacks, Differenz, Kassenstand, und eine Vorschau der Abrechnung.
5. **Differenzprüfung**: Summe Buy-ins ≠ Summe Stacks → rote Warnung. Editor kann dann nicht abschließen. Admin kann mit Pflicht-Kommentar abschließen; Differenz und Kommentar werden gespeichert.
6. Nach Abschluss ist nichts mehr änderbar (RLS erzwingt das). Admin kann wieder öffnen (Log-Eintrag), dann gilt Schritt 2 bis 5 erneut.

## 6. Abrechnungsregel (Kurzfassung – exakte Definition in `docs/SETTLEMENT.md`)

Kernregel des Auftraggebers: **Bargeld geht immer zuerst an Bar-Zahler.**

1. **Einsatz zurück**: Jeder Bar-Zahler bekommt sein eingezahltes Bargeld zurück, höchstens aber seinen Stack.
2. **Rest an Bar-Zahler, anteilig nach Gewinn**: Übriges Bargeld geht an die noch offenen Ansprüche der Bar-Zahler, proportional zur Höhe des offenen Anspruchs.
3. **Dann Listen-Spieler, anteilig**: Bleibt danach noch Bargeld, geht es an Listen-Spieler, ebenfalls proportional.
4. **Frühgeher-Auszahlungen** gelten als bereits aus der Kasse erhalten.
5. **Schulden**: Was danach offen ist, wird als Liste von Überweisungen „X schuldet Y n €“ mit minimaler Anzahl berechnet. Nur Anzeige pro Session, kein Abhaken, keine Verrechnung über Sessions.

„Bar-Zahler“ ist, wer in dieser Session mindestens einen `cash`-Buy-in hat (auch wenn er zusätzlich auf Liste gekauft hat).

## 7. Ansichten

| Ansicht | Inhalt |
|---|---|
| Login | Google-Button. Sonst nichts. |
| Session-Liste (Start) | Alle Sessions, neueste oben: Datum, Name, Teilnehmerzahl, Summe Buy-ins, Status. Button „Neue Session“ (Editor+). |
| Session-Detail | Kopf (Datum, Status, Summen, Kassenstand). Teilnehmer-Karten (Buy-ins bar/Liste, Stack, Auszahlung, Plus/Minus live). Aktionen: Spieler hinzufügen, Buy-in, Cash-out, Auszahlung. Chronologischer Verlauf aller Einträge mit Uhrzeit und Erfasser. Abschluss-Bereich mit Vorschau. Nach Abschluss: eingefrorene Abrechnung (Kassenverteilung + Überweisungen). Live-Update per Realtime. |
| Spieler-Übersicht | Alle Spieler: Anzahl Sessions, Summe Buy-ins, Summe Stacks, Gesamtbilanz. Sortierbar. |
| Spieler-Detail | Verlauf je Session: Datum, Buy-ins, Stack, Ergebnis. |
| Admin | Nutzer mit Rolle (Dropdown), Schnellauswahl-Beträge. Nur Admin. |
| Audit-Log | Chronologisch, filterbar nach Session/Nutzer. Alle Rollen lesen. |

## 8. Bewusst nicht in v1

Diagramme, Monatsauswertungen, Verknüpfung Spieler↔Google-Konto, Abhaken bezahlter Schulden,
laufendes Schuldenkonto, Mehrsprachigkeit, andere Währungen, native Apps.

## 9. Offene Punkte (vom Auftraggeber zu liefern)

- [ ] Admin- und Editor-Gmail-Adressen (für `role_whitelist`-Seed)
- [ ] Google-Provider in Supabase aktiviert (Redirect-URI: `https://vcyqzqgybjggoreffwjc.supabase.co/auth/v1/callback`)
- [ ] Weg zum Einspielen der Migrationen: Supabase-CLI (`npx supabase login` + `link`) oder SQL-Editor
- [ ] GitHub-Repo + Vercel-Konto (erst für WP10)
