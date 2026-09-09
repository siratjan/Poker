# WP4 – Übergabe Siri

**Status: code-complete, aber `npm run check` ist rot wegen genau einer WP2-Gaby-Assertion,
die jede WP4-Server-Leseabfrage zwangsläugfig verletzt. Ich habe die Gaby-Tests NICHT angefasst
(Planer-Vorgabe) und deshalb NICHT committet. Siehe „Blocker“ unten – es braucht eine
Entscheidung des Planers, bevor der Abschluss-Commit gesetzt wird.**

## Umgesetzt

### Datenbank
- **`supabase/migrations/0006_session_overview.sql`** (neu) – View `session_overview`
  mit `security_invoker = true`: aggregiert je Session `participant_count` (aus
  `session_players`) und `total_buy_in_cents` (Summe der `entries` mit `type = 'buy_in'`,
  `::int`), plus die eigenen Session-Spalten. Eine Query statt N+1. `grant select … to
  authenticated`; anon bekommt nichts (und `security_invoker` lässt ohnehin die RLS des
  Nutzers greifen). Noch **nicht eingespielt** (DB weiterhin nicht verlinkt).
- **`src/lib/database.types.ts`** – die View unter `Views.session_overview` (Row +
  Relationship) ergänzt, damit `.from('session_overview')` typisiert ist. Tabellen, Enums,
  `TABLE_NAMES`, RPC-Signaturen unverändert (die Gaby-Schema-Tests dazu bleiben grün).

### Server Actions (alle `'use server'`, Rolle zuerst, dann zod, dann DB)
- **`src/actions/sessions.ts`** – `createSession` (`requireEditor`), `updateSessionMeta`
  (`requireEditor`), `deleteOpenSession` (`requireAdmin`). Alle mit `revalidatePath`.
  `deleteOpenSession` liest die gelöschten Zeilen zurück: 0 Zeilen (von der RLS-Delete-Policy
  gefiltert) → `CANNOT_DELETE_SESSION`. `updateSessionMeta` übersetzt den Trigger-`SESSION_CLOSED`.
- **`src/actions/players.ts`** – `createPlayer` (`requireEditor`), `renamePlayer`
  (`requireEditor`). Duplikat (Trim/Case, „ ali “ vs „Ali“) fängt der Unique-Index
  `name_normalized` per `23505` ab → `PLAYER_EXISTS` „Diesen Spieler gibt es schon.“
- Unbekannte DB-Fehler werden geloggt und generisch (`UNEXPECTED`) beantwortet – nie roher
  Postgres-Text Richtung Browser (über `actionResult` aus WP2).

### Validierung (kein `any`, deutsche Meldungen)
- **`src/lib/validation/session.ts`** – zod: `playedOn` ist ein echtes Kalenderdatum, max.
  heute + 1 Tag (Europe/Berlin); `name` getrimmt, ≤ 60 Zeichen, leer → `null`.
  `updateSessionMetaSchema`, `sessionIdSchema` (uuid).
- **`src/lib/validation/player.ts`** – zod: Name getrimmt, 1..40 Zeichen (deckt sich mit dem
  `length(trim(name)) between 1 and 40`-Check aus 0001).
- **`src/lib/validation/parse.ts`** – `parseInput(schema, input)` wirft `AppError('VALIDATION',
  <erste Meldung>)`; getrennt von den `'use server'`-Dateien (die dürfen nur async Funktionen
  exportieren).
- **`src/lib/time.ts`** – `berlinToday`, `maxPlayedOn` (heute+1), `isValidCalendarDate`,
  `formatPlayedOn` („Fr, 11.09.2026“). Reine Funktionen, ohne Date-Roundtrip (keine
  Zeitzonen-Off-by-one).

### Queries (Server, RLS als Nutzer)
- **`src/lib/queries/sessions.ts`** – `listSessions()` (eine Query gegen die View, neueste
  oben nach `played_on desc, created_at desc`), `getSessionHeader(id)`.
- **`src/lib/queries/players.ts`** – `listPlayers()` alphabetisch über `name_normalized`.

### UI-Bausteine `src/components/ui/`
- `Button` (Größen md/lg ≥ 44/52 px, Varianten primary/secondary/danger; `buttonClasses`
  exportiert, damit ein `<Link>` gleich aussieht), `Card`, `Badge` + `SessionStatusBadge`
  (Offen grün / Abgeschlossen grau), `Input` (Label, Fehler, ≥ 44 px, hook-frei), `EmptyState`,
  `Sheet` (Bottom-Sheet, Esc/Backdrop schließt, Scroll-Lock, Safe-Area), `Toast`
  (`ToastProvider` + `useToast`, sitzt über der Tab-Leiste, Auto-Dismiss).

### Screens
- **`src/app/(app)/page.tsx`** – Session-Liste: Karten, Datum/Name/„n Spieler · Betrag
  Buy-ins“/Status-Badge, Link auf `/sessions/[id]`. Sticky-Button „Neue Session“ unten (nur
  Editor+). Leerzustand „Noch keine Session…“.
- **`src/app/(app)/sessions/new/page.tsx`** + **`src/components/sessions/NewSessionForm.tsx`** –
  Datum (Default heute Berlin, `max` = heute+1), Name optional; nach Anlegen `router.push` auf
  `/sessions/[id]`. Viewer sieht „Kein Zugriff“.
- **`src/app/(app)/players/page.tsx`** + **`src/components/players/PlayersManager.tsx`** –
  Spieler alphabetisch; Editor: „Spieler anlegen“ und Umbenennen inline; Viewer: read-only.
  Nach Schreiben `router.refresh()`.
- **`src/app/(app)/sessions/[id]/page.tsx`** – vorläufige Kopfzeile (Datum, Name, Status),
  `notFound()` bei unbekannter ID. WP5 füllt den Rest.
- **`src/app/(app)/layout.tsx`** – `ToastProvider` um `<main>`.

### Tests (eigene)
- `src/lib/time.test.ts`, `src/lib/validation/session.test.ts`, `src/lib/validation/player.test.ts`,
  `src/actions/sessions.test.ts`, `src/actions/players.test.ts` (Supabase + `getCurrentUser` +
  `next/cache` gemockt: Rollenwächter je Action, Validierung vor DB-Zugriff, `PLAYER_EXISTS`,
  `SESSION_CLOSED`, `CANNOT_DELETE_SESSION`, generische Fehlerbehandlung). 486 Tests grün.

## Blocker (bitte Planer entscheiden)

`tests/gaby/wp2-auth.gaby.test.ts:253-256` fixiert als WP2-Momentaufnahme:

```js
it('greift überhaupt nur aus Server-Dateien auf app_users zu', () => {
  const withTable = SRC_FILES.filter((file) => /\.from\(/.test(read(file)));
  expect(withTable).toEqual(['src/lib/auth/getCurrentUser.ts']);
});
```

WP4 fügt planmäßig **serverseitige** Tabellenzugriffe hinzu (`src/lib/queries/sessions.ts`,
`src/lib/queries/players.ts`, `src/actions/sessions.ts`, `src/actions/players.ts`). Damit ist
diese eingefrorene 1-Datei-Liste ab WP4 zwangsläufig verletzt – jede korrekte WP4-Umsetzung mit
`.from(` bricht sie.

- Die eigentliche Sicherheitszusage („keine Client-Komponente greift auf eine Tabelle zu“,
  Zeile 244-251) bleibt **grün** – meine neuen Zugriffe liegen alle in Server-Dateien (Query-
  Module über `next/headers`-Cookies bzw. `'use server'`-Actions), keine ist `'use client'`.
- Ich habe die Gaby-Tests **nicht angefasst** (Planer-Vorgabe „NICHT anfassen“) und deshalb den
  Abschluss-Commit **nicht** gesetzt (eiserne Regel: nicht übergeben, wenn `check` rot ist).
- Der WP2-Plan (Schritt 12) hat genau für solche Fälle eine eng begrenzte, kommentierte
  Anpassung einer Gaby-Assertion ausdrücklich zugelassen. Der WP4-Plan enthält keine solche
  Freigabe – daher die Rückfrage.

**Empfohlene minimale Korrektur** (Entscheidung liegt bei Planer/Gaby): die eingefrorene
Gleichheit durch die verallgemeinerte, stärkere Zusage ersetzen –

```js
it('greift überhaupt nur aus Server-Dateien auf eine Tabelle zu', () => {
  const withTable = SRC_FILES.filter((file) => /\.from\(/.test(read(file)));
  for (const file of withTable) {
    expect(/^['"]use client['"]/m.test(read(file)), file).toBe(false);
  }
  expect(withTable).toContain('src/lib/auth/getCurrentUser.ts');
});
```

Sobald der Planer die Anpassung freigibt (oder selbst vornimmt), setze ich den Commit
`WP4: sessions list, create session, players admin`.

## Abweichungen vom Plan
1. **`import 'server-only'`** in den Query-Modulen wieder entfernt: das Paket ist nicht
   installiert, und eine neue Abhängigkeit ohne Freigabe ist unerwünscht. Server-Zwang kommt
   ohnehin über `createClient` → `next/headers`.
2. **View-Migration heißt `0006_session_overview.sql`** (nicht `0005_views.sql` wie im
   WP4-Plantext), weil `0005` von WP2 belegt ist – so vom Planer vorgegeben.
3. Session-Detail (`/sessions/[id]`) ist bewusst nur die Kopfzeile (WP4 Schritt 8); der Rest
   ist WP5.

## Offene Fragen an den Planer
1. Der Blocker oben (WP2-Gaby-Assertion). Bitte freigeben oder anders entscheiden.
2. `getSessionHeader` liefert nur `id/playedOn/name/status/closedAt`. Reicht für die
   vorläufige Kopfzeile; WP5 erweitert.

## Neue Abhängigkeiten
Keine. (`server-only` bewusst nicht aufgenommen, siehe Abweichung 1.)

## Prüfung
- `npm run typecheck`: **grün** (09.09.2026).
- `npm run lint`: **grün**, keine Ausgabe.
- `npm run test`: **486 grün, 1 rot** – der rote ist ausschließlich
  `tests/gaby/wp2-auth.gaby.test.ts:255` (siehe Blocker), kein Fehler in WP4-Code.
- `npm run build`: **grün** – Routen `/`, `/sessions/new`, `/sessions/[id]`, `/players` u. a.
- DB nicht eingespielt → `0006` nicht live verifiziert, `listSessions`/`listPlayers` nicht
  gegen echte Daten geprüft. Dev-Server nicht gestartet (Regel für Siri).

## So prüft man es
1. `npm run typecheck`, `npm run lint`, `npm run build` → grün.
2. `npm run test` → 486 grün, 1 rot (nur die WP2-Assertion aus dem Blocker).
3. Nach Freigabe/Anpassung der Gaby-Assertion: `npm run check` komplett grün.
4. `0001`–`0006` einspielen (Reihenfolge!). `session_overview` prüfen:
   `select * from public.session_overview;` – je Session `participant_count` und
   `total_buy_in_cents` (nur `buy_in`).
5. Live (Planer, Browser 375 px): als Editor Session anlegen → landet auf `/sessions/[id]`,
   Liste zeigt sie oben. Spieler „Ali“ anlegen, dann „ ali “ → Fehler „Diesen Spieler gibt es
   schon.“. Als Viewer: keine Anlege-/Umbenennen-Buttons, `/sessions/new` zeigt „Kein Zugriff“.

## Vorschläge (außerhalb des Pakets)
- WP5 baut `src/lib/errors/de.ts` (volle Trigger-Code-Tabelle). Die zwei kleinen Mapper in
  `actions/sessions.ts`/`players.ts` sollten dann dorthin wandern.
- `session_overview` kann in WP5/WP7 um `status`-Filter oder Summen (Cash/Liste) erweitert
  werden, falls die Liste mehr zeigen soll.
