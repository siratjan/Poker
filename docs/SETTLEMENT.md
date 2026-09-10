# Abrechnungs-Algorithmus – exakte Definition (Version 1)

Diese Datei ist die Referenz für `src/lib/settlement/` und für Gabys Tests. Jede Abweichung
zwischen Code und dieser Datei ist ein Bug – entweder im Code oder in der Datei; im Zweifel
entscheidet der Planer.

## Eingabe

Pro Teilnehmer der Session (alle Beträge Integer-Cent, ≥ 0):

| Feld | Bedeutung |
|---|---|
| `playerId` | Spieler |
| `cashIn` | Summe aller `buy_in` mit Zahlungsart `cash` |
| `creditIn` | Summe aller `buy_in` mit Zahlungsart `credit` |
| `stack` | Betrag des `cash_out` (End-Stack) |
| `payout` | Summe aller `payout` (bereits bar aus der Kasse erhalten) |

Vorbedingungen (von der UI/DB erzwungen, der Algorithmus prüft sie trotzdem und wirft bei Verletzung):

- Jeder Teilnehmer hat einen `cash_out` (sonst ist die Session nicht abschließbar).
- `payout ≤ stack` pro Spieler.
- `Σ payout ≤ Σ cashIn` (man kann nicht mehr Bargeld auszahlen, als in der Kasse ist).

Jeder Teilnehmer trägt eine `position` (Beitrittsreihenfolge aus `session_players`, ganzzahlig,
eindeutig, Pflicht). Die Eingabe wird vor der Berechnung nach `position` sortiert, damit alle
Tie-Breaks deterministisch sind. Weitere Sortierschlüssel gibt es nicht.

## Ausgabe

```ts
type SettlementResult = {
  algorithmVersion: 1;
  totalBuyIn: number;          // Σ cashIn + Σ creditIn
  totalStack: number;          // Σ stack
  discrepancy: number;         // totalStack - totalBuyIn (0 = sauber; <0 fehlen Chips; >0 zu viel gezählt)
  cashBoxStart: number;        // Σ cashIn
  cashBoxAfterPayouts: number; // Σ cashIn - Σ payout (das wird am Ende physisch verteilt)
  lines: SettlementLine[];     // eine je Spieler, in Eingabereihenfolge
  transfers: Transfer[];       // "from schuldet to amount"
  unallocatedCash: number;     // Bargeld, das nach Stufe 3 in der Kasse bleibt (nur bei discrepancy < 0 möglich)
  uncoveredClaims: number;     // Ansprüche ohne Deckung (nur bei discrepancy > 0 möglich)
  uncoveredDebts: number;      // Schulden ohne Gläubiger (nur bei discrepancy < 0 möglich)
};

type SettlementLine = {
  playerId: string;
  cashIn: number; creditIn: number; stack: number; payout: number;
  isCashPlayer: boolean;       // cashIn > 0
  claim: number;               // stack - payout (was der Spieler noch zu bekommen hat)
  cashTier1: number;           // aus Stufe 1 erhalten
  cashTier2: number;           // aus Stufe 2 erhalten
  cashTier3: number;           // aus Stufe 3 erhalten
  cashFromBox: number;         // Summe der drei Stufen (jetzt noch bar auszuzahlen)
  netResult: number;           // stack - cashIn - creditIn (Plus/Minus des Abends)
  residual: number;            // claim - cashFromBox - creditIn (>0 Gläubiger, <0 Schuldner)
};

type Transfer = { fromPlayerId: string; toPlayerId: string; amount: number };
```

## Berechnung

### Schritt 0 – Grundgrößen

```
box       = Σ cashIn − Σ payout
claim_i   = stack_i − payout_i
isCash_i  = cashIn_i > 0
```

### Hilfsfunktion distribute(box, wants[]) → got[]

Verteilt `min(box, Σ wants)` proportional zu `wants` auf Integer-Cent, ohne Rundungsfehler:

1. Wenn `Σ wants ≤ box`: jeder bekommt genau `want_i`.
2. Sonst: `share_i = want_i · box / Σ wants` als exakte Bruchzahl (BigInt-Arithmetik oder
   Zähler/Nenner, keine Floats). `got_i = floor(share_i)`. Der Rest `box − Σ got_i` (immer
   kleiner als die Anzahl der Empfänger) wird in ganzen Cents an die Empfänger mit den größten
   Nachkommaanteilen vergeben (Largest-Remainder-Methode); bei gleichem Nachkommaanteil gewinnt
   der frühere in der Eingabereihenfolge.
3. Rückgabe `got[]`; der Aufrufer reduziert `box` um `Σ got`.

Invariante: `Σ got == min(box, Σ wants)` exakt.

### Stufe 1 – Bar-Einsatz zurück

Nur Spieler mit `isCash_i`:

```
want1_i = max(0, min(cashIn_i, stack_i) − payout_i)
```

`cashTier1 = distribute(box, want1)`, danach `box −= Σ cashTier1`.

Hinweis: Normalerweise reicht die Kasse hier immer. Sie reicht nur dann nicht, wenn ein
Listen-Spieler vorher Bargeld als `payout` entnommen hat. Dann wird anteilig gekürzt; der
Fehlbetrag landet automatisch als Schuld beim Verursacher (siehe TV6).

### Stufe 2 – Rest an Bar-Zahler, anteilig nach offenem Anspruch

Nur Spieler mit `isCash_i`:

```
want2_i = claim_i − cashTier1_i
```

`cashTier2 = distribute(box, want2)`, danach `box −= Σ cashTier2`.

### Stufe 3 – Rest an Listen-Spieler, anteilig

Nur Spieler mit `!isCash_i`:

```
want3_i = claim_i
```

`cashTier3 = distribute(box, want3)`, danach `box −= Σ cashTier3`.

`unallocatedCash = box` (nur > 0, wenn Stacks kleiner als Buy-ins sind, also Chips fehlen).

### Schritt 4 – Residuen

```
cashFromBox_i = cashTier1_i + cashTier2_i + cashTier3_i
residual_i    = claim_i − cashFromBox_i − creditIn_i
netResult_i   = stack_i − cashIn_i − creditIn_i
```

Bei `discrepancy == 0` gilt `Σ residual == 0`.

### Schritt 5 – Überweisungen (greedy, wenige Überweisungen)

Der Greedy erzeugt in der Praxis wenige Überweisungen, garantiert aber **nicht** das
theoretische Minimum (das wäre NP-schwer). Verbindlich ist genau dieser Ablauf, damit das
Ergebnis deterministisch und nachrechenbar bleibt.

```
creditors = [(i, residual_i)  | residual_i > 0]  sortiert nach Betrag absteigend, dann Eingabereihenfolge
debtors   = [(i, −residual_i) | residual_i < 0]  sortiert nach Betrag absteigend, dann Eingabereihenfolge

solange beide Listen nicht leer:
  d = erster debtor, c = erster creditor
  amount = min(d.rest, c.rest)
  transfer (d → c, amount)
  d.rest −= amount; c.rest −= amount
  entferne d bzw. c, wenn rest == 0 (bei Gleichstand beide)
```

Nach der Schleife: `uncoveredClaims = Σ verbleibende creditor.rest` (nur > 0 bei `discrepancy > 0`)
und `uncoveredDebts = Σ verbleibende debtor.rest` (nur > 0 bei `discrepancy < 0`). Beide werden
nicht als Überweisung ausgegeben, sondern separat gemeldet; die Anzeige (WP6) zeigt sie als
„Differenz: n € Anspruch ohne Deckung“ bzw. „Differenz: n € Schuld ohne Gläubiger“. Bei
`discrepancy < 0` gilt `unallocatedCash + uncoveredDebts == −discrepancy`; bei
`discrepancy > 0` gilt `uncoveredClaims == discrepancy`. Der Admin muss beim Abschluss ohnehin
kommentieren.

## Invarianten (Gaby prüft sie mit Property-Tests, z. B. fast-check)

1. Alle Ausgabebeträge sind Integer; alle außer `residual`, `netResult`, `discrepancy` sind ≥ 0.
2. `Σ cashFromBox + unallocatedCash == Σ cashIn − Σ payout`.
3. Bei `discrepancy == 0`: `Σ residual == 0`, `unallocatedCash == 0`, `uncoveredClaims == 0`,
   `Σ transfers.amount == Σ positive residual`.
4. Kein Spieler erhält aus der Kasse mehr als seinen `claim`.
5. Ein Bar-Zahler mit `stack ≥ cashIn` und `payout == 0` erhält mindestens `cashIn` bar,
   sofern kein Spieler mehr `payout` entnommen hat, als er selbst bar eingezahlt hat
   (`payout_j ≤ cashIn_j` für alle j). Dann gilt `box ≥ Σ want1`, und Stufe 1 wird voll bedient.
   Entnimmt jemand mehr (egal ob Bar- oder Listen-Spieler), wird Stufe 1 anteilig gekürzt und
   der Fehlbetrag landet als Überweisung von den Listen-Schuldnern an den gekürzten Bar-Zahler.
6. Solange ein Bar-Zahler einen offenen Anspruch hat, erhält kein Listen-Spieler Bargeld:
   `Σ cashTier3 > 0 ⇒ alle want2 vollständig bedient`.
7. Determinismus: gleiche Eingabe → identische Ausgabe. Permutation der Eingabe ändert nach
   Sortierung nichts.
8. Kein Transfer von einem Spieler an sich selbst; keine Transfers mit Betrag 0.
9. `Σ transfers.amount ≤ min(Σ positive residual, Σ |negative residual|)`.

## Manuelle Übersteuerung in der Vorschau (v1.1)

Der oben beschriebene Algorithmus ist der **Automatik-Pfad**. Die Testfälle TV1–TV12 und alle
Invarianten gelten unverändert für diesen Pfad und bleiben scharf (Server-Action `closeSession`,
`verifySettlement`, RPC `close_session` rechnen weiter dreifach nach).

Daneben gibt es einen bewusst gewählten **Manual-Pfad** (`docs/SPEC.md` §6.1): Ein Admin darf in
der Live-Vorschau einer offenen Session die „Aus der Kasse“-Beträge und die Überweisungen frei
setzen. Für diesen Pfad gilt:

- Es findet **keine** Reconciliation gegen `entries` statt und **keine** der algorithmischen
  Invarianten (Stufen 1–3, Deckung, „Bargeld zuerst“). Die Beträge werden unverändert
  eingefroren gespeichert und mit `settlements.is_manual = true` markiert.
- Serverseitig erzwungen bleibt nur die **Grundintegrität**: alle Beträge Integer-Cent,
  jeder Überweisungsbetrag > 0, keine Selbst-Überweisung, „Aus der Kasse“-Beträge ≥ 0, alle
  beteiligten Spieler sind reale Teilnehmer der Session, genau eine Zeile je Teilnehmer.
- Eine so gespeicherte Abrechnung ist **nicht** aus den Einträgen reproduzierbar. Sie wird aus
  der Datenbank angezeigt, nie neu berechnet.

TV1–TV12 sind **nicht** auf den Manual-Pfad anzuwenden; sie definieren allein die Automatik.

## Testfälle (Pflicht – Beträge in Euro, im Test in Cent)

### TV1 – Reine Bar-Runde (Beispiel des Auftraggebers)

| Spieler | cashIn | creditIn | stack | payout |
|---|---|---|---|---|
| A | 100 | 0 | 250 | 0 |
| B | 100 | 0 | 150 | 0 |
| C | 100 | 0 | 100 | 0 |
| D | 100 | 0 | 0 | 0 |
| E | 100 | 0 | 0 | 0 |

Erwartung: Stufe 1: A 100, B 100, C 100, D 0, E 0 (box 200). Stufe 2: A 150, B 50 (box 0).
cashFromBox: A 250, B 150, C 100, D 0, E 0. Alle Residuen 0. Keine Transfers. discrepancy 0.

### TV2 – Bar-Zahler zuerst vor Listen-Gewinner (Frage 5 → A)

| Spieler | cashIn | creditIn | stack | payout |
|---|---|---|---|---|
| Ali | 100 | 0 | 200 | 0 |
| Ben | 100 | 0 | 40 | 0 |
| Can | 0 | 100 | 60 | 0 |

Erwartung: Stufe 1: Ali 100, Ben 40 (box 60). Stufe 2: Ali 60 (box 0). Stufe 3: Can 0.
Residuen: Ali +40, Ben 0, Can −40. Transfers: Can → Ali 40.

### TV3 – Gemischt mit zwei Listen-Spielern

| Spieler | cashIn | creditIn | stack | payout |
|---|---|---|---|---|
| Ali | 100 | 0 | 250 | 0 |
| Ben | 100 | 0 | 50 | 0 |
| Can | 0 | 100 | 0 | 0 |
| Dai | 0 | 200 | 200 | 0 |

Erwartung: Stufe 1: Ali 100, Ben 50 (box 50). Stufe 2: Ali 50 (box 0). Stufe 3: Dai 0.
Residuen: Ali +100, Ben 0, Can −100, Dai 0. Transfers: Can → Ali 100.

### TV4 – Zwei Bar-Zahler, einer plus, einer minus, Rest auf Liste (Kernregel)

| Spieler | cashIn | creditIn | stack | payout |
|---|---|---|---|---|
| A | 100 | 0 | 300 | 0 |
| B | 100 | 0 | 0 | 0 |
| C | 0 | 100 | 50 | 0 |
| D | 0 | 100 | 50 | 0 |

Erwartung: Stufe 1: A 100, B 0 (box 100). Stufe 2: A 100 (box 0). Stufe 3: C 0, D 0.
A bekommt die **komplette Kasse** (200). Residuen: A +100, B 0, C −50, D −50.
Transfers: C → A 50, D → A 50.

### TV5 – Frühgeher (Bar-Zahler) nimmt seinen Anspruch bar mit

| Spieler | cashIn | creditIn | stack | payout |
|---|---|---|---|---|
| A | 100 | 0 | 150 | 150 |
| B | 100 | 0 | 50 | 0 |
| C | 0 | 100 | 100 | 0 |

box = 200 − 150 = 50. claims: A 0, B 50, C 100.
Stufe 1: A 0, B 50 (box 0). Stufe 2 und 3: nichts. Residuen: A 0, B 0, C 0. Keine Transfers.

### TV6 – Listen-Spieler hat Bargeld entnommen (Kasse reicht in Stufe 1 nicht)

| Spieler | cashIn | creditIn | stack | payout |
|---|---|---|---|---|
| A | 100 | 0 | 100 | 0 |
| B | 0 | 100 | 100 | 100 |

box = 0. claims: A 100, B 0. Stufe 1: A want 100, bekommt 0.
Residuen: A +100, B −100. Transfers: B → A 100.

### TV7 – Ein Spieler kauft bar UND auf Liste

| Spieler | cashIn | creditIn | stack | payout |
|---|---|---|---|---|
| A | 100 | 100 | 400 | 0 |
| B | 100 | 0 | 0 | 0 |
| C | 0 | 100 | 0 | 0 |

box 200. Stufe 1: A 100, B 0 (box 100). Stufe 2: A want 300, bekommt 100 (box 0).
Residuen: A 400 − 200 − 100 = +100, B 0, C −100. Transfers: C → A 100.

### TV8 – Rundung auf Cent (Largest Remainder)

| Spieler | cashIn | creditIn | stack | payout |
|---|---|---|---|---|
| A | 100 | 0 | 200 | 0 |
| B | 100 | 0 | 200 | 0 |
| C | 100 | 0 | 200 | 0 |
| D | 100 | 0 | 0 | 0 |
| E | 100 | 0 | 0 | 0 |
| F | 0 | 100 | 0 | 0 |

box 500. Stufe 1: A, B, C je 100 (box 200). Stufe 2: wants je 100, Summe 300 > 200 →
exakt 66,666… → floor 66,66 je; Rest 0,02 → A und B bekommen je +0,01.
cashTier2: A 66,67, B 66,67, C 66,66. Residuen: A +33,33, B +33,33, C +33,34, F −100.
Transfers (greedy, größter Gläubiger zuerst): F → C 33,34, F → A 33,33, F → B 33,33.
Summe Transfers 100,00 exakt.

### TV9 – Differenz: Chips fehlen (Stacks < Buy-ins)

| Spieler | cashIn | creditIn | stack | payout |
|---|---|---|---|---|
| A | 100 | 0 | 90 | 0 |
| B | 100 | 0 | 100 | 0 |

discrepancy = −10. Stufe 1: A 90, B 100 (box 10). Stufe 2: keine wants. unallocatedCash = 10.
Residuen 0. Keine Transfers. uncoveredDebts = 0. (Abschluss nur durch Admin mit Kommentar.)

### TV9b – Differenz: Chips fehlen, nur Listen-Spieler

| Spieler | cashIn | creditIn | stack | payout |
|---|---|---|---|---|
| A | 0 | 100 | 0 | 0 |
| B | 0 | 100 | 100 | 0 |

discrepancy = −100. box 0. Residuen: A −100, B 0. Keine Transfers. unallocatedCash = 0,
uncoveredDebts = 100 (A schuldet 100, aber niemand hat Anspruch: die Chips fehlen).

### TV10 – Differenz: zu viel gezählt (Stacks > Buy-ins)

| Spieler | cashIn | creditIn | stack | payout |
|---|---|---|---|---|
| A | 100 | 0 | 120 | 0 |
| B | 0 | 100 | 90 | 0 |

discrepancy = +10. box 100. Stufe 1: A 100 (box 0). Residuen: A +20, B −10.
Transfers: B → A 10. uncoveredClaims = 10.

### TV11 – Randfälle

- Keine Teilnehmer → Fehler `NO_PARTICIPANTS`.
- Ein Spieler, cash 100, stack 100 → cashFromBox 100, keine Transfers.
- Alle Beträge 0 → alles 0, keine Transfers, kein Fehler.

### TV12 – Vorbedingungen verletzt (jeweils Fehler mit Code)

- `payout > stack` → `PAYOUT_EXCEEDS_STACK`
- `Σ payout > Σ cashIn` → `PAYOUT_EXCEEDS_CASHBOX`
- Negativer Betrag → `NEGATIVE_AMOUNT`
- Nicht-ganzzahliger Betrag → `NON_INTEGER_AMOUNT`
- Doppelte `playerId` → `DUPLICATE_PLAYER`
- Fehlende, nicht-ganzzahlige oder doppelte `position` → `INVALID_POSITION` (`position` ist Pflicht; sie ist die Beitrittsreihenfolge aus `session_players`)
