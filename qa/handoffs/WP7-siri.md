# WP7 – Übergabe Siri

Paket: Spieler-Übersicht und Spieler-Detail (`docs/ARBEITSPAKETE.md`, WP7).
Gearbeitet im Worktree-Branch (Basis `main` = `45946f1`, enthält WP6 `5f83003` + Realtime-Fix).
Nicht gepusht, nicht nach `main` gemergt – das macht der Planer.

## Umgesetzt

**Datenbank**

- **`supabase/migrations/0007_player_stats.sql`** (neu) – View `player_stats`,
  `security_invoker = true`, idempotent (`create or replace`), `grant select … to authenticated`.
  Je Spieler: `sessions_played`, `total_buy_in_cents`, `total_stack_cents`, `net_cents`,
  `last_played_on`, `open_sessions`.
  - Geld und Sessions-Zähler kommen **nur** aus `settlement_lines` von Sessions mit
    `status = 'closed'` (`join sessions … where s.status = 'closed'`) – also aus der
    eingefrorenen Abrechnung, nie aus einer Neuberechnung. Eine wieder geöffnete Session
    verliert ihre `settlement_lines` (RPC `reopen_session`) und damit ihren Beitrag; das ist
    richtig, sie hat kein Ergebnis mehr.
  - `open_sessions` = Anzahl offener Sessions mit Teilnahme (aus `session_players`), für die
    Markierung „läuft“.
  - Spieler ohne jede Session bleiben drin (`left join` ab `players`) und lesen 0/0/0/0 mit
    `last_played_on = null`.
  - Alle Aggregate `coalesce(…, 0)::int` – Integer-Cent, kein `numeric`/Float.
- **`src/lib/database.types.ts`** – Zeilentyp der View unter `Views` ergänzt (Muster wie
  `session_overview`).

**Lesequeries (Server, `src/lib/queries/`)**

- **`result.ts`** (neu) – `QueryResult<T>` / `QueryFailure` wandern aus `sessionDetail.ts`
  hierher; `sessionDetail.ts` re-exportiert die Typen, alle bestehenden Importe bleiben gültig.
- **`players.ts`** – jetzt drei Funktionen, alle mit `QueryResult` (siehe „Abweichungen“, Punkt 2):
  - `listPlayers()` → `QueryResult<PlayerListItem[]>` (Gaby WP5, F6),
  - `listPlayerStats()` → `QueryResult<PlayerStats[]>` – **eine** Query auf `player_stats`,
  - `getPlayerDetail(id)` → `QueryResult<PlayerDetail>` – **fünf** Queries, unabhängig von der
    Anzahl Sessions: `player_stats` (Name, Summen, Existenzprüfung → `not_found`),
    `session_players`, `sessions` (`in (…)`), `settlement_lines` (`player_id = id`) und
    `entries` **nur für die offenen** Sessions. Abgeschlossene Abende kommen aus der
    eingefrorenen Zeile, offene aus `entries`; `payout` fließt nicht in Buy-in/Stack ein.
- **`sessions.ts`** – `listSessions()` ebenfalls auf `QueryResult` umgestellt (zweite Hälfte von
  Gaby WP5-F6), Startseite zeigt bei Fehler einen Hinweis statt „Noch keine Session“.

**Reine Logik + Tests**

- **`src/lib/players/stats.ts`** (neu) – Sortier- und Suchlogik als reine Funktionen:
  `DEFAULT_SORT` (`net`/`desc`), `SORT_KEYS`/`SORT_LABELS`, `initialDirection`,
  `nextSortState` (Tap auf aktive Spalte dreht, neue Spalte startet in ihrer natürlichen
  Richtung), `normalizeName` (Kleinschreibung + Diakritika, „muller“ findet „Müller“),
  `filterPlayers`, `sortPlayers` (stabiler Tie-Break über den Namen), `visiblePlayers`,
  `totalNetCents`.
- **`src/lib/players/stats.test.ts`** (neu, 24 Fälle) – Sortierung je Spalte und Richtung,
  Tie-Break, Suche inkl. Umlaut-Faltung, Unveränderlichkeit der Eingabe, Tap-Verhalten, sowie
  die **Konsistenzprüfung mit Fixture**: `Σ net_cents` über alle Spieler = `Σ discrepancy_cents`
  über alle abgeschlossenen Sessions (0 bei sauberen Abenden; Fixture mit −20,00 € und
  +5,00 € Differenz ergibt −15,00 €).
- **`src/lib/queries/playerStats.view.test.ts`** (neu, 9 Fälle) – SQL-Textprüfung der View wie in
  WP4: `security_invoker`, `left join` ab `players`, `where s.status = 'closed'`, Summen aus
  `settlement_lines`, `count(*) filter (… 'open')`, `coalesce(…, 0)::int` je Spalte, kein
  `numeric`/Float, `grant` nur an `authenticated`, kein Schreibbefehl. Kommentarzeilen werden
  vor der Prüfung entfernt, damit keine Zusage „im Prosatext“ erfüllt wird.

**UI**

- **`src/app/(app)/players/page.tsx`** – lädt `listPlayerStats()`, eigener Fehlerhinweis statt
  stiller Leerliste.
- **`src/components/players/PlayersManager.tsx`** – Übersicht: Suchfeld (`type="search"`,
  ≥ 44 px), Sortierleiste mit den fünf Spaltenköpfen (Name, Sessions, Buy-ins, Stacks, Bilanz;
  aktive Spalte farbig mit ↑/↓, `aria-pressed`, ≥ 44 px), je Spieler eine Karte: Name +
  Badge „läuft“ + Bilanz farbig rechts, darunter in festem Raster Sessions / Buy-in / Stack –
  rechtsbündig, `tabular-nums`, dadurch spaltengenau untereinander. Die ganze Karte verlinkt
  auf `/players/[id]`; der Umbenennen-Knopf (WP4) sitzt als 44-px-Ziel rechts daneben, Anlegen
  bleibt darüber.
- **`src/components/players/NetAmount.tsx`** (neu) – farbige Bilanz (grün/rot/neutral,
  `formatSignedCents`, `tabular-nums`); ohne abgeschlossenen Abend „–“ statt eines
  0,00 €, das wie ein Ergebnis aussähe. Ohne Hooks, also von Server- und Client-Seiten nutzbar.
- **`src/app/(app)/players/[id]/page.tsx`** (neu) – Kopf mit Name, Gesamtbilanz, Anzahl
  abgeschlossener Abende, Buy-ins, Stacks, „zuletzt gespielt“, Badge bei offenen Sessions.
  Darunter die Abende, **neueste oben**: Datum (+ Session-Name), Buy-ins bar/Liste, Stack,
  Ergebnis farbig – offene Sessions mit Badge „läuft“ und ohne Ergebnis. Jede Zeile verlinkt
  auf die Session. Fehlender Spieler → 404, kaputte Query → eigener Hinweis.
- **`src/components/sessions/ParticipantCard.tsx`** – Teilnehmer-Karte ohne Aktionen (Viewer
  oder abgeschlossene Session) ist jetzt der Link auf die Spieler-Seite.
- **`src/components/sessions/EntrySheets.tsx`** – im Aktions-Sheet neu „Spieler-Seite öffnen“
  (so bleibt der Tap auf die Karte der Buy-in, DoD „drei Tipps“). Außerdem meldet
  `AddParticipantSheet` jetzt „Die Spielerliste konnte nicht geladen werden …“ statt
  „Alle Spieler sind schon dabei.“, wenn die Query fehlschlug (Gaby WP5, F6).
- **`src/components/sessions/SessionDetailClient.tsx`**, **`src/app/(app)/sessions/[id]/page.tsx`** –
  reichen `playersLoadFailed` durch.
- **`src/app/(app)/page.tsx`** – Fehlerhinweis für die Session-Liste.

## Abweichungen vom Plan

1. **Migrationsnummer `0007` statt `0006`** (`0007_player_stats.sql`), weil `0006` seit WP4 von
   `0006_session_overview.sql` belegt ist – so vom Planer vorgegeben. Im Kopfkommentar der
   Migration vermerkt. Die DB ist mit `0001`–`0006` eingespielt; **`0007` muss der Planer noch
   einspielen**, sonst laufen `/players` und `/players/[id]` in den Fehlerhinweis.
2. **`listSessions` zusätzlich auf `QueryResult` umgestellt.** Der Auftrag nennt nur
   `listPlayers`; Gabys F6 (WP5) nennt beide und verweist beide nach WP7. Die Umstellung ist
   dieselbe Zeile Logik plus ein Zweig auf der Startseite – getrennt zu lassen hätte zwei
   verschiedene Fehlerbilder im selben Projekt zementiert.
3. **Spaltenköpfe als Sortierleiste, Zeilen als Karten** statt einer echten `<table>`. Fünf
   Spalten (Name + vier Zahlen) sind auf 360 px entweder unlesbar klein oder zwingen die Seite
   zum Seitwärts-Scrollen. Der Plan erlaubt ausdrücklich „Tabelle/**Karten**“; die
   Sortierleiste trägt die Spaltennamen, alle fünf Spalten sind sortierbar, die Zahlen stehen
   in einem festen Raster rechtsbündig und fluchten dadurch wie in einer Tabelle.
4. **Link zur Spieler-Seite an zwei Stellen**, nicht „auf der Karte“: interaktive Karten
   (Editor, offene Session) behalten Tap = Buy-in und bekommen den Link im Aktions-Sheet;
   nicht-interaktive Karten sind selbst der Link. Ein zusätzliches Link-Ziel auf der
   interaktiven Karte hätte neben „⋯“ ein zweites Icon gebraucht und den Buy-in-Weg verengt.
5. **`last_played_on` zählt auch offene Sessions** (Maximum von `played_on` über alle Sessions
   mit Teilnahme), während Zähler und Beträge nur abgeschlossene zählen. „Zuletzt gespielt“
   meint, wann jemand zuletzt am Tisch saß – am Abend selbst wäre „zuletzt: vor drei Wochen“
   falsch. Im SQL-Kommentar festgehalten; falls der Planer es anders will, ist es eine Zeile.

## Offene Fragen an den Planer

1. **`last_played_on`** – siehe Abweichung 5: offene Sessions mitzählen (jetzt) oder nur
   abgeschlossene?
2. **Umbenannte Spieler in eingefrorenen Abrechnungen**: `settlement_lines` speichert nur die
   `player_id`, der Name kommt immer aktuell aus `players`. Ein umbenannter Spieler erscheint
   also rückwirkend mit dem neuen Namen – in Übersicht, Detail und in der alten Abrechnung. Das
   ist konsistent mit WP6 und aus meiner Sicht gewollt (es ist dieselbe Person), aber es steht
   nirgends in der SPEC. Ich habe nichts eingefroren.
3. **Gelöschte Spieler**: Laut RLS darf ein Admin `players` löschen; `settlement_lines`
   referenziert `players(id)` ohne `on delete`, das Löschen scheitert also an der
   Fremdschlüssel-Beschränkung, sobald jemand einmal gespielt hat. Nur eine Beobachtung, in
   WP7 nichts zu tun.

## Neue Abhängigkeiten

- Keine.

## Prüfung

- `npm run check` (typecheck + lint + test): **grün** – 38 Dateien, 785 Tests (2026-09-09, 19:31).
  Vorher-Stand auf dem Branch: 36 Dateien / 758 Tests, also +27 neue Tests, keine gelöschten.
- `npm run build`: **grün**, Routen `/players` und `/players/[id]` werden gebaut.
- `tests/gaby/**`: unverändert, alle grün.
- Kein `.from(` in einer Client-Komponente (geprüft über alle Dateien mit `'use client'`).
- **Worktree-Hinweis (nicht Teil des Pakets):** `core.autocrlf = true` hatte die
  `supabase/migrations/*.sql` mit CRLF ausgecheckt, wodurch drei Fälle in
  `tests/gaby/wp1-schema.gaby.test.ts` rot waren. Ich habe **nur die Arbeitskopie** auf LF
  normalisiert (Blob-Inhalte im Repo sind bereits LF, der Commit enthält deshalb keine
  Zeilenenden-Änderung); Gabys Tests blieben unangetastet.
- **Nicht live verifiziert**: `0007` ist noch nicht eingespielt, die View ist nur statisch am
  SQL geprüft. Ebenso ungetestet im Browser: Sortier-/Suchbedienung am Handy.

## So prüft man es

1. `supabase/migrations/0007_player_stats.sql` im SQL-Editor einspielen
   (`Success. No rows returned`). Gegenprobe als eingeloggter Nutzer:
   `select * from public.player_stats order by net_cents desc;`
2. `/players` öffnen: Liste ist nach **Bilanz absteigend** vorsortiert. Auf „Name“ tippen →
   A→Z, nochmal → Z→A. Auf „Buy-ins“ → größter Betrag oben. Suchfeld: Teil eines Namens
   eingeben, auch mit falscher Groß-/Kleinschreibung oder ohne Umlaut.
3. Zahlen gegenrechnen: Für einen Spieler die Ergebnisse seiner abgeschlossenen Sessions
   addieren (Session-Detail, Abrechnungsblock, Spalte „Ergebnis“) – die Summe muss der Bilanz
   in der Übersicht entsprechen. Über **alle** Spieler summiert muss die Bilanz gleich der
   Summe der `discrepancy_cents` aller abgeschlossenen Sessions sein (bei sauberen Abenden 0).
4. Einen Spieler antippen → Detailseite: Kopf mit Gesamtbilanz, darunter die Abende neueste
   oben. Eine laufende Session muss als „läuft“ ohne Ergebnis erscheinen, aber mit den bisher
   erfassten Buy-ins. Zeile antippen → Session-Detail.
5. Neuer Spieler, noch nie dabei: erscheint in der Übersicht mit 0 Sessions, 0,00 € und „–“ als
   Bilanz; seine Detailseite sagt „Noch keine Session.“
6. Rückweg: In einer **abgeschlossenen** Session (oder als Viewer) auf eine Teilnehmer-Karte
   tippen → Spieler-Seite. In einer **offenen** Session als Editor: „⋯“ → „Spieler-Seite
   öffnen“; der Tap auf die Karte selbst muss weiterhin direkt das Buy-in-Sheet öffnen.
7. Umbenennen (Editor) funktioniert weiter: „✎“ rechts auf der Karte, Name ändern, speichern.
8. Session wieder öffnen (Admin) → der Abend verschwindet aus Bilanz und Sessions-Zähler des
   Spielers und taucht auf der Detailseite als „läuft“ auf. Erneut abschließen → er ist zurück.

## Vorschläge (außerhalb des Pakets)

- `.gitattributes` mit `* text=auto eol=lf` (und `*.sql text eol=lf`) – der CRLF-Stolperstein
  aus WP6 kostet in jedem neuen Worktree wieder Zeit. Weiterhin nur ein Vorschlag, weil es alle
  Checkouts betrifft.
- WP9: In der Übersicht wäre eine Kopfzeile „Gesamtbilanz aller Spieler“ nützlich – sie ist bei
  sauberen Abenden 0,00 € und macht eine vergessene Differenz sofort sichtbar
  (`totalNetCents` existiert bereits).
- WP9: Auf der Spieler-Detailseite könnte man die Abende nach Jahr gruppieren, sobald es viele
  sind; heute ist eine flache Liste richtig.
- WP8: `player_stats` ließe sich im Admin-Bereich für „Spieler ohne Session“ (löschbar)
  wiederverwenden.
