# WP10 – Smoke-Test in Produktion

**Vorlage.** Der Planer bzw. Auftraggeber füllt sie **nach** dem Deploy aus (Anleitung:
`docs/DEPLOY.md`, Schritt 9) und committet sie. Bis dahin ist WP10 nicht abgenommen.

## Rahmen

| Feld | Wert |
|---|---|
| Datum / Uhrzeit | |
| Getestete URL (`<PROD_URL>`) | |
| Deployment (Vercel-Commit / Deployment-ID) | |
| Gerät und Browser | (z. B. iPhone 14, Safari / Pixel 7, Chrome) |
| Konto und erwartete Rolle | (z. B. sirat…@gmail.com, `admin`) |
| Migrationsstand (höchste eingespielte Datei) | (z. B. `0007_player_stats.sql`) |

Ergebnis je Schritt: **OK** / **Fehler** (mit Beobachtung). Ein Fehler in einem Schritt macht
den Smoke-Test rot, auch wenn die übrigen Schritte laufen.

---

## 1. Login

Aufruf von `<PROD_URL>` → Weiterleitung auf `/login` → „Mit Google anmelden“ → Kontoauswahl →
zurück in der App, angemeldet, auf der **öffentlichen** Adresse (nicht auf einer internen
Vercel-Adresse und nicht auf `localhost`).

- Ergebnis: 
- Landeadresse nach dem Login (URL aus der Adresszeile): 
- Angezeigte Rolle / sichtbare Tabs: 
- Beobachtung: 

## 2. Session anlegen

Tab **Sessions** → neue Session anlegen (Datum, optionaler Name), Spieler hinzufügen.

- Ergebnis: 
- Session erscheint in der Liste: 
- Beobachtung: 

## 3. Buy-in erfassen

In der Session einen Buy-in **bar** und einen **auf Liste** erfassen (Schnellauswahl und freie
Eingabe je einmal). Beträge in der Summenzeile prüfen.

- Ergebnis: 
- Erfasste Beträge / erwartete Summe / angezeigte Summe: 
- Beobachtung: 

## 4. Cash-out (End-Stack) erfassen

End-Stacks aller Spieler eintragen; Differenz-Anzeige beobachten.

- Ergebnis: 
- Angezeigte Differenz: 
- Beobachtung: 

## 5. Abschluss

Session abschließen. Abrechnung erscheint: Kassenverteilung und Schuldenliste nach der Regel
„Bargeld zuerst an Bar-Zahler“. Danach prüfen, dass die Session **unveränderlich** ist
(Bearbeiten-Knöpfe weg) und die Abrechnung beim erneuten Laden **unverändert** aus der
Datenbank kommt.

- Ergebnis: 
- Abrechnung stimmt mit der Handrechnung überein: 
- Session nach Neuladen weiterhin gesperrt und identisch: 
- Beobachtung: 

## 6. Log

Tab **Log** (nur admin): Die Einträge der Schritte 2–5 stehen mit Zeitstempel und Urheber drin.

- Ergebnis: 
- Sichtbare Einträge (Anzahl / Typen): 
- Beobachtung: 

---

## Zusatzprüfungen (falls durchgeführt)

| Prüfung | Ergebnis |
|---|---|
| Zweites Konto meldet sich an → landet als `viewer`, sieht keine Bearbeiten-Knöpfe | |
| „Zum Home-Bildschirm“ (PWA) startet ohne Browser-Leiste | |
| Preview-Deploy ist ohne Vercel-Login **nicht** erreichbar | |
| Vercel-Runtime-Logs zeigen keine Fehler während des Tests | |

## Gesamturteil

**Ergebnis: OFFEN** *(nach dem Test durch GRÜN oder ROT ersetzen)*

Offene Punkte / Nacharbeit:

- 
