# WP4 – Prüfbericht Gaby

**Urteil: FREIGEGEBEN**

WP4 (Spieler-Verwaltung, Session-Liste, Session anlegen) erfüllt DoD und Testauftrag.
Keine Blocker, keine Major-Findings. `npm run check` ist nach dem freigegebenen
Snapshot-Fix komplett grün. Live-/Browser-Punkte stehen unter „Nicht verifiziert“.

> Hinweis: Der Code liegt uncommittet im Working Tree (Absprache: erst grünes Urteil,
> dann Commit durch Siri). Ich habe nur `tests/gaby/**` angefasst — kein Produktivcode.

## Durchgeführt

| Befehl | Ergebnis |
|---|---|
| `npm run check` (typecheck + lint + test) | **grün** — 25 Testdateien, **506 Tests**, ~1,1 s |
| `npm run typecheck` (`next typegen && tsc --noEmit`) | grün |
| `npm run lint` (eslint) | grün, keine Ausgabe |
| `npm run build` | grün — Routen `/`, `/players`, `/sessions/new`, `/sessions/[id]`, `/admin`, `/log`, `/login`, `/auth/callback` |
| `vitest run tests/gaby/wp4-sessions.gaby.test.ts` | grün — 19 Tests |

### Snapshot-Fix (Schritt 1, vom Planer beauftragt)

- `tests/gaby/wp2-auth.gaby.test.ts` — die WP2-Momentaufnahme „greift überhaupt nur aus
  Server-Dateien auf app_users zu“ (feste Liste `['src/lib/auth/getCurrentUser.ts']`)
  auf die eigentliche Eigenschaft verallgemeinert: **jede** Datei mit `.from(`/`.rpc(`
  ist serverseitig (keine `'use client'`), plus verankert, dass `getCurrentUser.ts`
  weiterhin dabei ist. Kommentar mit Begründung gesetzt. Die stärkere Nachbar-Zusage
  „greift aus keiner Client-Komponente auf eine Tabelle zu“ (Zeile 244–251) bleibt
  **unverändert**. Eigenständig geprüft: alle 5 `.from(`-Fundstellen liegen in
  Server-Dateien (Beleg unten), keine ist `'use client'`.

### Eigene Tests

- `tests/gaby/wp4-sessions.gaby.test.ts` (neu, 19 Tests): Datum-Grenzen (heute /
  heute+1 ok, heute+2 und ferne Zukunft raus, Vergangenheit ok, unmögliche
  Kalenderdaten raus), Namensregeln (Session-Trim/≤60/leer→null, Spieler-Trim/1..40,
  uuid-Pflicht bei Rename/Update), Rollenwächter je Action per Quelltext-Scan
  (`requireEditor`/`requireAdmin` vor dem ersten `createClient()`), View-Eigenschaften
  von `0006` (security_invoker, `::int`, nur `buy_in`, grant nur an authenticated).

## `.from(`/`.rpc(`-Bestandsaufnahme (Sicherheitszusage)

Genau 5 Dateien greifen auf Tabellen/Views zu, alle serverseitig:

| Datei | Server-Grund | `'use client'`? |
|---|---|---|
| `src/lib/auth/getCurrentUser.ts` | Server-Client (WP2) | nein |
| `src/lib/queries/sessions.ts` | `createClient` aus `@/lib/supabase/server` | nein |
| `src/lib/queries/players.ts` | `createClient` aus `@/lib/supabase/server` | nein |
| `src/actions/sessions.ts` | `'use server'` | nein |
| `src/actions/players.ts` | `'use server'` | nein |

## Rollenprüfung je Action (Testauftrag)

| Action | Datei | Wächter | Vor DB-Zugriff? | Test |
|---|---|---|---|---|
| `createSession` | `src/actions/sessions.ts:27` | `requireEditor` | ja | Viewer→FORBIDDEN (Unit + gaby-Scan) |
| `updateSessionMeta` | `src/actions/sessions.ts:45` | `requireEditor` | ja | gaby-Scan |
| `deleteOpenSession` | `src/actions/sessions.ts:67` | `requireAdmin` | ja | Editor→FORBIDDEN (Unit) |
| `createPlayer` | `src/actions/players.ts:26` | `requireEditor` | ja | Viewer→FORBIDDEN (Unit) |
| `renamePlayer` | `src/actions/players.ts:44` | `requireEditor` | ja | Viewer→FORBIDDEN (Unit) |

Jede Action ruft den Wächter als erste Anweisung, vor `parseInput` und vor
`createClient()`. Bei Ablehnung wird die DB nie berührt (`expect(createClient).not.toHaveBeenCalled()`).

## DoD-Abgleich

| DoD-Punkt | Status | Anmerkung |
|---|---|---|
| Editor legt Session an und landet auf Detailseite; Liste zeigt sie oben | teilweise verifiziert | `createSession` gibt `id` zurück; `NewSessionForm` macht `router.push('/sessions/'+id)`; Liste sortiert `played_on desc, created_at desc`. Der volle Klick-Fluss ist Browser-Sache (Planer). |
| Viewer sieht keine Anlege-/Bearbeiten-Buttons; direkter Action-Aufruf → `FORBIDDEN` | ✔ | UI blendet aus (`canEdit`), `/sessions/new` zeigt „Kein Zugriff“; Actions liefern `FORBIDDEN` (Unit-Tests). RLS zusätzlich (nicht live). |
| Duplikat-Spielername abgefangen (auch „ ali “ vs „Ali“) | ✔ (Logik) / DB nicht live | Schema trimmt; case-insensitive Dedup über Unique-Index `name_normalized`; `23505`→`PLAYER_EXISTS` „Diesen Spieler gibt es schon.“ (Unit). Die DB-seitige Normalisierung selbst ist nicht eingespielt → siehe „Nicht verifiziert“. |
| Mobile 375 px ohne horizontales Scrollen | nicht verifiziert | Kein Browser. Tap-Ziele im Code ≥ 44 px (`Button` `min-h-[44px]`/`[52px]`, Zeilen `min-h-[56px]`), `max-w-2xl`, `truncate`. Planer prüft Viewport. |
| `listSessions` ohne N+1 | ✔ | Eine Query gegen View `session_overview`; Aggregation (`count`/`sum`) in der DB. |
| zod-Datum max heute+1 Berlin, Name getrimmt ≤ 60 | ✔ | `src/lib/validation/session.ts`; gaby-Tests. |
| Geld = Integer-Cent, Anzeige `formatCents` | ✔ | View castet `::int`; `page.tsx` nutzt `formatCents(totalBuyInCents)`; kein Float. |
| Kein `any`, Lint sauber, Lint-Regeln nicht deaktiviert | ✔ | Kein `any`/`as any`/`eslint-disable`/`@ts-ignore` in `src/`. |
| UI Deutsch | ✔ | Alle sichtbaren Texte deutsch; Code/Kommentare englisch. |

## Nachgerechnete/geprüfte Details

- **Datum heute+1, nicht heute+2:** `maxPlayedOn()` == `berlinToday()+1` (gaby-Test), heute+2 abgelehnt.
- **Kalenderdatum:** `isValidCalendarDate` weist `2026-02-30`, `2026-13-01`, `2026-04-31`, `2026-00-10` ab; String-Vergleich `YYYY-MM-DD` ist chronologisch korrekt.
- **Kein Zeitzonen-Off-by-one:** `time.ts` rechnet rein auf Kalenderdaten (kein Date-Roundtrip für den Wert selbst); `berlinToday` über `Intl` in `Europe/Berlin`.
- **View 0006:** `security_invoker = true`, `left join` (Session ohne Teilnehmer/Buy-ins → `coalesce(...,0)`), Buy-in-Summe nur `type = 'buy_in'`, `grant select ... to authenticated`, kein `anon`.
- **Fehlerdurchreichung:** Unbekannte DB-Fehler werden geloggt und generisch (`UNEXPECTED`) beantwortet; roher Postgres-Text erreicht den Client nicht (Unit-Test mit `42501`).

## Findings

Keine Blocker, keine Major.

### F1 – Minor: `listSessions`/`listPlayers` schlucken DB-Fehler zu `[]`
- Wo: `src/lib/queries/sessions.ts:35-38`, `src/lib/queries/players.ts:22-25`
- Beobachtet: Bei einem Query-Fehler wird `console.error` geloggt und eine leere Liste
  zurückgegeben. Für den Nutzer sieht ein transienter Fehler dann wie „keine Sessions“
  aus (Leerzustand statt Hinweis).
- Erwartet: Für WP4 vertretbar (Erstaufbau, kein Geld betroffen). Kein DoD-Verstoß.
  Vorschlag für WP5/Realtime: Fehler vs. „wirklich leer“ unterscheiden und einen
  dezenten Hinweis zeigen.
- Reproduktion: Nur mit eingespielter DB + provoziertem Fehler sichtbar.

### F2 – Minor: Session-Detail zeigt `notFound()` auch bei fehlenden Rechten
- Wo: `src/app/(app)/sessions/[id]/page.tsx:17-18`
- Beobachtet: `getSessionHeader` gibt bei RLS-gefilterter Zeile `null` → `notFound()`.
  Ununterscheidbar von „ID existiert nicht“. Da alle Authentifizierten `select` auf
  `sessions` dürfen (0003), ist das v1 unkritisch.
- Erwartet: Ok für WP4. Nur festhalten für spätere Rollen-Feinheiten.
- Reproduktion: Nur live mit RLS.

## Nicht verifiziert

- **DB nicht eingespielt** (`0001`–`0006` nicht verlinkt): `session_overview` nur
  statisch am SQL geprüft, nicht live. Nicht getestet: tatsächliche RLS-Filterung der
  View, Aggregat-Werte gegen echte Daten, `name_normalized`-Unique-Verhalten
  (`23505`-Auslösung bei „ ali “ vs „Ali“), `SESSION_CLOSED`-Trigger. Planer/Auftraggeber:
  Migrationen einspielen und `select * from public.session_overview;` prüfen
  (je Session `participant_count` und `total_buy_in_cents` nur aus `buy_in`).
- **Browser/Mobile (Planer):** 375 px ohne horizontales Scrollen; kein Google-Provider
  aktiv. Konkret zu prüfen:
  1. Als Editor Session anlegen → Redirect auf `/sessions/[id]`, Karte oben in der Liste.
  2. Spieler „Ali“, dann „ ali “ → Fehler „Diesen Spieler gibt es schon.“ (nicht roh).
  3. Als Viewer: keine „Neue Session“/„Anlegen“/„Umbenennen“-Buttons; `/sessions/new`
     zeigt „Kein Zugriff“.
  4. Sticky-Button „Neue Session“ überdeckt bei langer Liste nicht die letzte Karte
     (Bottom-Padding/Safe-Area).
- **`rls:smoke`** nicht ausgeführt (keine Live-DB) — WP4 ändert nichts an der RLS-Logik,
  fügt nur die View hinzu.
