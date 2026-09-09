'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  deriveConnection,
  type ConnectionState,
  type RealtimeStatus,
} from '@/lib/connection/state';

/**
 * Connection state for the whole app shell (docs/ARBEITSPAKETE.md WP9, step 2).
 *
 * Holds two things: what `navigator.onLine` says, and the status the session
 * screen reports for its realtime channel. `deriveConnection` (unit tested)
 * turns both into the banner and into `writesBlocked`, which every action
 * button reads through {@link useWritesBlocked}.
 *
 * Server rendering has no `navigator`, so the first render is optimistic
 * („online“) and the effect corrects it. That order matters: rendering
 * „Keine Verbindung“ on the server and removing it on hydration would flash the
 * banner on every single page load.
 */

type ConnectionContextValue = ConnectionState & {
  online: boolean;
  realtime: RealtimeStatus | null;
  setRealtimeStatus: (status: RealtimeStatus | null) => void;
};

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [realtime, setRealtime] = useState<RealtimeStatus | null>(null);

  useEffect(() => {
    function sync() {
      setOnline(navigator.onLine);
    }

    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  const setRealtimeStatus = useCallback((status: RealtimeStatus | null) => {
    setRealtime((current) => (current === status ? current : status));
  }, []);

  const value = useMemo<ConnectionContextValue>(
    () => ({ ...deriveConnection({ online, realtime }), online, realtime, setRealtimeStatus }),
    [online, realtime, setRealtimeStatus],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

/**
 * The full state. Outside the provider (a component rendered on its own in a
 * test) it reports „everything fine“ rather than throwing — a missing banner is
 * never worth a crashed screen.
 */
export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (value !== null) return value;
  return {
    writesBlocked: false,
    banner: null,
    online: true,
    realtime: null,
    setRealtimeStatus: () => {},
  };
}

/** `true` while a write would fail anyway — action buttons disable themselves. */
export function useWritesBlocked(): boolean {
  return useConnection().writesBlocked;
}

/**
 * Reports the realtime status of the current session screen into the shell, so
 * the one banner in the header covers both signals instead of every screen
 * growing its own notice. Clears the status again when the screen unmounts.
 */
export function useReportRealtimeStatus(status: RealtimeStatus): void {
  const { setRealtimeStatus } = useConnection();

  useEffect(() => {
    setRealtimeStatus(status);
    return () => setRealtimeStatus(null);
  }, [status, setRealtimeStatus]);
}
