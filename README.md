# Poker-Kasse

Web-App zur Dokumentation von Pokerabenden: Buy-ins (bar oder auf Liste), End-Stacks und die
automatische Verteilung der Kasse samt Schuldenliste nach der Regel „Bargeld zuerst an Bar-Zahler“.
Login über Google, Rollen admin / editor / viewer, lückenloses Audit-Log.

## Dokumentation

- `CLAUDE.md` – Konventionen, eiserne Regeln, Befehlsübersicht
- `docs/SPEC.md` – fachliche Wahrheit
- `docs/SETTLEMENT.md` – Abrechnungs-Algorithmus mit Pflicht-Testfällen
- `docs/ARBEITSPAKETE.md` – Arbeitspakete WP0–WP10
- `docs/WORKFLOW.md` – Zusammenarbeit Planer / Developer / Tester
- `docs/STATUS.md` – Fortschritt je Paket

## Stack

Next.js (App Router, `src/`), TypeScript strict, Tailwind, Supabase (`@supabase/ssr`),
Vitest + fast-check, Deployment auf Vercel.

## Einrichtung

```bash
npm ci
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY eintragen
```

## Befehle

```bash
npm run dev            # Dev-Server auf http://localhost:3000
npm run check          # typecheck + lint + test – Pflicht vor jeder Übergabe
npm run build          # Produktions-Build
npm run test:watch     # Tests im Watch-Modus
npm run test:coverage  # Tests mit Coverage-Report
```

Geldbeträge sind im gesamten Projekt Integer-Cent (`*_cents`); Anzeige über `formatCents`,
Eingabe über `parseEuroInput` (`src/lib/money.ts`).
