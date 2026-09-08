# Abrechnung (`src/lib/settlement`)

Reine Bibliothek ohne Supabase, React oder I/O. Spezifikation: `docs/SETTLEMENT.md`
(Version 1) – bei jeder Abweichung gilt das Dokument, nicht der Code.

```ts
import { computeSettlement, describeTransfer, SettlementError } from '@/lib/settlement';

const result = computeSettlement([
  { playerId: 'a', name: 'Ali', position: 0, cashIn: 10000, creditIn: 0, stack: 20000, payout: 0 },
  { playerId: 'b', name: 'Ben', position: 1, cashIn: 10000, creditIn: 0, stack: 4000, payout: 0 },
  { playerId: 'c', name: 'Can', position: 2, cashIn: 0, creditIn: 10000, stack: 6000, payout: 0 },
]);

result.lines[0].cashFromBox; // 16000 – jetzt bar auszuzahlen
result.transfers.map((t) => describeTransfer(t, { a: 'Ali', c: 'Can' }));
// ["Can schuldet Ali 40,00 €"]
```

Alle Beträge sind Integer-Cent. Die Teilnehmer werden nach `position`, dann `name`, dann
`playerId` sortiert (fehlt `position`, gilt die Array-Reihenfolge). Verletzte Vorbedingungen
werfen `SettlementError` mit `code` (`NO_PARTICIPANTS`, `PAYOUT_EXCEEDS_STACK`,
`PAYOUT_EXCEEDS_CASHBOX`, `NEGATIVE_AMOUNT`, `NON_INTEGER_AMOUNT`, `DUPLICATE_PLAYER`) und
optional `playerId`; der Aufrufer übersetzt den Code in eine deutsche Meldung. Das Ergebnis
ist deterministisch und wird beim Abschluss einer Session eingefroren gespeichert.
