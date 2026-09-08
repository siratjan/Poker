# WP0 – Übergabe Siri

## Umgesetzt

- **Git**: Repository im Projektordner initialisiert (Branch `main`). `.gitignore` von
  create-next-app um `!.env.example` und `/qa/tmp` ergänzt (`.env*` war bereits drin, `.vercel` auch).
- **Next.js-Gerüst**: `npx create-next-app@latest` (TypeScript, Tailwind v4, ESLint, App Router,
  `src/`, Alias `@/*`, npm, kein Turbopack, kein React Compiler) in `scaffold-tmp/` erzeugt, Inhalte
  in den Projektordner verschoben, `scaffold-tmp/` gelöscht. `docs/`, `qa/`, `.claude/` und
  `CLAUDE.md` sind unverändert; die vom Generator angelegte `CLAUDE.md` (nur `@AGENTS.md`) wurde
  vor dem Verschieben gelöscht. Ergebnis: Next 16.3.4, React 19.2.8.
- **Abhängigkeiten**: `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `clsx`;
  dev: `vitest`, `@vitest/coverage-v8`, `fast-check`, `@types/node`.
- **Env**: `.env.local` mit `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  (nicht committet), `.env.example` mit den Schlüsseln ohne Werte (committet).
- **Supabase-Helfer**: `src/lib/supabase/client.ts` (Browser), `src/lib/supabase/server.ts`
  (Server Components/Actions, `cookies()` aus `next/headers`), `src/lib/supabase/middleware.ts`
  (`updateSession`, Session-Refresh) und `src/middleware.ts` (Matcher ohne statische Assets).
  Redirect-Logik bewusst noch nicht enthalten – kommt laut Plan in WP2.
- **Geld**: `src/lib/money.ts` mit `formatCents()` und `parseEuroInput()`,
  Tests in `src/lib/money.test.ts` (24 Fälle, inkl. aller im Plan genannten).
- **Test-Setup**: `vitest.config.mts` (environment `node`, include `src/**/*.test.ts` und
  `tests/**/*.test.ts`, Coverage v8 auf `src/lib/**`).
- **Scripts** in `package.json`: `dev`, `build`, `start`, `lint`, `typecheck`, `test`,
  `test:watch`, `check`. Paketname `poker-kasse`.
- **Ordnerstruktur** (mit `.gitkeep`): `src/actions/`, `src/components/ui/`, `src/lib/settlement/`,
  `src/lib/auth/`, `supabase/migrations/`, `tests/gaby/`, dazu `qa/handoffs/`.
- **UI-Platzhalter**: `src/app/layout.tsx` (`lang="de"`, Viewport-Export mit `width=device-width`,
  `initial-scale=1`, `viewport-fit=cover`, Titel „Poker-Kasse“), `src/app/page.tsx`
  („Poker-Kasse“ / „Setup OK“).
- **`.claude/launch.json`** mit Konfiguration `dev` (`npm run dev`, Port 3000).

## Abweichungen vom Plan

- **`typecheck` ist `next typegen && tsc --noEmit`** statt nur `tsc --noEmit`. Next 16 generiert die
  globalen Typen `LayoutProps`/`PageProps` erst beim Build nach `.next/types`; ohne vorherigen
  `typegen` scheitert `tsc` in einem frischen Checkout an `Cannot find name 'LayoutProps'`.
- **`vitest.config.mts` statt `vitest.config.ts`**: Vite 8 warnt bei einer `.ts`-Config mit
  ESM-Syntax ohne `"type": "module"`. Die `.mts`-Endung ist die von Vite empfohlene Lösung und
  wird von `tsconfig.json` (`**/*.mts`) mit typgeprüft.
- **`@types/node` auf `^24`** angehoben (create-next-app setzt `^20`). Vitest 5 verlangt als
  Peer `^22 || >=24`; mit `^20` bricht `npm install` mit `ERESOLVE` ab. Node ist hier 24, passt.
- **Schriftart**: die von create-next-app eingebauten Google-Fonts (Geist) wurden entfernt, damit
  der Build keine Netzwerkabhängigkeit zu `fonts.googleapis.com` hat. Stattdessen System-Font-Stack
  in `globals.css`.
- Der Generator legt zusätzlich `AGENTS.md` an (Hinweis-Block, den `next dev` selbst wieder
  schreibt). Die Datei bleibt committet, damit der Arbeitsbaum sauber bleibt.

## Offene Fragen an den Planer

- Next 16 meldet beim Build: *„The ‚middleware‘ file convention is deprecated. Please use ‚proxy‘
  instead.“* Der Implementation Plan nennt ausdrücklich `src/middleware.ts`, deshalb ist es dabei
  geblieben (funktioniert, nur deprecated). Soll die Datei in WP2 auf `src/proxy.ts` umgestellt
  werden?
- `parseEuroInput` bekommt keine Obergrenze (nur `Number.isSafeInteger`). Falls fachlich ein
  Maximalbetrag pro Buy-in gewünscht ist, gehört er in die SPEC.

## Neue Abhängigkeiten

- `@supabase/supabase-js@^2.116.0`, `@supabase/ssr@^0.12.7` – Supabase-Anbindung (laut Plan)
- `zod@^4.5.4` – Eingabevalidierung ab WP4 (laut Plan)
- `clsx@^2.1.1` – Klassennamen (laut Plan)
- `vitest@^5.0.0`, `@vitest/coverage-v8@^5.0.0`, `fast-check@^4.9.0` (dev) – Tests (laut Plan)
- `@types/node@^24.13.3` (dev) – von `^20` angehoben, siehe Abweichungen

## Prüfung

- `npm run check`: grün (2026-09-08, 16:41) – typecheck, ESLint ohne Befund, 24 Tests in 1 Datei.
- `npm run build`: grün – Routen `/` und `/_not-found` statisch, Middleware aktiv.
  Einzige Ausgabe: die oben genannte `middleware`-Deprecation-Warnung.
- `git status`: `.env.local` wird von `.gitignore` erfasst (`git check-ignore -v .env.local` →
  `.gitignore:34:.env*`), `.env.example` ist committet.
- Dev-Server wurde absichtlich nicht gestartet (Regel für Siri).

## So prüft man es

1. `npm ci` im Projektordner.
2. `npm run check` → muss grün sein (typecheck, lint, 24 Tests).
3. `npm run build` → muss grün sein.
4. `git status --short` → keine `.env.local`, kein `node_modules`, kein `.next`.
5. Ordner- und Script-Abgleich gegen WP0 Schritt 7 und 8.
6. Für die Sichtprüfung (Planer): Browser-Pane mit Konfiguration `dev` aus `.claude/launch.json`
   starten, `http://localhost:3000` zeigt „Poker-Kasse / Setup OK“, Seitentitel „Poker-Kasse“,
   `<html lang="de">`. Mobile-Viewport 375 px.
7. Grenzfälle für `parseEuroInput` sind in `src/lib/money.test.ts` dokumentiert; die
   Separator-Regel steht als Doc-Kommentar über der Funktion (u. a. `"1.000"` → `100000`,
   `"100,555"` → `null`).

## Vorschläge (außerhalb des Pakets)

- In WP1/WP2 einen typisierten Supabase-Client (`Database`-Typen aus `supabase gen types`)
  einführen, damit Queries ohne `any` auskommen.
- `src/lib/env.ts` mit zod-validiertem Zugriff auf die beiden `NEXT_PUBLIC_*`-Variablen, damit die
  Non-Null-Assertions in den Supabase-Helfern entfallen.
- `.editorconfig` bzw. `.gitattributes` (`* text=auto eol=lf`) gegen die CRLF-Warnungen unter
  Windows.
