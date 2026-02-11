// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getServerStatusBus, _resetServerStatusBus } from './server-status-bus.js';
import type { ServerStatusEvent } from './server-status-bus.js';

function makeStatusEvent(overrides: Partial<ServerStatusEvent> = {}): ServerStatusEvent {
  return {
    serverId: 'server-1',
    status: 'online',
    timestamp: '2026-02-12T12:00:00.000Z',
    ...overrides,
  };
}

describe('ServerStatusBus', () => {
  beforeEach(() => {
    _resetServerStatusBus();
  });

  it('should return a singleton instance', () => {
    const bus1 = getServerStatusBus();
    const bus2 = getServerStatusBus();
    expect(bus1).toBe(bus2);
  });

  it('should deliver status events to all subscribers', () => {
    const bus = getServerStatusBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.subscribe(listener1);
    bus.subscribe(listener2);

    const event = makeStatusEvent();
    bus.publish(event);

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener1).toHaveBeenCalledWith(event);
    expect(listener2).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledWith(event);
  });

  it('should deliver online and offline events', () => {
    const bus = getServerStatusBus();
    const received: ServerStatusEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.publish(makeStatusEvent({ status: 'online' }));
    bus.publish(makeStatusEvent({ status: 'offline' }));

    expect(received).toHaveLength(2);
    expect(received[0].status).toBe('online');
    expect(received[1].status).toBe('offline');
  });

  it('should unsubscribe correctly', () => {
    const bus = getServerStatusBus();
    const listener = vi.fn();

    const unsubscribe = bus.subscribe(listener);
    unsubscribe();
    bus.publish(makeStatusEvent());

    expect(listener).not.toHaveBeenCalled();
  });

  it('should report correct listener count', () => {
    const bus = getServerStatusBus();

    expect(bus.listenerCount()).toBe(0);

    const unsub1 = bus.subscribe(vi.fn());
    expect(bus.listenerCount()).toBe(1);

    const unsub2 = bus.subscribe(vi.fn());
    expect(bus.listenerCount()).toBe(2);

    unsub1();
    expect(bus.listenerCount()).toBe(1);

    unsub2();
    expect(bus.listenerCount()).toBe(0);
  });

  it('should removeAll listeners', () => {
    const bus = getServerStatusBus();
    const listener = vi.fn();

    bus.subscribe(listener);
    bus.removeAll();

    bus.publish(makeStatusEvent());
    expect(listener).not.toHaveBeenCalled();
  });

  it('should reset singleton via _resetServerStatusBus', () => {
    const bus1 = getServerStatusBus();
    _resetServerStatusBus();
    const bus2 = getServerStatusBus();

    expect(bus1).not.toBe(bus2);
  });

  it('should deliver events for different servers to all subscribers', () => {
    const bus = getServerStatusBus();
    const received: ServerStatusEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.publish(makeStatusEvent({ serverId: 'server-1', status: 'online' }));
    bus.publish(makeStatusEvent({ serverId: 'server-2', status: 'offline' }));

    expect(received).toHaveLength(2);
    expect(received[0].serverId).toBe('server-1');
    expect(received[1].serverId).toBe('server-2');
  });
});
