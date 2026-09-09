/**
 * What the app tells the user about its connection (docs/ARBEITSPAKETE.md WP9,
 * step 2).
 *
 * Two independent signals feed into one banner:
 *
 * - `online`: `navigator.onLine`. False means the device says it has no
 *   network at all. Every write would fail, so writes are blocked and the
 *   buttons go grey — a buy-in that silently disappears is worse than a
 *   disabled button.
 * - `realtime`: the status of the session channel (`useSessionRealtime`).
 *   `disconnected` means the device is online but the live channel is not
 *   delivering. Writes still work; only the automatic update is missing, so
 *   the banner offers a reload instead of blocking anything.
 *
 * There is deliberately no offline cache: an amount from an earlier visit could
 * be wrong by the time it is read (SPEC — Geld darf nicht veralten). Offline the
 * app therefore says so instead of showing stale numbers.
 *
 * Pure function, so the wording and the precedence are unit tested rather than
 * clicked through.
 */

export type RealtimeStatus = 'connecting' | 'live' | 'disconnected';

export type ConnectionBanner = {
  /** `offline` = red, nothing works; `stale` = amber, only live updates are gone. */
  tone: 'offline' | 'stale';
  title: string;
  description: string;
  /** Whether the banner offers a „Neu laden“ button. */
  canReload: boolean;
};

export type ConnectionState = {
  /** Writes are pointless right now and are disabled in the UI. */
  writesBlocked: boolean;
  banner: ConnectionBanner | null;
};

export function deriveConnection(input: {
  online: boolean;
  /** `null` on screens without a realtime channel (everything but a session). */
  realtime: RealtimeStatus | null;
}): ConnectionState {
  // Being offline outranks everything: a dead channel is a symptom then, not a
  // second problem, and two banners on one screen help nobody.
  if (!input.online) {
    return {
      writesBlocked: true,
      banner: {
        tone: 'offline',
        title: 'Keine Verbindung',
        description: 'Änderungen sind gerade nicht möglich. Sie werden nicht zwischengespeichert.',
        canReload: false,
      },
    };
  }

  if (input.realtime === 'disconnected') {
    return {
      writesBlocked: false,
      banner: {
        tone: 'stale',
        title: 'Verbindung getrennt',
        description: 'Neue Einträge kommen gerade nicht automatisch an.',
        canReload: true,
      },
    };
  }

  return { writesBlocked: false, banner: null };
}
