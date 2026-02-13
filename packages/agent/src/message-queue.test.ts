// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { Message } from '@aiinstaller/shared';

import {
  MessageQueue,
  DEFAULT_MAX_QUEUE_SIZE,
  getMessageQueue,
  setMessageQueue,
  _resetMessageQueue,
} from './message-queue.js';

// ============================================================================
// Helpers
// ============================================================================

function makeMsg(type: string, id = '1'): Message {
  return {
    type,
    payload: { stepId: id, success: true, exitCode: 0, stdout: '', stderr: '', duration: 100 },
    timestamp: Date.now(),
  } as unknown as Message;
}

function makeStepComplete(id: string): Message {
  return makeMsg('step.complete', id);
}

function makeStepOutput(id: string): Message {
  return makeMsg('step.output', id);
}

function makeMetrics(): Message {
  return makeMsg('metrics.report');
}

// ============================================================================
// MessageQueue.isQueueable — message classification
// ============================================================================

describe('MessageQueue.isQueueable', () => {
  it('returns true for step.complete (queueable)', () => {
    expect(MessageQueue.isQueueable(makeStepComplete('1'))).toBe(true);
  });

  it('returns true for metrics.report (queueable)', () => {
    expect(MessageQueue.isQueueable(makeMetrics())).toBe(true);
  });

  it('returns true for error.occurred (queueable)', () => {
    expect(MessageQueue.isQueueable(makeMsg('error.occurred'))).toBe(true);
  });

  it('returns false for step.output (real-time stream)', () => {
    expect(MessageQueue.isQueueable(makeStepOutput('1'))).toBe(false);
  });

  it('returns false for ai.stream.token (real-time stream)', () => {
    expect(MessageQueue.isQueueable(makeMsg('ai.stream.token'))).toBe(false);
  });

  it('returns true for snapshot.response', () => {
    expect(MessageQueue.isQueueable(makeMsg('snapshot.response'))).toBe(true);
  });
});

// ============================================================================
// enqueue / drain
// ============================================================================

describe('MessageQueue enqueue & drain', () => {
  let queue: MessageQueue;

  beforeEach(() => {
    queue = new MessageQueue();
  });

  it('enqueues a queueable message and reports size', () => {
    const msg = makeStepComplete('1');
    const result = queue.enqueue(msg);
    expect(result).toBe(true);
    expect(queue.size).toBe(1);
    expect(queue.isEmpty).toBe(false);
  });

  it('rejects non-queueable messages', () => {
    const msg = makeStepOutput('1');
    const result = queue.enqueue(msg);
    expect(result).toBe(false);
    expect(queue.size).toBe(0);
  });

  it('drains all messages in FIFO order', () => {
    const m1 = makeStepComplete('1');
    const m2 = makeStepComplete('2');
    const m3 = makeStepComplete('3');
    queue.enqueue(m1);
    queue.enqueue(m2);
    queue.enqueue(m3);

    const drained = queue.drain();
    expect(drained).toHaveLength(3);
    expect(drained[0]).toBe(m1);
    expect(drained[1]).toBe(m2);
    expect(drained[2]).toBe(m3);
    expect(queue.size).toBe(0);
    expect(queue.isEmpty).toBe(true);
  });

  it('drain returns empty array when queue is empty', () => {
    expect(queue.drain()).toEqual([]);
  });

  it('peek returns oldest message without removing it', () => {
    const m1 = makeStepComplete('1');
    const m2 = makeStepComplete('2');
    queue.enqueue(m1);
    queue.enqueue(m2);

    expect(queue.peek()).toBe(m1);
    expect(queue.size).toBe(2);
  });

  it('peek returns undefined on empty queue', () => {
    expect(queue.peek()).toBeUndefined();
  });

  it('clear removes all messages', () => {
    queue.enqueue(makeStepComplete('1'));
    queue.enqueue(makeStepComplete('2'));
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.isEmpty).toBe(true);
  });
});

// ============================================================================
// Overflow / capacity
// ============================================================================

describe('MessageQueue overflow', () => {
  it('discards oldest message when at capacity', () => {
    const queue = new MessageQueue({ maxSize: 3 });
    const m1 = makeStepComplete('1');
    const m2 = makeStepComplete('2');
    const m3 = makeStepComplete('3');
    const m4 = makeStepComplete('4');

    queue.enqueue(m1);
    queue.enqueue(m2);
    queue.enqueue(m3);
    queue.enqueue(m4);

    expect(queue.size).toBe(3);
    const drained = queue.drain();
    expect(drained[0]).toBe(m2);
    expect(drained[1]).toBe(m3);
    expect(drained[2]).toBe(m4);
  });

  it('calls onOverflow with the discarded message', () => {
    const onOverflow = vi.fn();
    const queue = new MessageQueue({ maxSize: 2, onOverflow });

    const m1 = makeStepComplete('1');
    const m2 = makeStepComplete('2');
    const m3 = makeStepComplete('3');

    queue.enqueue(m1);
    queue.enqueue(m2);
    queue.enqueue(m3);

    expect(onOverflow).toHaveBeenCalledOnce();
    expect(onOverflow).toHaveBeenCalledWith(m1);
  });

  it('default max size is DEFAULT_MAX_QUEUE_SIZE', () => {
    expect(DEFAULT_MAX_QUEUE_SIZE).toBe(1000);
    const queue = new MessageQueue();
    // Fill to capacity without overflow
    for (let i = 0; i < 1000; i++) {
      queue.enqueue(makeStepComplete(String(i)));
    }
    expect(queue.size).toBe(1000);

    // Next enqueue triggers overflow
    const onOverflow = vi.fn();
    const queue2 = new MessageQueue({ onOverflow });
    for (let i = 0; i < 1001; i++) {
      queue2.enqueue(makeStepComplete(String(i)));
    }
    expect(queue2.size).toBe(1000);
    expect(onOverflow).toHaveBeenCalledOnce();
  });
});

// ============================================================================
// flush
// ============================================================================

describe('MessageQueue flush', () => {
  let queue: MessageQueue;

  beforeEach(() => {
    queue = new MessageQueue();
  });

  it('sends all messages via sendFn in FIFO order', () => {
    const sent: Message[] = [];
    const sendFn = (msg: Message) => { sent.push(msg); };

    const m1 = makeStepComplete('1');
    const m2 = makeStepComplete('2');
    queue.enqueue(m1);
    queue.enqueue(m2);

    const count = queue.flush(sendFn);
    expect(count).toBe(2);
    expect(sent).toEqual([m1, m2]);
    expect(queue.size).toBe(0);
  });

  it('stops on sendFn error and keeps remaining messages', () => {
    let callCount = 0;
    const sendFn = (_msg: Message) => {
      callCount++;
      if (callCount === 2) throw new Error('send failed');
    };

    queue.enqueue(makeStepComplete('1'));
    queue.enqueue(makeStepComplete('2'));
    queue.enqueue(makeStepComplete('3'));

    const count = queue.flush(sendFn);
    expect(count).toBe(1);
    expect(queue.size).toBe(2); // m2 and m3 remain
  });

  it('returns 0 when queue is empty', () => {
    const sendFn = vi.fn();
    const count = queue.flush(sendFn);
    expect(count).toBe(0);
    expect(sendFn).not.toHaveBeenCalled();
  });

  it('can be retried after partial failure', () => {
    let shouldFail = true;
    const sendFn = vi.fn((_msg: Message) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error('transient');
      }
    });

    queue.enqueue(makeStepComplete('1'));
    queue.enqueue(makeStepComplete('2'));

    // First flush: m1 fails, nothing sent
    const first = queue.flush(sendFn);
    expect(first).toBe(0);
    expect(queue.size).toBe(2);

    // Second flush: m1 succeeds (shouldFail now false), m2 succeeds
    const second = queue.flush(sendFn);
    expect(second).toBe(2);
    expect(queue.size).toBe(0);
  });
});

// ============================================================================
// stats
// ============================================================================

describe('MessageQueue stats', () => {
  it('tracks totalEnqueued', () => {
    const queue = new MessageQueue();
    queue.enqueue(makeStepComplete('1'));
    queue.enqueue(makeStepComplete('2'));
    expect(queue.stats.totalEnqueued).toBe(2);
  });

  it('tracks totalDiscarded on overflow', () => {
    const queue = new MessageQueue({ maxSize: 1 });
    queue.enqueue(makeStepComplete('1'));
    queue.enqueue(makeStepComplete('2'));
    expect(queue.stats.totalDiscarded).toBe(1);
    expect(queue.stats.totalEnqueued).toBe(2);
  });

  it('tracks totalFlushed', () => {
    const queue = new MessageQueue();
    queue.enqueue(makeStepComplete('1'));
    queue.enqueue(makeStepComplete('2'));
    queue.flush(() => {});
    expect(queue.stats.totalFlushed).toBe(2);
  });

  it('does not count non-queueable messages in totalEnqueued', () => {
    const queue = new MessageQueue();
    queue.enqueue(makeStepOutput('1'));
    expect(queue.stats.totalEnqueued).toBe(0);
  });

  it('reports correct aggregate stats after mixed operations', () => {
    const queue = new MessageQueue({ maxSize: 2 });
    queue.enqueue(makeStepComplete('1'));
    queue.enqueue(makeStepComplete('2'));
    queue.enqueue(makeStepComplete('3')); // overflow, discard 1
    queue.enqueue(makeStepOutput('4'));   // non-queueable, rejected

    // flush one, fail on second
    let calls = 0;
    queue.flush(() => { calls++; if (calls === 2) throw new Error('fail'); });

    const stats = queue.stats;
    expect(stats.totalEnqueued).toBe(3);  // 3 queueable enqueued
    expect(stats.totalDiscarded).toBe(1); // 1 overflowed
    expect(stats.totalFlushed).toBe(1);   // 1 sent before error
    expect(stats.size).toBe(1);           // 1 remains
  });
});

// ============================================================================
// Singleton
// ============================================================================

describe('MessageQueue singleton', () => {
  beforeEach(() => {
    _resetMessageQueue();
  });

  it('getMessageQueue returns the same instance', () => {
    const q1 = getMessageQueue();
    const q2 = getMessageQueue();
    expect(q1).toBe(q2);
  });

  it('setMessageQueue replaces the singleton', () => {
    const custom = new MessageQueue({ maxSize: 5 });
    setMessageQueue(custom);
    expect(getMessageQueue()).toBe(custom);
  });

  it('_resetMessageQueue clears the singleton', () => {
    const q1 = getMessageQueue();
    _resetMessageQueue();
    const q2 = getMessageQueue();
    expect(q1).not.toBe(q2);
  });
});
