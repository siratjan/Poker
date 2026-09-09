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
 * - one automatic re-subscribe after a `CHANNEL_ERROR` / `TIMED_OUT`,
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
    const channel = supabase.channel(`session:${sessionId}`);

    let cancelled = false;
    let retried = false;
    let hintTimer: ReturnType<typeof setTimeout> | null = null;

    function armDisconnectHint() {
      if (hintTimer !== null) return;
      hintTimer = setTimeout(() => {
        if (!cancelled) setStatus('disconnected');
      }, DISCONNECT_HINT_MS);
    }

    function clearDisconnectHint() {
      if (hintTimer === null) return;
      clearTimeout(hintTimer);
      hintTimer = null;
    }

    const tables: { table: string; filter: string }[] = [
      { table: 'entries', filter: `session_id=eq.${sessionId}` },
      { table: 'session_players', filter: `session_id=eq.${sessionId}` },
      { table: 'sessions', filter: `id=eq.${sessionId}` },
    ];

    for (const { table, filter } of tables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, () => {
        if (!cancelled) latestOnChange.current();
      });
    }

    channel.subscribe((channelStatus) => {
      if (cancelled) return;

      if (channelStatus === 'SUBSCRIBED') {
        clearDisconnectHint();
        setStatus('live');
        return;
      }

      if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
        setStatus('connecting');
        armDisconnectHint();
        if (!retried) {
          retried = true;
          // One reconnect attempt; if it fails too, the hint timer takes over
          // and the user gets „Verbindung getrennt“ with a reload button.
          try {
            channel.subscribe();
          } catch (error) {
            console.error('[realtime] resubscribe failed:', error);
          }
        }
      }
    });

    return () => {
      cancelled = true;
      clearDisconnectHint();
      void supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return status;
}
