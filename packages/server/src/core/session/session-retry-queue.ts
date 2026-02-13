// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Retry queue for failed message persistence.
 *
 * When async message persistence fails (assistant/system messages),
 * entries are queued here for periodic retry with exponential backoff.
 *
 * @module core/session/session-retry-queue
 */

import type { SessionRepository } from '../../db/repositories/session-repository.js';
import type { SessionMessage } from '../../db/schema.js';
import type { PersistenceFailureCallback } from './manager.js';
import type { SessionCache } from './session-cache.js';
import { logger } from '../../utils/logger.js';

/** Retry queue configuration */
export interface RetryQueueOptions {
  /** Interval for retry queue sweep in milliseconds (default: 5 seconds) */
  retryIntervalMs: number;
  /** Maximum number of retry attempts for queued messages (default: 5) */
  maxRetryAttempts: number;
  /** Maximum queue size — oldest entries are discarded when exceeded (default: 10,000) */
  maxQueueSize: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryQueueOptions = {
  retryIntervalMs: 5 * 1000,    // 5 seconds
  maxRetryAttempts: 5,
  maxQueueSize: 10_000,
};

/** Entry in the persistence retry queue */
interface RetryEntry {
  sessionId: string;
  userId: string;
  message: SessionMessage;
  attempts: number;
}

/**
 * Manages a queue of failed message persistence attempts.
 *
 * Periodically processes the queue, retrying each entry up to maxRetryAttempts.
 * On final failure, invokes the onPersistenceFailure callback (if set).
 */
export class RetryQueue {
  private queue: RetryEntry[] = [];
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private options: RetryQueueOptions;
  private repo: SessionRepository;
  private cache: SessionCache;
  private _onPersistenceFailure: PersistenceFailureCallback | null = null;
  private _queueFullCount = 0;

  constructor(
    repo: SessionRepository,
    cache: SessionCache,
    options?: Partial<RetryQueueOptions>,
  ) {
    this.repo = repo;
    this.cache = cache;
    this.options = { ...DEFAULT_RETRY_OPTIONS, ...options };
    this.startRetryTimer();
  }

  /** Enqueue a failed message for retry. Discards oldest entries when queue is full. */
  enqueue(sessionId: string, userId: string, message: SessionMessage, attempts = 1): void {
    if (this.queue.length >= this.options.maxQueueSize) {
      const dropped = this.queue.shift()!;
      this._queueFullCount++;
      logger.warn(
        { droppedMessageId: dropped.message.id, droppedSessionId: dropped.sessionId, queueSize: this.options.maxQueueSize },
        'Retry queue full — discarding oldest entry',
      );
      this._onPersistenceFailure?.(dropped.sessionId, dropped.message.id);
    }
    this.queue.push({ sessionId, userId, message, attempts });
  }

  /** Get number of messages pending in the retry queue. */
  get pendingCount(): number {
    return this.queue.length;
  }

  /** Number of times the queue hit its size limit and discarded entries. */
  get queueFullCount(): number {
    return this._queueFullCount;
  }

  /** Set a callback invoked when persistence fails after all retries. */
  set onPersistenceFailure(cb: PersistenceFailureCallback | null) {
    this._onPersistenceFailure = cb;
  }

  /** Stop the retry timer (for cleanup/testing). */
  stop(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Process queued persistence retries. Exposed for testing. */
  async processQueue(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);
    const requeue: RetryEntry[] = [];

    for (const entry of batch) {
      try {
        await this.repo.addMessage(entry.sessionId, entry.userId, entry.message);
        this.cache.markMessagePersisted(entry.sessionId, entry.message.id);
        logger.info(
          { sessionId: entry.sessionId, messageId: entry.message.id, attempt: entry.attempts + 1 },
          'Retry queue: message persisted successfully',
        );
      } catch {
        entry.attempts++;
        if (entry.attempts < this.options.maxRetryAttempts) {
          requeue.push(entry);
        } else {
          logger.error(
            { sessionId: entry.sessionId, messageId: entry.message.id, attempts: entry.attempts },
            'Retry queue: message persistence exhausted — message lost on restart',
          );
          this._onPersistenceFailure?.(entry.sessionId, entry.message.id);
        }
      }
    }

    if (requeue.length > 0) {
      this.queue.push(...requeue);
    }
  }

  private startRetryTimer(): void {
    if (this.options.retryIntervalMs <= 0) return;
    this.retryTimer = setInterval(() => this.processQueue(), this.options.retryIntervalMs);
    this.retryTimer.unref();
  }
}
