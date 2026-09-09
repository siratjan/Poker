import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  subscribeToSession,
  type ChannelLike,
  type RealtimeStatus,
  type RealtimeClientLike,
} from '@/components/sessions/useSessionRealtime';

/**
 * Channel lifecycle of the session realtime hook (Gaby WP5-F1).
 *
 * `subscribeToSession` is the part without React, so a fake channel is enough:
 * no DOM, no Supabase. What is pinned here is the reconnect that the review
 * found broken — after `CHANNEL_ERROR` the old channel is removed and a *new*
 * one is opened *with* the status callback, exactly once.
 */

type Subscription = { table: string; filter: string; callback: () => void };

/** A channel that records what was subscribed and can be driven by hand. */
class FakeChannel implements ChannelLike<FakeChannel> {
  readonly subscriptions: Subscription[] = [];
  /** The status callback passed to `subscribe()`. */
  statusCallback: ((status: string) => void) | null = null;
  subscribeCalls = 0;

  on(
    _type: 'postgres_changes',
    filter: { event: '*'; schema: string; table: string; filter: string },
    callback: () => void,
  ): FakeChannel {
    this.subscriptions.push({ table: filter.table, filter: filter.filter, callback });
    return this;
  }

  subscribe(callback: (status: string) => void): FakeChannel {
    this.subscribeCalls += 1;
    this.statusCallback = callback;
    return this;
  }

  /** Pretend the server answered with this channel status. */
  emit(status: string): void {
    this.statusCallback?.(status);
  }

  /** Pretend a row of `table` changed. */
  emitChange(table: string): void {
    for (const subscription of this.subscriptions) {
      if (subscription.table === table) subscription.callback();
    }
  }
}

class FakeClient implements RealtimeClientLike<FakeChannel> {
  readonly channels: FakeChannel[] = [];
  readonly names: string[] = [];
  readonly removedChannels: FakeChannel[] = [];

  channel(name: string): FakeChannel {
    this.names.push(name);
    const channel = new FakeChannel();
    this.channels.push(channel);
    return channel;
  }

  removeChannel(channel: FakeChannel): void {
    this.removedChannels.push(channel);
  }

  wasRemoved(channel: FakeChannel): boolean {
    return this.removedChannels.includes(channel);
  }
}

function setup() {
  const client = new FakeClient();
  const onEvent = vi.fn();
  const statuses: RealtimeStatus[] = [];
  const stop = subscribeToSession(client, 'S1', {
    onEvent,
    setStatus: (status) => statuses.push(status),
  });
  return { client, onEvent, statuses, stop };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('subscribeToSession', () => {
  it('opens exactly one channel and listens to the three session tables', () => {
    const { client, stop } = setup();

    expect(client.channels).toHaveLength(1);
    expect(client.names).toEqual(['session:S1']);
    expect(client.channels[0].subscriptions.map((s) => [s.table, s.filter])).toEqual([
      ['entries', 'session_id=eq.S1'],
      ['session_players', 'session_id=eq.S1'],
      ['sessions', 'id=eq.S1'],
    ]);
    expect(client.channels[0].subscribeCalls).toBe(1);
    stop();
  });

  it('reports live on SUBSCRIBED and forwards every change', () => {
    const { client, onEvent, statuses, stop } = setup();

    client.channels[0].emit('SUBSCRIBED');
    client.channels[0].emitChange('entries');
    client.channels[0].emitChange('sessions');

    expect(statuses).toEqual(['live']);
    expect(onEvent).toHaveBeenCalledTimes(2);
    stop();
  });

  it('replaces the broken channel after CHANNEL_ERROR instead of re-subscribing it', () => {
    const { client, statuses, stop } = setup();
    const broken = client.channels[0];

    broken.emit('CHANNEL_ERROR');

    // The errored channel is gone (a second subscribe() on it would be a no-op
    // in realtime-js), a fresh one took over — with a status callback.
    expect(client.wasRemoved(broken)).toBe(true);
    expect(broken.subscribeCalls).toBe(1);
    expect(client.channels).toHaveLength(2);
    const fresh = client.channels[1];
    expect(fresh.subscribeCalls).toBe(1);
    expect(fresh.statusCallback).not.toBeNull();
    expect(fresh.subscriptions).toHaveLength(3);
    expect(statuses).toEqual(['connecting']);
    stop();
  });

  it('goes back to live on the new channel and never shows the hint', () => {
    const { client, onEvent, statuses, stop } = setup();

    client.channels[0].emit('CHANNEL_ERROR');
    client.channels[1].emit('SUBSCRIBED');
    vi.advanceTimersByTime(60_000);
    client.channels[1].emitChange('entries');

    expect(statuses).toEqual(['connecting', 'live']);
    expect(onEvent).toHaveBeenCalledTimes(1);
    stop();
  });

  it('retries only once and then shows the hint after 10 seconds', () => {
    const { client, statuses, stop } = setup();

    client.channels[0].emit('CHANNEL_ERROR');
    client.channels[1].emit('TIMED_OUT');

    expect(client.channels).toHaveLength(2);
    expect(statuses).toEqual(['connecting', 'connecting']);

    vi.advanceTimersByTime(9_999);
    expect(statuses).toEqual(['connecting', 'connecting']);
    vi.advanceTimersByTime(1);
    expect(statuses).toEqual(['connecting', 'connecting', 'disconnected']);
    stop();
  });

  it('arms the hint only once, no matter how many errors arrive', () => {
    const { client, statuses, stop } = setup();

    client.channels[0].emit('CHANNEL_ERROR');
    client.channels[1].emit('TIMED_OUT');
    client.channels[1].emit('CHANNEL_ERROR');
    vi.advanceTimersByTime(20_000);

    expect(statuses.filter((status) => status === 'disconnected')).toHaveLength(1);
    stop();
  });

  it('removes the active channel on teardown and stays silent afterwards', () => {
    const { client, onEvent, statuses, stop } = setup();

    client.channels[0].emit('CHANNEL_ERROR');
    stop();

    expect(client.wasRemoved(client.channels[1])).toBe(true);
    const before = statuses.length;

    client.channels[1].emit('SUBSCRIBED');
    client.channels[1].emitChange('entries');
    vi.advanceTimersByTime(60_000);

    expect(statuses).toHaveLength(before);
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('does not remove the same channel twice', () => {
    const { client, stop } = setup();
    const removeSpy = vi.spyOn(client, 'removeChannel');

    client.channels[0].emit('CHANNEL_ERROR');
    stop();
    stop();

    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy.mock.calls[0][0]).toBe(client.channels[0]);
    expect(removeSpy.mock.calls[1][0]).toBe(client.channels[1]);
  });

  it('survives a client that throws while reconnecting', () => {
    const client = new FakeClient();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const statuses: RealtimeStatus[] = [];
    const stop = subscribeToSession(client, 'S1', {
      onEvent: () => {},
      setStatus: (status) => statuses.push(status),
    });

    vi.spyOn(client, 'channel').mockImplementation(() => {
      throw new Error('offline');
    });
    client.channels[0].emit('CHANNEL_ERROR');

    expect(statuses).toEqual(['connecting']);
    expect(errors).toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(statuses).toEqual(['connecting', 'disconnected']);
    stop();
  });
});
