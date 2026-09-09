import { describe, expect, it } from 'vitest';
import { deriveConnection, type RealtimeStatus } from '@/lib/connection/state';

describe('deriveConnection', () => {
  it('says nothing while everything works', () => {
    expect(deriveConnection({ online: true, realtime: 'live' })).toEqual({
      writesBlocked: false,
      banner: null,
    });
  });

  it('says nothing on a screen without a realtime channel', () => {
    expect(deriveConnection({ online: true, realtime: null })).toEqual({
      writesBlocked: false,
      banner: null,
    });
  });

  it('stays quiet while the channel is still connecting', () => {
    // A short „connecting“ happens on every mount; a banner there would blink
    // on every navigation. Only the 10-second timeout of useSessionRealtime
    // turns it into `disconnected`.
    expect(deriveConnection({ online: true, realtime: 'connecting' }).banner).toBeNull();
  });

  it('blocks writes and names the reason when the device is offline', () => {
    const state = deriveConnection({ online: false, realtime: 'live' });

    expect(state.writesBlocked).toBe(true);
    expect(state.banner).not.toBeNull();
    expect(state.banner?.tone).toBe('offline');
    expect(state.banner?.title).toBe('Keine Verbindung');
    // No reload button: reloading without a network only produces an error page.
    expect(state.banner?.canReload).toBe(false);
  });

  it.each<RealtimeStatus | null>(['connecting', 'live', 'disconnected', null])(
    'offline outranks realtime status %s',
    (realtime) => {
      const state = deriveConnection({ online: false, realtime });
      expect(state.writesBlocked).toBe(true);
      expect(state.banner?.tone).toBe('offline');
    },
  );

  it('offers a reload when only the live channel is gone', () => {
    const state = deriveConnection({ online: true, realtime: 'disconnected' });

    expect(state.banner?.tone).toBe('stale');
    expect(state.banner?.title).toBe('Verbindung getrennt');
    expect(state.banner?.canReload).toBe(true);
    // Writes reach the server over plain HTTP and keep working.
    expect(state.writesBlocked).toBe(false);
  });

  it('never blocks writes while the device is online', () => {
    const statuses: (RealtimeStatus | null)[] = ['connecting', 'live', 'disconnected', null];
    for (const realtime of statuses) {
      expect(deriveConnection({ online: true, realtime }).writesBlocked).toBe(false);
    }
  });
});
