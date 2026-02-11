// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getMetricsBus, _resetMetricsBus } from './metrics-bus.js';
import type { MetricEvent } from './metrics-bus.js';

function makeMetricEvent(overrides: Partial<MetricEvent> = {}): MetricEvent {
  return {
    id: 'metric-1',
    serverId: 'server-1',
    cpuUsage: 45.5,
    memoryUsage: 2048,
    memoryTotal: 8192,
    diskUsage: 50000,
    diskTotal: 100000,
    networkIn: 1024,
    networkOut: 2048,
    timestamp: '2026-02-10T12:00:00.000Z',
    ...overrides,
  };
}

describe('MetricsBus', () => {
  beforeEach(() => {
    _resetMetricsBus();
  });

  it('should return a singleton instance', () => {
    const bus1 = getMetricsBus();
    const bus2 = getMetricsBus();
    expect(bus1).toBe(bus2);
  });

  it('should deliver metrics to subscribed listeners', () => {
    const bus = getMetricsBus();
    const listener = vi.fn();

    bus.subscribe('server-1', listener);
    const metric = makeMetricEvent();
    bus.publish('server-1', metric);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(metric);
  });

  it('should not deliver metrics for different serverIds', () => {
    const bus = getMetricsBus();
    const listener = vi.fn();

    bus.subscribe('server-1', listener);
    bus.publish('server-2', makeMetricEvent({ serverId: 'server-2' }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('should support multiple listeners for the same server', () => {
    const bus = getMetricsBus();
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    bus.subscribe('server-1', listener1);
    bus.subscribe('server-1', listener2);
    bus.publish('server-1', makeMetricEvent());

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  it('should unsubscribe correctly', () => {
    const bus = getMetricsBus();
    const listener = vi.fn();

    const unsubscribe = bus.subscribe('server-1', listener);
    unsubscribe();
    bus.publish('server-1', makeMetricEvent());

    expect(listener).not.toHaveBeenCalled();
  });

  it('should report correct listener count', () => {
    const bus = getMetricsBus();

    expect(bus.listenerCount('server-1')).toBe(0);

    const unsub1 = bus.subscribe('server-1', vi.fn());
    expect(bus.listenerCount('server-1')).toBe(1);

    const unsub2 = bus.subscribe('server-1', vi.fn());
    expect(bus.listenerCount('server-1')).toBe(2);

    unsub1();
    expect(bus.listenerCount('server-1')).toBe(1);

    unsub2();
    expect(bus.listenerCount('server-1')).toBe(0);
  });

  it('should removeAll listeners', () => {
    const bus = getMetricsBus();
    const listener = vi.fn();

    bus.subscribe('server-1', listener);
    bus.subscribe('server-2', listener);
    bus.removeAll();

    bus.publish('server-1', makeMetricEvent());
    bus.publish('server-2', makeMetricEvent({ serverId: 'server-2' }));

    expect(listener).not.toHaveBeenCalled();
  });

  it('should reset singleton via _resetMetricsBus', () => {
    const bus1 = getMetricsBus();
    _resetMetricsBus();
    const bus2 = getMetricsBus();

    expect(bus1).not.toBe(bus2);
  });

  it('should deliver multiple metrics in order', () => {
    const bus = getMetricsBus();
    const received: MetricEvent[] = [];
    const listener = (m: MetricEvent) => received.push(m);

    bus.subscribe('server-1', listener);

    const m1 = makeMetricEvent({ id: 'm1', cpuUsage: 10 });
    const m2 = makeMetricEvent({ id: 'm2', cpuUsage: 20 });
    const m3 = makeMetricEvent({ id: 'm3', cpuUsage: 30 });

    bus.publish('server-1', m1);
    bus.publish('server-1', m2);
    bus.publish('server-1', m3);

    expect(received).toHaveLength(3);
    expect(received[0].id).toBe('m1');
    expect(received[1].id).toBe('m2');
    expect(received[2].id).toBe('m3');
  });
});
