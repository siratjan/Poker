# Status

| WP | Titel | Siri-Commit | Gaby-Urteil | Planer-Abnahme | Datum |
|---|---|---|---|---|---|
| WP0 | Projekt-Setup | 49bc81f | FREIGEGEBEN (Runde 2) | abgenommen, Browser geprüft | 2026-09-08 |
| WP1 | Datenbank | 05d4197 | FREIGEGEBEN (Runde 2, 1 Minor → WP2) | Push in DB ausstehend | 2026-09-08 |
| WP2 | Auth + Rollen | 4de9bd1 | FREIGEGEBEN (4 Minor) + Planer-Finding, Runde 2 läuft | Browser: Redirects ok, Provider-Fehler roh | 2026-09-08 |
| WP3 | Abrechnungs-Algorithmus | 9087f54 | FREIGEGEBEN (Runde 2) | abgenommen | 2026-09-08 |
| WP4 | Spieler + Session-Liste | a98d8ea | FREIGEGEBEN (2 Minor → WP5) | Browser: Login, Rolle, Session anlegen ✔ | 2026-09-09 |
| WP5 | Session-Detail | b78f067 + 43276b5 + b5c4203 | FREIGEGEBEN (6 Minor, F1–F4 behoben, F5/F6 → WP7); Planer-Blocker Realtime (Join vor Token) in Runde 3 behoben | Browser: Buy-in 3 Tipps, Cash-out, Kacheln, Realtime 2 Tabs ≤ 2 s ✔ | 2026-09-09 |
| WP6 | Abschluss + Abrechnung | 5f83003 | FREIGEGEBEN (3 Minor: F1 behoben, F2/F3 → WP8-Vorab) | Browser: Differenz-Pfad, Abschluss, eingefrorene Abrechnung, Kopieren, Wieder öffnen ✔ (Mobile 375 px offen) | 2026-09-09 |
| WP7 | Spieler-Übersicht | – | – | – | – |
| WP8 | Admin + Audit-Log | – | – | – | – |
| WP9 | PWA + Polish | – | – | – | – |
| WP10 | Deployment | – | – | – | – |

## Vom Auftraggeber offen

- [x] Admin-/Editor-Gmail-Adressen mit Rolle
- [x] Google-Provider in Supabase aktiviert
- [x] Migrationsweg: Supabase-CLI (`npx supabase login` + `link`) oder SQL-Editor
- [ ] GitHub-Repo + Vercel-Konto (für WP10)
