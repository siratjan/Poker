'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Live updates of one session (docs/ARBEITSPAKETE.md WP5, step 4).
 *
 * Subscribes to `entries`, `session_players` and `sessions` filtered by the
 * session id and calls `onChange` for every event; the caller reloads the
 * server data (`router.refresh()`). This is a *read-only* channel: writes go
 * through server actions only, and `channel()` never selects, inserts or
 * updates a table (CLAUDE.md; Gaby's snapshot test pins that every table access
 * in `src/` lives in a server file).
 *
 * Guarantees Gaby reviews for:
 * - exactly one subscription per session id, also across re-renders (the effect
 *   depends on the id alone; `onChange` is kept in a ref),
 * - the channel is removed on unmount and whenever the id changes,
 * - one automatic reconnect after a `CHANNEL_ERROR` / `TIMED_OUT`,
 * - status `disconnected` if the channel is not live again after 10 seconds.
 */

export type RealtimeStatus = 'connecting' | 'live' | 'disconnected';

/** How long a broken channel may stay silent before the UI says so. */
const DISCONNECT_HINT_MS = 10_000;

export function useSessionRealtime(sessionId: string, onChange: () => void): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  // Keeping the callback in a ref means a new function identity on every render
  // never tears the subscription down and builds it up again. The ref is
  // written in an effect, not during render.
  const latestOnChange = useRef(onChange);
  useEffect(() => {
    latestOnChange.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const supabase = createClient();
    return subscribeToSession(supabase, sessionId, {
      onEvent: () => latestOnChange.current(),
      setStatus,
    });
  }, [sessionId]);

  return status;
}

/**
 * Minimal shape of the realtime part of the Supabase client. Structural on
 * purpose: `subscribeToSession` is the part with the reconnect logic, and a
 * plain object is enough to unit-test it (`useSessionRealtime.test.ts`).
 */
export type ChannelLike<C> = {
  on: (
    type: 'postgres_changes',
    filter: { event: '*'; schema: string; table: string; filter: string },
    callback: () => void,
  ) => C;
  subscribe: (callback: (status: string) => void) => unknown;
};

export type RealtimeClientLike<C> = {
  channel: (name: string) => C;
  removeChannel: (channel: C) => unknown;
};

/** The three tables one session listens to, each filtered to that session. */
function watchedTables(sessionId: string): { table: string; filter: string }[] {
  return [
    { table: 'entries', filter: `session_id=eq.${sessionId}` },
    { table: 'session_players', filter: `session_id=eq.${sessionId}` },
    { table: 'sessions', filter: `id=eq.${sessionId}` },
  ];
}

/**
 * Opens the channel and returns the teardown. Exported for the unit test.
 *
 * Reconnect (Gaby WP5-F1): calling `subscribe()` a second time on the same
 * channel does nothing in `@supabase/realtime-js` 2.116 — it only re-joins from
 * state `closed`, and after an error the channel is `errored`. So the retry
 * removes the broken channel and builds a fresh one, again with the status
 * callback, so the UI goes back to `live` on success. Exactly one attempt; if
 * it fails too, the hint timer shows „Verbindung getrennt“ with a reload button.
 */
export function subscribeToSession<C extends ChannelLike<C>>(
  supabase: RealtimeClientLike<C>,
  sessionId: string,
  handlers: { onEvent: () => void; setStatus: (status: RealtimeStatus) => void },
  hintMs: number = DISCONNECT_HINT_MS,
): () => void {
  const { onEvent, setStatus } = handlers;

  let cancelled = false;
  let retried = false;
  let active: C | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;

  function armDisconnectHint() {
    if (hintTimer !== null) return;
    hintTimer = setTimeout(() => {
      if (!cancelled) setStatus('disconnected');
    }, hintMs);
  }

  function clearDisconnectHint() {
    if (hintTimer === null) return;
    clearTimeout(hintTimer);
    hintTimer = null;
  }

  /** Hands out the open channel and forgets it, so it is removed only once. */
  function takeActiveChannel(): C | null {
    const open = active;
    active = null;
    return open;
  }

  function connect() {
    const next = supabase.channel(`session:${sessionId}`);
    for (const { table, filter } of watchedTables(sessionId)) {
      next.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => {
        if (!cancelled) onEvent();
      });
    }
    active = next;
    next.subscribe(handleStatus);
  }

  function handleStatus(channelStatus: string) {
    if (cancelled) return;

    if (channelStatus === 'SUBSCRIBED') {
      clearDisconnectHint();
      setStatus('live');
      return;
    }

    if (channelStatus !== 'CHANNEL_ERROR' && channelStatus !== 'TIMED_OUT') return;

    setStatus('connecting');
    armDisconnectHint();
    if (retried) return;
    retried = true;

    const broken = takeActiveChannel();
    if (broken !== null) {
      try {
        void supabase.removeChannel(broken);
      } catch (error) {
        console.error('[realtime] removing the broken channel failed:', error);
      }
    }
    try {
      connect();
    } catch (error) {
      console.error('[realtime] reconnect failed:', error);
    }
  }

  connect();

  return () => {
    cancelled = true;
    clearDisconnectHint();
    const channel = takeActiveChannel();
    if (channel !== null) void supabase.removeChannel(channel);
  };
}
