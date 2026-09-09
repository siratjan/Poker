import type { Json } from '@/lib/database.types';
import { ROLE_LABELS, isRole } from '@/lib/auth/roles';
import { formatCents, formatSignedCents } from '@/lib/money';
import { formatPlayedOn } from '@/lib/time';

/**
 * Turns one row of `audit_log` into a German sentence
 * (docs/ARBEITSPAKETE.md WP8, step 3).
 *
 * Two rules govern everything here:
 *
 * 1. **Never throw.** The log is the last place that may break: it is the only
 *    view of rows that no longer exist, and it is read exactly when something
 *    went wrong. Every value out of `old_data` / `new_data` is treated as
 *    untyped JSON — a missing field, a string where a number belongs, a table
 *    this version does not know: all of them fall back to a generic sentence.
 * 2. **Deleted rows are described from `old_data`**, so „hat Buy-in 100,00 €
 *    bar für Ali gelöscht“ still names the amount that disappeared (WP8 DoD).
 *
 * The description is the predicate of a sentence whose subject is the acting
 * user, rendered next to it by the log list: „Sirat · hat … eingetragen“.
 */

/** One row of `audit_log`, as the query layer hands it over. */
export type AuditEntry = {
  id: number;
  /** `timestamptz` as ISO string. */
  at: string;
  userId: string | null;
  userEmail: string | null;
  /** Display name of the acting user, if it could be resolved. */
  userName: string | null;
  tableName: string;
  rowId: string;
  /** `INSERT` | `UPDATE` | `DELETE` — anything else is handled generically. */
  action: string;
  oldData: Json | null;
  newData: Json | null;
  sessionId: string | null;
};

/** Lookups the descriptions use to replace ids with names. */
export type AuditNames = {
  /** `playerId` -> player name. */
  players: Readonly<Record<string, string>>;
  /** `sessionId` -> date label, e.g. „Fr, 12.09.2026“. */
  sessions: Readonly<Record<string, string>>;
};

export const EMPTY_AUDIT_NAMES: AuditNames = { players: {}, sessions: {} };

/** German labels for the table filter of the log view. */
export const AUDIT_TABLE_LABELS: Readonly<Record<string, string>> = {
  sessions: 'Sessions',
  session_players: 'Teilnehmer',
  entries: 'Einträge',
  players: 'Spieler',
  app_users: 'Nutzer',
  settings: 'Einstellungen',
  settlements: 'Abrechnungen',
};

/** The tables that carry an audit trigger (0002), in reading order. */
export const AUDITED_TABLES: readonly string[] = [
  'sessions',
  'session_players',
  'entries',
  'players',
  'app_users',
  'settings',
  'settlements',
];

export function auditTableLabel(tableName: string): string {
  return AUDIT_TABLE_LABELS[tableName] ?? tableName;
}

/** Short label for the action badge of a log row. */
export function auditActionLabel(action: string): string {
  switch (action) {
    case 'INSERT':
      return 'Neu';
    case 'UPDATE':
      return 'Geändert';
    case 'DELETE':
      return 'Gelöscht';
    default:
      return action;
  }
}

/**
 * Player and session ids an entry mentions, so the query layer can resolve the
 * names it needs with one `in (...)` per table instead of one query per row.
 */
export function referencedIds(entry: AuditEntry): { playerIds: string[]; sessionIds: string[] } {
  const data = payloadOf(entry);
  const playerIds = new Set<string>();
  const sessionIds = new Set<string>();

  const playerId = text(data, 'player_id');
  if (playerId !== null) playerIds.add(playerId);
  if (entry.tableName === 'players') {
    const id = text(data, 'id');
    if (id !== null) playerIds.add(id);
  }

  if (entry.sessionId !== null) sessionIds.add(entry.sessionId);

  return { playerIds: [...playerIds], sessionIds: [...sessionIds] };
}

/**
 * The German description of one log row. Falls back to a generic sentence for
 * anything it does not recognise, and never throws.
 */
export function describeAuditEntry(entry: AuditEntry, names: AuditNames = EMPTY_AUDIT_NAMES): string {
  try {
    return describe(entry, names);
  } catch {
    // A description is never worth an error page; the raw JSON stays visible
    // in the expandable part of the row.
    return generic(entry);
  }
}

function describe(entry: AuditEntry, names: AuditNames): string {
  switch (entry.tableName) {
    case 'entries':
      return describeEntryRow(entry, names);
    case 'sessions':
      return describeSession(entry, names);
    case 'session_players':
      return describeSessionPlayer(entry, names);
    case 'players':
      return describePlayer(entry);
    case 'app_users':
      return describeAppUser(entry);
    case 'settings':
      return describeSetting(entry);
    case 'settlements':
      return describeSettlement(entry, names);
    default:
      return generic(entry);
  }
}

// ---------------------------------------------------------------------------
// entries — the rows the table produces all evening
// ---------------------------------------------------------------------------

function describeEntryRow(entry: AuditEntry, names: AuditNames): string {
  const data = payloadOf(entry);
  const forPlayer = playerSuffix(text(data, 'player_id'), names);

  if (entry.action === 'UPDATE') {
    const before = amountOf(entry.oldData);
    const after = amountOf(entry.newData);
    const kind = entryKind(text(data, 'type'));
    if (before !== null && after !== null && before !== after) {
      return `hat ${kind}${forPlayer} von ${before} auf ${after} geändert`;
    }
    return `hat ${entryLabel(entry.newData ?? entry.oldData)}${forPlayer} geändert`;
  }

  const label = entryLabel(entry.action === 'DELETE' ? entry.oldData : entry.newData);
  if (entry.action === 'INSERT') return `hat ${label}${forPlayer} eingetragen`;
  if (entry.action === 'DELETE') return `hat ${label}${forPlayer} gelöscht`;
  return generic(entry);
}

/** „Buy-in 100,00 € bar“ / „Stack 250,00 €“ / „Bar-Auszahlung 50,00 €“. */
function entryLabel(data: Json | null): string {
  const record = objectOf(data);
  const kind = entryKind(text(record, 'type'));
  const amount = amountOf(data);
  const payment = paymentLabel(text(record, 'payment'));

  return [kind, amount, payment].filter((part) => part !== null).join(' ');
}

function entryKind(type: string | null): string {
  switch (type) {
    case 'buy_in':
      return 'Buy-in';
    case 'cash_out':
      return 'Stack';
    case 'payout':
      return 'Bar-Auszahlung';
    default:
      return 'Eintrag';
  }
}

function paymentLabel(payment: string | null): string | null {
  if (payment === 'cash') return 'bar';
  if (payment === 'credit') return 'auf Liste';
  return null;
}

function amountOf(data: Json | null): string | null {
  return money(integer(objectOf(data), 'amount_cents'));
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

function describeSession(entry: AuditEntry, names: AuditNames): string {
  const label = sessionLabel(entry, names);

  if (entry.action === 'INSERT') return `hat die Session ${label} angelegt`;
  if (entry.action === 'DELETE') return `hat die Session ${label} gelöscht`;
  if (entry.action !== 'UPDATE') return generic(entry);

  const before = objectOf(entry.oldData);
  const after = objectOf(entry.newData);
  const statusBefore = text(before, 'status');
  const statusAfter = text(after, 'status');

  if (statusBefore === 'open' && statusAfter === 'closed') {
    const discrepancy = integer(after, 'discrepancy_cents');
    const suffix =
      discrepancy !== null && discrepancy !== 0
        ? ` (Differenz ${formatSignedCents(discrepancy)})`
        : '';
    return `hat die Session ${label} abgeschlossen${suffix}`;
  }
  if (statusBefore === 'closed' && statusAfter === 'open') {
    return `hat die Session ${label} wieder geöffnet`;
  }

  const nameBefore = text(before, 'name');
  const nameAfter = text(after, 'name');
  if (nameBefore !== nameAfter) {
    return `hat die Session ${label} umbenannt: ${quoteOrDash(nameBefore)} → ${quoteOrDash(nameAfter)}`;
  }

  const dateBefore = text(before, 'played_on');
  const dateAfter = text(after, 'played_on');
  if (dateBefore !== dateAfter && dateAfter !== null) {
    return `hat das Datum der Session auf ${formatPlayedOn(dateAfter)} geändert`;
  }

  return `hat die Session ${label} geändert`;
}

/** „vom Fr, 12.09.2026“ — from the row itself, else from the session lookup. */
function sessionLabel(entry: AuditEntry, names: AuditNames): string {
  const data = payloadOf(entry);
  const playedOn = text(data, 'played_on');
  if (playedOn !== null) return `vom ${formatPlayedOn(playedOn)}`;

  const fromLookup = entry.sessionId === null ? undefined : names.sessions[entry.sessionId];
  return fromLookup === undefined ? '' : `vom ${fromLookup}`;
}

// ---------------------------------------------------------------------------
// session_players, players
// ---------------------------------------------------------------------------

function describeSessionPlayer(entry: AuditEntry, names: AuditNames): string {
  const player = playerName(text(payloadOf(entry), 'player_id'), names);

  switch (entry.action) {
    case 'INSERT':
      return `hat ${player} zur Session hinzugefügt`;
    case 'DELETE':
      return `hat ${player} aus der Session entfernt`;
    case 'UPDATE':
      return `hat die Teilnahme von ${player} geändert`;
    default:
      return generic(entry);
  }
}

function describePlayer(entry: AuditEntry): string {
  const before = text(objectOf(entry.oldData), 'name');
  const after = text(objectOf(entry.newData), 'name');

  switch (entry.action) {
    case 'INSERT':
      return `hat den Spieler ${quoteOrDash(after)} angelegt`;
    case 'DELETE':
      return `hat den Spieler ${quoteOrDash(before)} gelöscht`;
    case 'UPDATE':
      return before === after
        ? `hat den Spieler ${quoteOrDash(after)} geändert`
        : `hat den Spieler ${quoteOrDash(before)} in ${quoteOrDash(after)} umbenannt`;
    default:
      return generic(entry);
  }
}

// ---------------------------------------------------------------------------
// app_users, settings, settlements
// ---------------------------------------------------------------------------

function describeAppUser(entry: AuditEntry): string {
  const before = objectOf(entry.oldData);
  const after = objectOf(entry.newData);
  const email = text(after, 'email') ?? text(before, 'email') ?? 'einen Nutzer';

  switch (entry.action) {
    case 'INSERT':
      return `hat sich zum ersten Mal angemeldet (Rolle ${roleLabel(text(after, 'role'))})`;
    case 'DELETE':
      return `hat den Nutzer ${email} gelöscht`;
    case 'UPDATE':
      // The trigger only logs app_users updates when the role changed (0002).
      return `hat die Rolle von ${email} von ${roleLabel(text(before, 'role'))} auf ${roleLabel(
        text(after, 'role'),
      )} gesetzt`;
    default:
      return generic(entry);
  }
}

function roleLabel(role: string | null): string {
  return isRole(role) ? ROLE_LABELS[role] : 'unbekannt';
}

function describeSetting(entry: AuditEntry): string {
  const data = payloadOf(entry);
  const key = text(data, 'key') ?? entry.rowId;

  if (entry.action === 'DELETE') return `hat die Einstellung „${key}“ gelöscht`;
  // Like every other table: an action this version does not know gets the
  // generic sentence instead of a claim about what happened (Gaby WP8-F3).
  if (entry.action !== 'INSERT' && entry.action !== 'UPDATE') return generic(entry);

  if (key === 'quick_amounts_cents') {
    const amounts = centsList(valueOf(data));
    if (amounts !== null) return `hat die Schnellbeträge auf ${amounts} gesetzt`;
    return 'hat die Schnellbeträge geändert';
  }
  return `hat die Einstellung „${key}“ geändert`;
}

/** „50,00 € / 100,00 € / 200,00 €“, or `null` if the value is not a list of cents. */
function centsList(value: Json | null): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item)) return null;
    parts.push(formatCents(item));
  }
  return parts.join(' / ');
}

function describeSettlement(entry: AuditEntry, names: AuditNames): string {
  const label = sessionLabel(entry, names);
  const suffix = label === '' ? '' : ` der Session ${label}`;

  switch (entry.action) {
    case 'INSERT':
      return `hat die Abrechnung${suffix} gespeichert`;
    case 'DELETE':
      return `hat die gespeicherte Abrechnung${suffix} gelöscht`;
    case 'UPDATE':
      return `hat die Abrechnung${suffix} geändert`;
    default:
      return generic(entry);
  }
}

// ---------------------------------------------------------------------------
// Fallback and JSON helpers
// ---------------------------------------------------------------------------

/** The sentence for a table or action this version does not know. */
function generic(entry: AuditEntry): string {
  const what = `in „${auditTableLabel(entry.tableName)}“`;
  switch (entry.action) {
    case 'INSERT':
      return `hat einen Eintrag ${what} angelegt`;
    case 'UPDATE':
      return `hat einen Eintrag ${what} geändert`;
    case 'DELETE':
      return `hat einen Eintrag ${what} gelöscht`;
    default:
      return `hat einen Eintrag ${what} verändert`;
  }
}

/** A JSON object as it comes out of `old_data` / `new_data`. */
type JsonObject = { [key: string]: Json | undefined };

/** New values if there are any, otherwise the old ones (a delete). */
function payloadOf(entry: AuditEntry): JsonObject | null {
  return objectOf(entry.newData) ?? objectOf(entry.oldData);
}

function objectOf(value: Json | null): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value;
}

function valueOf(data: JsonObject | null): Json | null {
  return data === null ? null : (data.value ?? null);
}

function text(data: JsonObject | null, key: string): string | null {
  if (data === null) return null;
  const value = data[key];
  return typeof value === 'string' ? value : null;
}

function integer(data: JsonObject | null, key: string): number | null {
  if (data === null) return null;
  const value = data[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** Integer cents as „100,00 €“; anything else (float, missing) is dropped. */
function money(cents: number | null): string | null {
  return cents === null ? null : formatCents(cents);
}

function playerName(playerId: string | null, names: AuditNames): string {
  if (playerId === null) return 'einen Spieler';
  return names.players[playerId] ?? 'Unbekannt';
}

/** „ für Ali“, or nothing when the row has no player. */
function playerSuffix(playerId: string | null, names: AuditNames): string {
  return playerId === null ? '' : ` für ${playerName(playerId, names)}`;
}

function quoteOrDash(value: string | null): string {
  return value === null || value.trim() === '' ? '(ohne Namen)' : `„${value}“`;
}
