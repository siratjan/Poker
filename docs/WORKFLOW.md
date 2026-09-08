# Workflow: Sirat → Siri → Gaby

## Rollen

| Rolle | Wer | Modell | Aufgabe |
|---|---|---|---|
| **Planer** | Sirat (dieser Chat / Hauptsession) | Fable 5.1 | Hält Spezifikation und Arbeitspakete, beauftragt Siri, lässt Gaby prüfen, nimmt ab, macht Browser-Prüfungen, spricht mit dem Auftraggeber. |
| **Developer** | Siri (`.claude/agents/siri.md`) | Opus | Setzt genau ein Arbeitspaket nach Implementation Plan um. Schreibt Code und Tests. Übergibt schriftlich. |
| **Tester** | Gaby (`.claude/agents/gaby.md`) | Opus | Prüft ein Arbeitspaket gegen DoD und Testauftrag. Schreibt Report mit Urteil. Ändert keinen Produktivcode. |

Der Auftraggeber (Sirat, der Mensch) trifft fachliche Entscheidungen. Nur der Planer ändert
`docs/SPEC.md`, `docs/SETTLEMENT.md` und `docs/ARBEITSPAKETE.md`.

## Ablauf pro Arbeitspaket

```
Planer: "Siri, WPn umsetzen"
   │
   ▼
Siri: liest CLAUDE.md → SPEC → (SETTLEMENT) → WPn → bestehenden Code
      implementiert nach Plan, npm run check grün, Commit
      schreibt qa/handoffs/WPn-siri.md
   │
   ▼
Planer: "Gaby, WPn prüfen"
   │
   ▼
Gaby: liest WPn (DoD + Testauftrag) + Handoff, führt Checks aus, reviewt Code,
      schreibt eigene Tests unter tests/gaby/, schreibt qa/reports/WPn-gaby.md
      Urteil: FREIGEGEBEN | NACHARBEIT
   │
   ├── NACHARBEIT ──► Planer gibt Findings an Siri (SendMessage, gleicher Kontext)
   │                  Siri behebt, aktualisiert Handoff (Abschnitt "Runde 2")
   │                  Gaby prüft nur Findings + Regression (npm run check)
   │                  max. 3 Runden, danach eskaliert der Planer an den Auftraggeber
   │
   └── FREIGEGEBEN ──► Planer: Browser-Prüfung bei UI-Paketen, Abnahme, nächstes WP
```

## Regeln für Siri

1. Nur das beauftragte Paket. Kein „wo ich schon mal dabei bin“. Ideen für andere Pakete in den Handoff unter „Vorschläge“.
2. Abweichungen vom Implementation Plan sind erlaubt, wenn der Plan technisch nicht umsetzbar ist – dann im Handoff begründen. Abweichungen von `SPEC.md`/`SETTLEMENT.md` sind **nicht** erlaubt; stattdessen stoppen und die Frage im Handoff stellen.
3. Vor Übergabe: `npm run check` und `npm run build` grün. Wenn nicht grün: nicht übergeben, sondern Blocker melden.
4. Gabys Tests unter `tests/gaby/` werden nie gelöscht oder abgeschwächt. Schlägt einer fehl, ist das ein Bug, außer Gaby hat den Test als fehlerhaft markiert.
5. Keine Secrets in Dateien außer `.env.local`. Der Publishable Key ist kein Secret.
6. Keine neuen Abhängigkeiten ohne Nennung im Handoff.
7. Commit am Ende: `WPn: <kurzbeschreibung>`; Co-Author-Zeile laut Systemvorgabe.

## Regeln für Gaby

1. Keine Änderung an `src/`, `supabase/`, `docs/`, Konfiguration. Erlaubt: `qa/**` und neue Testdateien unter `tests/gaby/**`.
2. Prüfen heißt ausführen, nicht nur lesen: `npm ci` (bei WP0/WP1) bzw. `npm run check`, `npm run build`, projektspezifische Scripts (`rls:smoke`), eigene Tests.
3. Jeder Testfall aus `docs/SETTLEMENT.md` wird von Hand nachgerechnet, nicht dem Code geglaubt.
4. Findings mit Schweregrad: **Blocker** (falsches Geld, Sicherheitslücke, Spezifikationsbruch, Build rot), **Major** (Funktion fehlt/falsch, aber umgehbar), **Minor** (Kosmetik, Wortlaut, Struktur). Ein Blocker oder Major → Urteil NACHARBEIT.
5. Jedes Finding mit: Datei:Zeile, was beobachtet, was erwartet (mit Verweis auf SPEC/WP), wie reproduzieren.
6. Kein Urteil ohne eigene Tests, wenn das Paket Logik enthält.
7. Was nicht prüfbar war (z. B. DB nicht eingespielt, Browser nicht verfügbar), steht ausdrücklich unter „Nicht verifiziert“ – nie stillschweigend als OK werten.

## Vorlage `qa/handoffs/WPn-siri.md`

```markdown
# WPn – Übergabe Siri

## Umgesetzt
- Stichpunkte, was gebaut wurde (mit Dateipfaden)

## Abweichungen vom Plan
- Keine / oder: Punkt X anders gelöst, weil …

## Offene Fragen an den Planer
- Keine / oder: …

## Neue Abhängigkeiten
- Keine / oder: paket@version, Grund

## Prüfung
- npm run check: grün (Datum/Zeit)
- npm run build: grün
- Sonstiges (rls:smoke, manuell): …

## So prüft man es
1. Schritt-für-Schritt, was Gaby/Planer tun soll

## Vorschläge (außerhalb des Pakets)
- …

## Runde 2 (falls Nacharbeit)
- Finding 1: behoben in … / Finding 2: …
```

## Vorlage `qa/reports/WPn-gaby.md`

```markdown
# WPn – Prüfbericht Gaby

**Urteil: FREIGEGEBEN | NACHARBEIT**

## Durchgeführt
- Befehle mit Ergebnis (grün/rot, Dauer)
- Eigene Tests: tests/gaby/…, Ergebnis

## DoD-Abgleich
| DoD-Punkt | Status | Anmerkung |
|---|---|---|

## Findings
### F1 – [Blocker|Major|Minor] Kurztitel
- Wo: pfad/datei.ts:42
- Beobachtet: …
- Erwartet: … (SPEC §x / WPn Schritt y)
- Reproduktion: …

## Nicht verifiziert
- … und warum

## Runde 2 (falls Nacharbeit)
- F1: behoben ✔ / weiterhin offen ✘
```

## Was der Planer selbst macht

- Dev-Server über das Browser-Pane starten (`.claude/launch.json`, Konfiguration `dev`) und UI-Pakete manuell prüfen (Mobile-Viewport 375 px, zwei Tabs für Realtime, Rollen mit verschiedenen Konten).
- Migrationen einspielen bzw. den Auftraggeber dazu anleiten.
- Entscheidungen einholen, wenn Siri oder Gaby eine Spezifikationslücke melden.
- Nach Abnahme jedes Pakets eine Zeile in `docs/STATUS.md` (WP, Datum, Commit, Urteil).
