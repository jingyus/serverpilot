// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Server status event bus for real-time status push.
 *
 * Publishes server online/offline status changes so SSE endpoints
 * can push updates to Dashboard clients in real-time.
 *
 * @module core/server-status-bus
 */

import { EventEmitter } from 'node:events';

export interface ServerStatusEvent {
  serverId: string;
  status: 'online' | 'offline' | 'error';
  timestamp: string;
}

type StatusListener = (event: ServerStatusEvent) => void;

class ServerStatusBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many SSE subscribers
    this.emitter.setMaxListeners(500);
  }

  /** Publish a status change event. Broadcasts to all subscribers. */
  publish(event: ServerStatusEvent): void {
    this.emitter.emit('status', event);
  }

  /** Subscribe to all server status changes. Returns unsubscribe fn. */
  subscribe(listener: StatusListener): () => void {
    this.emitter.on('status', listener);
    return () => {
      this.emitter.off('status', listener);
    };
  }

  /** Get count of listeners (useful for tests/debugging). */
  listenerCount(): number {
    return this.emitter.listenerCount('status');
  }

  /** Remove all listeners (for testing). */
  removeAll(): void {
    this.emitter.removeAllListeners();
  }
}

// Singleton
let instance: ServerStatusBus | null = null;

export function getServerStatusBus(): ServerStatusBus {
  if (!instance) {
    instance = new ServerStatusBus();
  }
  return instance;
}

/** Reset singleton (for testing). */
export function _resetServerStatusBus(): void {
  instance?.removeAll();
  instance = null;
}
