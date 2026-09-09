import type { PostgrestError } from '@supabase/supabase-js';
import { AppError } from '@/lib/actions/result';

/**
 * German messages for every error the database can raise
 * (docs/ARBEITSPAKETE.md WP5, step 1).
 *
 * The triggers and RPCs of `supabase/migrations/0002_functions_triggers.sql`
 * raise their errors as `raise exception '<CODE>' using errcode = 'P0001'`, so
 * the code arrives as the message of the `PostgrestError`. This module is the
 * single place that turns such a code into a sentence a person can read — a raw
 * Postgres text must never reach the browser (CLAUDE.md).
 *
 * Every code that appears in 0002 has an entry here; `de.test.ts` reads the
 * migration and fails if a new one is added without a translation.
 */

export const DB_ERROR_MESSAGES = {
  // --- app_users / roles -----------------------------------------------------
  LAST_ADMIN:
    'Der letzte Admin kann sich nicht selbst herabstufen. Mach zuerst jemand anderen zum Admin.',
  FORBIDDEN: 'Dafür fehlen dir die Rechte.',
  ONLY_ROLE_EDITABLE: 'An diesem Nutzer lässt sich nur die Rolle ändern.',

  // --- sessions --------------------------------------------------------------
  SESSION_NOT_FOUND: 'Diese Session gibt es nicht (mehr).',
  SESSION_CLOSED: 'Diese Session ist abgeschlossen und kann nicht mehr geändert werden.',
  SESSION_NOT_CLOSED: 'Diese Session ist gar nicht abgeschlossen.',
  USE_RPC: 'Der Status einer Session lässt sich nur über Abschließen bzw. Wieder öffnen ändern.',
  IMMUTABLE_FIELD: 'Dieses Feld einer Session lässt sich nicht ändern.',

  // --- participants ----------------------------------------------------------
  PLAYER_HAS_ENTRIES:
    'Dieser Spieler hat schon Einträge. Lösche zuerst seine Einträge, dann kannst du ihn entfernen.',
  NO_PARTICIPANTS: 'Diese Session hat noch keine Teilnehmer.',

  // --- entries ---------------------------------------------------------------
  ENTRY_IMMUTABLE_KEYS:
    'Ein Eintrag kann nicht auf einen anderen Spieler oder eine andere Session umgehängt werden.',
  PLAYER_ALREADY_CASHED_OUT:
    'Dieser Spieler ist schon ausgestiegen. Lösche zuerst seinen Stack, wenn er weiterspielt.',
  CASH_OUT_HAS_PAYOUT:
    'Der Stack lässt sich nicht löschen, solange es eine Bar-Auszahlung für diesen Spieler gibt. Lösche zuerst die Auszahlung.',
  STACK_BELOW_PAYOUT:
    'Der Stack ist kleiner als das, was dieser Spieler schon bar bekommen hat.',
  PAYOUT_REQUIRES_CASH_OUT:
    'Für eine Bar-Auszahlung braucht der Spieler zuerst einen Stack (aussteigen).',
  PAYOUT_EXCEEDS_STACK: 'Die Auszahlung ist größer als der Stack dieses Spielers.',
  PAYOUT_EXCEEDS_CASHBOX: 'So viel Bargeld ist nicht in der Kasse.',

  // --- close / reopen (WP6 uses these, the table stays complete) --------------
  MISSING_CASH_OUT: 'Es haben noch nicht alle Teilnehmer einen Stack eingetragen.',
  DISCREPANCY_REQUIRES_ADMIN_NOTE:
    'Mit Differenz kann nur ein Admin abschließen, und nur mit einem Kommentar.',
  SETTLEMENT_MISMATCH: 'Die Daten haben sich geändert. Bitte noch einmal prüfen.',
  SETTLEMENT_INVARIANT:
    'Die Abrechnung ist nicht stimmig und wurde nicht gespeichert. Bitte melde das.',
  REASON_REQUIRED: 'Bitte gib einen Grund an (mindestens 3 Zeichen).',
} as const satisfies Record<string, string>;

export type DbErrorCode = keyof typeof DB_ERROR_MESSAGES;

/** All codes, for tests and for the completeness check against 0002. */
export const DB_ERROR_CODES = Object.keys(DB_ERROR_MESSAGES) as DbErrorCode[];

export function isDbErrorCode(value: string): value is DbErrorCode {
  return Object.hasOwn(DB_ERROR_MESSAGES, value);
}

/** German message for a known trigger code. */
export function messageForDbErrorCode(code: DbErrorCode): string {
  return DB_ERROR_MESSAGES[code];
}

/**
 * SQLSTATEs that can reach us without a trigger message: the RLS policies of
 * 0003 answer with `42501`, foreign keys and unique indexes with `23xxx`.
 */
const SQLSTATE_MESSAGES: Record<string, { code: string; message: string }> = {
  '42501': {
    code: 'FORBIDDEN',
    message: 'Dafür fehlen dir die Rechte.',
  },
  '23505': {
    code: 'DUPLICATE',
    message: 'Diesen Eintrag gibt es schon.',
  },
  '23503': {
    code: 'REFERENCE_MISSING',
    message: 'Der zugehörige Datensatz existiert nicht (mehr).',
  },
  '23514': {
    code: 'CHECK_VIOLATION',
    message: 'Dieser Wert ist nicht erlaubt.',
  },
};

/**
 * Translates a Postgres error into an {@link AppError}, or returns `null` if
 * the error is unknown — the caller then logs it and answers generically, so
 * SQL text never leaks (see `actionResult`).
 */
export function translateDbError(error: PostgrestError): AppError | null {
  const code = extractCode(error.message);
  if (code !== null) return new AppError(code, DB_ERROR_MESSAGES[code]);

  const bySqlState = SQLSTATE_MESSAGES[error.code];
  if (bySqlState !== undefined) return new AppError(bySqlState.code, bySqlState.message);

  return null;
}

/**
 * Finds the trigger code in a Postgres message. Usually the message *is* the
 * code; PostgREST sometimes wraps it, so a code standing on its own as a word
 * counts too.
 */
function extractCode(message: string): DbErrorCode | null {
  const trimmed = message.trim();
  if (isDbErrorCode(trimmed)) return trimmed;

  for (const candidate of DB_ERROR_CODES) {
    if (new RegExp(`(^|[^A-Z_])${candidate}([^A-Z_]|$)`).test(trimmed)) return candidate;
  }
  return null;
}
