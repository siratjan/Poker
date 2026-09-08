# Poker-App („Poker-Kasse“)

Pokerabende dokumentieren: Buy-ins (bar / auf Liste), End-Stacks, automatische Kassenverteilung
und Schuldenliste nach der Regel „Bargeld zuerst an Bar-Zahler“. Google-Login, Rollen
admin / editor / viewer, lückenloses Audit-Log.

## Dokumente (Wahrheit in dieser Reihenfolge)

1. `docs/SPEC.md` – fachliche Entscheidungen. Ändert nur der Planer.
2. `docs/SETTLEMENT.md` – Abrechnungs-Algorithmus mit Pflicht-Testfällen TV1–TV12.
3. `docs/ARBEITSPAKETE.md` – WP0–WP10 mit Implementation Plan, DoD, Testauftrag.
4. `docs/WORKFLOW.md` – Zusammenarbeit Planer (Sirat) → Developer (Siri) → Tester (Gaby).
5. `docs/STATUS.md` – Fortschritt je Paket.

## Stack

Next.js (App Router, `src/`), TypeScript strict, Tailwind, Supabase (`@supabase/ssr`),
Vitest + fast-check, Vercel. Supabase-Projekt: `https://vcyqzqgybjggoreffwjc.supabase.co`.
Env in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`).

## Befehle

```
npm run dev        # Dev-Server :3000 (Planer startet ihn über das Browser-Pane, launch.json "dev")
npm run check      # typecheck + lint + test – Pflicht vor jeder Übergabe
npm run build
npm run test:watch
npm run rls:smoke  # WP1+: prüft ohne Login, dass RLS alles blockt
```

## Eiserne Regeln

- Geld = Integer-Cent (`*_cents`). Nie Float. Anzeige `formatCents`, Eingabe `parseEuroInput`.
- Schreiben nur über Server Actions (`src/actions/*`) mit Server-Client. Rechte erzwingt die DB (RLS + Trigger), die UI blendet nur aus.
- Abgeschlossene Sessions sind unveränderlich; Abrechnung wird eingefroren gespeichert und aus der DB angezeigt, nie neu berechnet.
- UI Deutsch, Code/Commits Englisch. Keine `any`. Lint sauber.
- `tests/gaby/**` gehört Gaby: nie löschen oder abschwächen.
- Keine Secrets im Repo. Der Publishable Key ist öffentlich und darf in `.env.local`.
- Kein Scope-Creep über das beauftragte Arbeitspaket hinaus.

## Agenten

- `siri` (Developer): „Siri, WPn umsetzen“ → Code + Tests + Commit + `qa/handoffs/WPn-siri.md`.
- `gaby` (Tester): „Gaby, WPn prüfen“ → Checks + eigene Tests + `qa/reports/WPn-gaby.md` mit Urteil.
