// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Offline message queue for the Agent WebSocket client.
 *
 * Buffers messages while the WebSocket connection is down and
 * automatically flushes them (FIFO) once the connection is restored.
 * Real-time streaming messages (e.g. step.output) are NOT queued
 * because they become stale immediately.
 *
 * @module message-queue
 */

import type { Message } from './protocol-lite.js';

// ============================================================================
// Constants
// ============================================================================

/** Default maximum number of messages the queue will hold. */
export const DEFAULT_MAX_QUEUE_SIZE = 1000;

/**
 * Message types that must NOT be queued.
 *
 * These are real-time streaming messages whose value degrades rapidly
 * with time — delivering them after reconnect would be misleading.
 */
const NON_QUEUEABLE_TYPES: ReadonlySet<string> = new Set([
  'step.output',
  'ai.stream.token',
]);

// ============================================================================
// Types
// ============================================================================

export interface MessageQueueOptions {
  /** Maximum number of buffered messages before oldest are discarded. */
  maxSize?: number;
  /** Callback invoked when a message is discarded due to overflow. */
  onOverflow?: (discarded: Message) => void;
}

export interface QueueStats {
  /** Current number of messages in the queue. */
  size: number;
  /** Total messages enqueued since creation / last reset. */
  totalEnqueued: number;
  /** Total messages discarded due to overflow. */
  totalDiscarded: number;
  /** Total messages successfully flushed (sent after reconnect). */
  totalFlushed: number;
}

// ============================================================================
// MessageQueue
// ============================================================================

/**
 * FIFO message queue with a bounded capacity.
 *
 * When the queue is full the oldest message is discarded and an optional
 * `onOverflow` callback is invoked.
 */
export class MessageQueue {
  private readonly queue: Message[] = [];
  private readonly maxSize: number;
  private readonly onOverflow?: (discarded: Message) => void;

  private _totalEnqueued = 0;
  private _totalDiscarded = 0;
  private _totalFlushed = 0;

  constructor(options: MessageQueueOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.onOverflow = options.onOverflow;
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Determine whether a message type should be queued.
   *
   * Streaming / real-time types are excluded because their value is
   * time-sensitive and delivering them after a delay would be misleading.
   */
  static isQueueable(message: Message): boolean {
    return !NON_QUEUEABLE_TYPES.has(message.type);
  }

  /**
   * Add a message to the back of the queue.
   *
   * If the queue is already at capacity the oldest (front) message is
   * discarded first and `onOverflow` is called.
   *
   * @returns `true` if the message was enqueued, `false` if it was
   *          rejected (non-queueable type).
   */
  enqueue(message: Message): boolean {
    if (!MessageQueue.isQueueable(message)) {
      return false;
    }

    if (this.queue.length >= this.maxSize) {
      const discarded = this.queue.shift()!;
      this._totalDiscarded++;
      this.onOverflow?.(discarded);
    }

    this.queue.push(message);
    this._totalEnqueued++;
    return true;
  }

  /**
   * Remove and return all queued messages in FIFO order.
   *
   * The internal queue is cleared after this call.
   */
  drain(): Message[] {
    const messages = this.queue.splice(0);
    return messages;
  }

  /**
   * Flush all queued messages through the provided `sendFn`.
   *
   * Messages are sent strictly in order. If `sendFn` throws, the
   * remaining messages stay in the queue so they can be retried later.
   *
   * @returns The number of messages successfully sent.
   */
  flush(sendFn: (message: Message) => void): number {
    let sent = 0;

    while (this.queue.length > 0) {
      const message = this.queue[0];
      try {
        sendFn(message);
        this.queue.shift();
        sent++;
        this._totalFlushed++;
      } catch {
        // Stop flushing — remaining messages stay in queue for next attempt.
        break;
      }
    }

    return sent;
  }

  /** Number of messages currently in the queue. */
  get size(): number {
    return this.queue.length;
  }

  /** Whether the queue is empty. */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /** Peek at the oldest message without removing it. */
  peek(): Message | undefined {
    return this.queue[0];
  }

  /** Remove all messages from the queue. */
  clear(): void {
    this.queue.length = 0;
  }

  /** Aggregate statistics. */
  get stats(): QueueStats {
    return {
      size: this.queue.length,
      totalEnqueued: this._totalEnqueued,
      totalDiscarded: this._totalDiscarded,
      totalFlushed: this._totalFlushed,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: MessageQueue | null = null;

/** Get the singleton MessageQueue (creates one with defaults if needed). */
export function getMessageQueue(): MessageQueue {
  if (!_instance) {
    _instance = new MessageQueue();
  }
  return _instance;
}

/** Replace the singleton MessageQueue. */
export function setMessageQueue(queue: MessageQueue): void {
  _instance = queue;
}

/** Reset the singleton (for tests). */
export function _resetMessageQueue(): void {
  _instance = null;
}
