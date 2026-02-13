// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for RetryQueue — persistence retry queue for failed message writes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RetryQueue } from './session-retry-queue.js';
import { SessionCache } from './session-cache.js';
import { InMemorySessionRepository } from '../../db/repositories/session-repository.js';
import type { SessionMessage } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';

const SESSION_ID = 'session-1';
const USER_ID = 'user-1';

function makeMessage(id = 'msg-1'): SessionMessage {
  return { id, role: 'assistant', content: 'Hello', timestamp: Date.now() };
}

let repo: InMemorySessionRepository;
let cache: SessionCache;
let queue: RetryQueue;

beforeEach(() => {
  repo = new InMemorySessionRepository();
  cache = new SessionCache({ sweepIntervalMs: 0 });
  queue = new RetryQueue(repo, cache, { retryIntervalMs: 0 });
});

afterEach(() => {
  queue.stop();
  cache.stopSweep();
});

// ============================================================================
// Basic enqueue / pending count
// ============================================================================

describe('enqueue / pendingCount', () => {
  it('should start with zero pending', () => {
    expect(queue.pendingCount).toBe(0);
  });

  it('should increment pending count on enqueue', () => {
    queue.enqueue(SESSION_ID, USER_ID, makeMessage());
    expect(queue.pendingCount).toBe(1);
  });

  it('should support multiple enqueues', () => {
    queue.enqueue(SESSION_ID, USER_ID, makeMessage('m1'));
    queue.enqueue(SESSION_ID, USER_ID, makeMessage('m2'));
    expect(queue.pendingCount).toBe(2);
  });
});

// ============================================================================
// processQueue — success
// ============================================================================

describe('processQueue (success)', () => {
  it('should persist queued message and clear queue', async () => {
    const session = await repo.create({ userId: USER_ID, serverId: 'server-1' });
    cache.put({
      id: session.id,
      serverId: 'server-1',
      messages: [{ id: 'msg-1', role: 'assistant', content: 'Hello', timestamp: new Date().toISOString(), persisted: false }],
      plans: new Map(),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });

    queue.enqueue(session.id, USER_ID, makeMessage());
    await queue.processQueue();

    expect(queue.pendingCount).toBe(0);
  });

  it('should mark message as persisted in cache', async () => {
    const session = await repo.create({ userId: USER_ID, serverId: 'server-1' });
    const cachedSession = {
      id: session.id,
      serverId: 'server-1',
      messages: [{ id: 'msg-1', role: 'assistant' as const, content: 'Hello', timestamp: new Date().toISOString(), persisted: false }],
      plans: new Map(),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
    cache.put(cachedSession);

    queue.enqueue(session.id, USER_ID, makeMessage());
    await queue.processQueue();

    expect(cachedSession.messages[0].persisted).toBe(true);
  });

  it('should handle empty queue gracefully', async () => {
    await queue.processQueue();
    expect(queue.pendingCount).toBe(0);
  });
});

// ============================================================================
// processQueue — retry on failure
// ============================================================================

describe('processQueue (failure / retry)', () => {
  it('should requeue if retry fails and under max attempts', async () => {
    const failQueue = new RetryQueue(repo, cache, { retryIntervalMs: 0, maxRetryAttempts: 3 });
    vi.spyOn(repo, 'addMessage').mockRejectedValue(new Error('DB error'));

    failQueue.enqueue(SESSION_ID, USER_ID, makeMessage(), 1);
    await failQueue.processQueue();

    // attempts incremented to 2, still < 3 maxRetryAttempts
    expect(failQueue.pendingCount).toBe(1);

    failQueue.stop();
  });

  it('should drop and invoke callback after max retries', async () => {
    const failQueue = new RetryQueue(repo, cache, { retryIntervalMs: 0, maxRetryAttempts: 2 });
    const errorSpy = vi.spyOn(logger, 'error');
    const failedMessages: string[] = [];
    failQueue.onPersistenceFailure = (_sid, msgId) => { failedMessages.push(msgId); };

    vi.spyOn(repo, 'addMessage').mockRejectedValue(new Error('DB error'));

    failQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m1'), 1);
    await failQueue.processQueue();

    // attempts=1 → incremented to 2, >= maxRetryAttempts(2) → dropped
    expect(failQueue.pendingCount).toBe(0);
    expect(failedMessages).toEqual(['m1']);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'm1', attempts: 2 }),
      expect.stringContaining('exhausted'),
    );

    errorSpy.mockRestore();
    failQueue.stop();
  });

  it('should not invoke callback if not set', async () => {
    const failQueue = new RetryQueue(repo, cache, { retryIntervalMs: 0, maxRetryAttempts: 1 });
    vi.spyOn(repo, 'addMessage').mockRejectedValue(new Error('DB error'));

    failQueue.enqueue(SESSION_ID, USER_ID, makeMessage(), 0);
    // Should not throw even without callback
    await failQueue.processQueue();
    expect(failQueue.pendingCount).toBe(0);

    failQueue.stop();
  });
});

// ============================================================================
// maxQueueSize — queue cap
// ============================================================================

describe('maxQueueSize', () => {
  it('should never exceed maxQueueSize', () => {
    const cappedQueue = new RetryQueue(repo, cache, { retryIntervalMs: 0, maxQueueSize: 3 });
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m1'));
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m2'));
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m3'));
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m4'));
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m5'));

    expect(cappedQueue.pendingCount).toBe(3);
    cappedQueue.stop();
  });

  it('should discard oldest entry when full', async () => {
    const cappedQueue = new RetryQueue(repo, cache, { retryIntervalMs: 0, maxQueueSize: 2 });
    const failureCalls: string[] = [];
    cappedQueue.onPersistenceFailure = (_sid, msgId) => { failureCalls.push(msgId); };

    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m1'));
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m2'));
    // Queue is full [m1, m2]. Adding m3 should drop m1.
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m3'));

    expect(cappedQueue.pendingCount).toBe(2);
    expect(failureCalls).toEqual(['m1']);
    cappedQueue.stop();
  });

  it('should invoke onPersistenceFailure for each dropped entry', () => {
    const cappedQueue = new RetryQueue(repo, cache, { retryIntervalMs: 0, maxQueueSize: 1 });
    const failureCalls: string[] = [];
    cappedQueue.onPersistenceFailure = (_sid, msgId) => { failureCalls.push(msgId); };

    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m1'));
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m2')); // drops m1
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m3')); // drops m2

    expect(cappedQueue.pendingCount).toBe(1);
    expect(failureCalls).toEqual(['m1', 'm2']);
    cappedQueue.stop();
  });

  it('should not invoke callback when queue is not full', () => {
    const cappedQueue = new RetryQueue(repo, cache, { retryIntervalMs: 0, maxQueueSize: 10 });
    const failureCalls: string[] = [];
    cappedQueue.onPersistenceFailure = (_sid, msgId) => { failureCalls.push(msgId); };

    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m1'));
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m2'));

    expect(failureCalls).toEqual([]);
    cappedQueue.stop();
  });

  it('should increment queueFullCount on each overflow', () => {
    const cappedQueue = new RetryQueue(repo, cache, { retryIntervalMs: 0, maxQueueSize: 2 });

    expect(cappedQueue.queueFullCount).toBe(0);
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m1'));
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m2'));
    expect(cappedQueue.queueFullCount).toBe(0);

    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m3'));
    expect(cappedQueue.queueFullCount).toBe(1);

    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m4'));
    expect(cappedQueue.queueFullCount).toBe(2);
    cappedQueue.stop();
  });

  it('should log warning when discarding entries', () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const cappedQueue = new RetryQueue(repo, cache, { retryIntervalMs: 0, maxQueueSize: 1 });

    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m1'));
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m2'));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ droppedMessageId: 'm1', queueSize: 1 }),
      expect.stringContaining('discarding oldest'),
    );

    warnSpy.mockRestore();
    cappedQueue.stop();
  });

  it('should work correctly without onPersistenceFailure callback', () => {
    const cappedQueue = new RetryQueue(repo, cache, { retryIntervalMs: 0, maxQueueSize: 1 });

    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m1'));
    // Should not throw even without callback set
    cappedQueue.enqueue(SESSION_ID, USER_ID, makeMessage('m2'));

    expect(cappedQueue.pendingCount).toBe(1);
    expect(cappedQueue.queueFullCount).toBe(1);
    cappedQueue.stop();
  });

  it('should use default maxQueueSize of 10000', () => {
    const defaultQueue = new RetryQueue(repo, cache, { retryIntervalMs: 0 });
    // Enqueue within default limit — no overflow
    for (let i = 0; i < 100; i++) {
      defaultQueue.enqueue(SESSION_ID, USER_ID, makeMessage(`m${i}`));
    }
    expect(defaultQueue.pendingCount).toBe(100);
    expect(defaultQueue.queueFullCount).toBe(0);
    defaultQueue.stop();
  });
});

// ============================================================================
// stop
// ============================================================================

describe('stop', () => {
  it('should stop timer without error', () => {
    const timedQueue = new RetryQueue(repo, cache, { retryIntervalMs: 100 });
    timedQueue.stop();
    timedQueue.stop(); // double stop is safe
  });
});
