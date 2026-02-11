// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Metrics event bus for real-time SSE streaming.
 *
 * Provides pub/sub for metric points: agent heartbeat handler publishes,
 * SSE endpoint connections subscribe per serverId.
 *
 * @module core/metrics/metrics-bus
 */

import { EventEmitter } from 'node:events';

export interface MetricEvent {
  id: string;
  serverId: string;
  cpuUsage: number;
  memoryUsage: number;
  memoryTotal: number;
  diskUsage: number;
  diskTotal: number;
  networkIn: number;
  networkOut: number;
  timestamp: string;
}

type MetricListener = (metric: MetricEvent) => void;

class MetricsBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many SSE subscribers per server
    this.emitter.setMaxListeners(500);
  }

  /** Publish a new metric point for a server. */
  publish(serverId: string, metric: MetricEvent): void {
    this.emitter.emit(`metric:${serverId}`, metric);
  }

  /** Subscribe to metric updates for a specific server. Returns unsubscribe fn. */
  subscribe(serverId: string, listener: MetricListener): () => void {
    const event = `metric:${serverId}`;
    this.emitter.on(event, listener);
    return () => {
      this.emitter.off(event, listener);
    };
  }

  /** Get count of listeners for a server (useful for tests/debugging). */
  listenerCount(serverId: string): number {
    return this.emitter.listenerCount(`metric:${serverId}`);
  }

  /** Remove all listeners (for testing). */
  removeAll(): void {
    this.emitter.removeAllListeners();
  }
}

// Singleton
let instance: MetricsBus | null = null;

export function getMetricsBus(): MetricsBus {
  if (!instance) {
    instance = new MetricsBus();
  }
  return instance;
}

/** Reset singleton (for testing). */
export function _resetMetricsBus(): void {
  instance?.removeAll();
  instance = null;
}
