// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * WebSocket client for AI Installer agent.
 *
 * Manages the WebSocket connection to the server, handles message sending
 * and receiving, and provides automatic reconnection with exponential backoff.
 *
 * @module client
 */

import WebSocket from 'ws';

import type { Message } from './protocol-lite.js';
import { safeParseMessageLite } from './protocol-lite.js';
import { MessageQueue } from './message-queue.js';

// ============================================================================
// Types
// ============================================================================

/** Configuration options for the InstallClient */
export interface InstallClientOptions {
  /** WebSocket server URL (e.g., "ws://localhost:3000") */
  serverUrl: string;
  /** Whether to automatically reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Maximum number of reconnection attempts (default: 5) */
  maxReconnectAttempts?: number;
  /** Base delay between reconnection attempts in ms (default: 1000) */
  reconnectBaseDelayMs?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  reconnectMaxDelayMs?: number;
  /** Connection timeout in ms (default: 10000) */
  connectionTimeoutMs?: number;
  /** Optional message queue for offline buffering (enables trySend). */
  messageQueue?: MessageQueue;
}

/** Connection state of the client */
export const ConnectionState = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
} as const;

export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState];

/** Events emitted by the InstallClient */
export interface InstallClientEvents {
  /** Emitted when the connection is established */
  connected: () => void;
  /** Emitted when the connection is closed */
  disconnected: (code: number, reason: string) => void;
  /** Emitted when a valid message is received */
  message: (message: Message) => void;
  /** Emitted when an error occurs */
  error: (error: Error) => void;
  /** Emitted when a reconnection attempt starts */
  reconnecting: (attempt: number, maxAttempts: number) => void;
  /** Emitted when all reconnection attempts are exhausted */
  reconnectFailed: () => void;
  /** Emitted when reconnection succeeds (WebSocket re-established) */
  reconnected: () => void;
}

// ============================================================================
// InstallClient
// ============================================================================

/**
 * WebSocket client for communicating with the AI Installer server.
 *
 * Provides message sending/receiving with protocol validation, event-based
 * message handling, and automatic reconnection with exponential backoff.
 *
 * @example
 * ```ts
 * const client = new InstallClient({ serverUrl: 'ws://localhost:3000' });
 * client.on('message', (msg) => {
 *   console.log(`Received: ${msg.type}`);
 * });
 * await client.connect();
 * client.send(createMessage('session.create', { software: 'openclaw' }));
 * ```
 */
export class InstallClient {
  private ws: WebSocket | null = null;
  private _state: ConnectionState = ConnectionState.DISCONNECTED;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: Partial<{
    [K in keyof InstallClientEvents]: InstallClientEvents[K][];
  }> = {};

  private readonly serverUrl: string;
  private readonly autoReconnect: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly reconnectMaxDelayMs: number;
  private readonly connectionTimeoutMs: number;
  private readonly _messageQueue: MessageQueue | null;

  constructor(options: InstallClientOptions) {
    this.serverUrl = options.serverUrl;
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 1000;
    this.reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30000;
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 10000;
    this._messageQueue = options.messageQueue ?? null;

    // Auto-flush queued messages on reconnection
    if (this._messageQueue) {
      this.on('reconnected', () => {
        this.flushQueue();
      });
    }
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /** Current connection state */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Connect to the WebSocket server.
   *
   * @returns A promise that resolves when the connection is established
   * @throws {Error} When the connection fails or times out
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._state === ConnectionState.CONNECTED) {
        resolve();
        return;
      }

      if (this._state === ConnectionState.CONNECTING) {
        reject(new Error('Connection already in progress'));
        return;
      }

      this._state = ConnectionState.CONNECTING;
      this.reconnectAttempts = 0;

      this.establishConnection(resolve, reject);
    });
  }

  /**
   * Disconnect from the server.
   *
   * Disables automatic reconnection and closes the WebSocket connection.
   *
   * @param code - WebSocket close code (default: 1000)
   * @param reason - Close reason string (default: 'Client disconnecting')
   */
  disconnect(code = 1000, reason = 'Client disconnecting'): void {
    this.clearReconnectTimer();
    this.clearConnectionTimer();

    if (this.ws) {
      // Prevent reconnection on intentional disconnect
      const ws = this.ws;
      this.ws = null;
      this._state = ConnectionState.DISCONNECTED;

      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(code, reason);
      }
    } else {
      this._state = ConnectionState.DISCONNECTED;
    }
  }

  /**
   * Send a protocol message to the server.
   *
   * @param message - The protocol message to send
   * @throws {Error} When the client is not connected
   */
  send(message: Message): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Client is not connected');
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send a message, buffering it in the queue if the connection is down.
   *
   * Non-queueable messages (e.g. step.output) are silently dropped when
   * disconnected — they are real-time streams with no value after a delay.
   *
   * @returns `'sent'` if delivered immediately, `'queued'` if buffered,
   *          or `'dropped'` if the message type is non-queueable and the
   *          connection is down.
   */
  trySend(message: Message): 'sent' | 'queued' | 'dropped' {
    try {
      this.send(message);
      return 'sent';
    } catch {
      if (!this._messageQueue) {
        return 'dropped';
      }
      const enqueued = this._messageQueue.enqueue(message);
      return enqueued ? 'queued' : 'dropped';
    }
  }

  /**
   * Get the message queue (if one was configured).
   */
  getQueue(): MessageQueue | null {
    return this._messageQueue;
  }

  /**
   * Register an event listener.
   *
   * @param event - The event name
   * @param listener - The listener function
   */
  on<K extends keyof InstallClientEvents>(
    event: K,
    listener: InstallClientEvents[K],
  ): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    (this.listeners[event] as InstallClientEvents[K][]).push(listener);
  }

  /**
   * Remove an event listener.
   *
   * @param event - The event name
   * @param listener - The listener function to remove
   */
  off<K extends keyof InstallClientEvents>(
    event: K,
    listener: InstallClientEvents[K],
  ): void {
    const listeners = this.listeners[event] as InstallClientEvents[K][] | undefined;
    if (!listeners) return;

    const index = listeners.indexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * Register a one-time event listener.
   *
   * @param event - The event name
   * @param listener - The listener function (called at most once)
   */
  once<K extends keyof InstallClientEvents>(
    event: K,
    listener: InstallClientEvents[K],
  ): void {
    const wrapper = ((...args: unknown[]) => {
      this.off(event, wrapper as InstallClientEvents[K]);
      (listener as (...a: unknown[]) => void)(...args);
    }) as InstallClientEvents[K];

    this.on(event, wrapper);
  }

  /**
   * Send a message and wait for a specific response message type.
   *
   * @param message - The message to send
   * @param expectedType - The message type to wait for
   * @param timeoutMs - How long to wait before timing out (default: 30000)
   * @returns The response message
   * @throws {Error} When the response times out or client disconnects
   */
  sendAndWait<T extends Message['type']>(
    message: Message,
    expectedType: T,
    timeoutMs = 30000,
  ): Promise<Extract<Message, { type: T }>> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        this.off('message', onMessage);
        this.off('disconnected', onDisconnect);
        this.off('error', onError);
      };

      const onMessage = (msg: Message) => {
        if (msg.type === expectedType) {
          cleanup();
          resolve(msg as Extract<Message, { type: T }>);
        }
      };

      const onDisconnect = () => {
        cleanup();
        reject(new Error('Disconnected while waiting for response'));
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${expectedType} response`));
      }, timeoutMs);

      this.on('message', onMessage);
      this.on('disconnected', onDisconnect);
      this.on('error', onError);

      try {
        this.send(message);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });
  }

  /**
   * Wait for a specific message type without sending a message.
   *
   * @param expectedType - The message type to wait for
   * @param timeoutMs - How long to wait before timing out (default: 30000)
   * @returns The response message
   * @throws {Error} When the response times out or client disconnects
   */
  waitFor<T extends Message['type']>(
    expectedType: T,
    timeoutMs = 30000,
  ): Promise<Extract<Message, { type: T }>> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        this.off('message', onMessage);
        this.off('disconnected', onDisconnect);
        this.off('error', onError);
      };

      const onMessage = (msg: Message) => {
        if (msg.type === expectedType) {
          cleanup();
          resolve(msg as Extract<Message, { type: T }>);
        }
      };

      const onDisconnect = () => {
        cleanup();
        reject(new Error('Disconnected while waiting for response'));
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for ${expectedType} response`));
      }, timeoutMs);

      this.on('message', onMessage);
      this.on('disconnected', onDisconnect);
      this.on('error', onError);
    });
  }

  // --------------------------------------------------------------------------
  // Private methods
  // --------------------------------------------------------------------------

  private establishConnection(
    resolve: () => void,
    reject: (err: Error) => void,
  ): void {
    try {
      this.ws = new WebSocket(this.serverUrl);
    } catch (err) {
      this._state = ConnectionState.DISCONNECTED;
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    // Connection timeout
    this.connectionTimer = setTimeout(() => {
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.terminate();
        this._state = ConnectionState.DISCONNECTED;
        reject(new Error(`Connection timeout after ${this.connectionTimeoutMs}ms`));
      }
    }, this.connectionTimeoutMs);

    this.ws.on('open', () => {
      this.clearConnectionTimer();
      this._state = ConnectionState.CONNECTED;
      this.reconnectAttempts = 0;
      this.emit('connected');
      resolve();
    });

    this.ws.on('message', (data) => {
      this.handleRawMessage(data);
    });

    this.ws.on('close', (code, reason) => {
      this.clearConnectionTimer();
      const reasonStr = reason?.toString() || '';

      // Only emit disconnected and attempt reconnect if we haven't been
      // intentionally disconnected (ws set to null in disconnect())
      if (this.ws) {
        this.ws = null;
        const wasConnected = this._state === ConnectionState.CONNECTED;
        this._state = ConnectionState.DISCONNECTED;
        this.emit('disconnected', code, reasonStr);

        if (wasConnected && this.autoReconnect) {
          this.attemptReconnect();
        }
      }
    });

    this.ws.on('error', (err) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
  }

  private handleRawMessage(data: WebSocket.RawData): void {
    try {
      const text = typeof data === 'string' ? data : data.toString();
      const json: unknown = JSON.parse(text);
      const result = safeParseMessageLite(json);

      if (result.success) {
        this.emit('message', result.data);
      } else {
        this.emit('error', new Error(`Invalid message from server: ${result.error.message}`));
      }
    } catch (err) {
      this.emit(
        'error',
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnectFailed');
      return;
    }

    this.reconnectAttempts++;
    this._state = ConnectionState.RECONNECTING;

    const delay = Math.min(
      this.reconnectBaseDelayMs * Math.pow(2, this.reconnectAttempts - 1),
      this.reconnectMaxDelayMs,
    );

    this.emit('reconnecting', this.reconnectAttempts, this.maxReconnectAttempts);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.establishConnection(
        () => {
          // Reconnection succeeded - emit reconnected event
          this.emit('reconnected');
        },
        () => {
          // Reconnection failed, will be handled by close/error events
        },
      );
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearConnectionTimer(): void {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer);
      this.connectionTimer = null;
    }
  }

  private flushQueue(): void {
    if (!this._messageQueue || this._messageQueue.isEmpty) return;
    this._messageQueue.flush((msg) => this.send(msg));
  }

  private emit<K extends keyof InstallClientEvents>(
    event: K,
    ...args: Parameters<InstallClientEvents[K]>
  ): void {
    const listeners = this.listeners[event] as
      | InstallClientEvents[K][]
      | undefined;
    if (listeners) {
      for (const listener of [...listeners]) {
        (listener as (...a: Parameters<InstallClientEvents[K]>) => void)(...args);
      }
    }
  }
}
