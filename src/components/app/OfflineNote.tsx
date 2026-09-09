'use client';

import { useWritesBlocked } from '@/components/app/ConnectionProvider';

/**
 * One sentence under a disabled action button (docs/ARBEITSPAKETE.md WP9,
 * step 2): a grey button without a reason is a bug report waiting to happen.
 *
 * Renders nothing while the device is online, so it can sit unconditionally in
 * every sheet and panel that writes.
 */
export function OfflineNote({ children }: { children?: string }) {
  const blocked = useWritesBlocked();
  if (!blocked) return null;

  return (
    <p role="status" className="px-1 text-xs opacity-80">
      {children ?? 'Ohne Verbindung lässt sich nichts speichern. Sobald das Netz zurück ist, geht es weiter.'}
    </p>
  );
}
