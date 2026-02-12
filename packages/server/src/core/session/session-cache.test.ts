// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for SessionCache — LRU cache with TTL sweep and active-session protection.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SessionCache } from './session-cache.js';
import type { Session } from './manager.js';
import { logger } from '../../utils/logger.js';

function makeSession(id: string, plans = 0): Session {
  const session: Session = {
    id,
    serverId: 'server-1',
    messages: [],
    plans: new Map(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  for (let i = 0; i < plans; i++) {
    session.plans.set(`plan-${i}`, {
      planId: `plan-${i}`,
      description: 'test',
      steps: [],
      totalRisk: 'green',
      requiresConfirmation: false,
    });
  }
  return session;
}

let cache: SessionCache;

afterEach(() => {
  cache?.stopSweep();
});

// ============================================================================
// Basic get/put/delete
// ============================================================================

describe('get / put / delete', () => {
  it('should return undefined for non-existent session', () => {
    cache = new SessionCache({ sweepIntervalMs: 0 });
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should store and retrieve a session', () => {
    cache = new SessionCache({ sweepIntervalMs: 0 });
    const s = makeSession('s1');
    cache.put(s);
    expect(cache.get('s1')).toBe(s);
  });

  it('should update existing session on put', () => {
    cache = new SessionCache({ sweepIntervalMs: 0 });
    const s1 = makeSession('s1');
    cache.put(s1);
    const s1Updated = makeSession('s1');
    s1Updated.updatedAt = 'updated';
    cache.put(s1Updated);
    expect(cache.get('s1')!.updatedAt).toBe('updated');
    expect(cache.size).toBe(1);
  });

  it('should remove a session on delete', () => {
    cache = new SessionCache({ sweepIntervalMs: 0 });
    cache.put(makeSession('s1'));
    expect(cache.size).toBe(1);
    cache.delete('s1');
    expect(cache.size).toBe(0);
    expect(cache.get('s1')).toBeUndefined();
  });
});

// ============================================================================
// Peek (no touch)
// ============================================================================

describe('peek', () => {
  it('should return session without updating access time', async () => {
    cache = new SessionCache({ sweepIntervalMs: 0, ttlMs: 50 });
    cache.put(makeSession('s1'));

    await new Promise((r) => setTimeout(r, 60));

    // Peek should not refresh TTL
    expect(cache.peek('s1')).toBeDefined();

    // Sweep should still evict since peek didn't touch
    cache.sweepExpired();
    expect(cache.size).toBe(0);
  });

  it('should return undefined for non-existent session', () => {
    cache = new SessionCache({ sweepIntervalMs: 0 });
    expect(cache.peek('nonexistent')).toBeUndefined();
  });
});

// ============================================================================
// LRU eviction
// ============================================================================

describe('LRU eviction', () => {
  it('should evict oldest entry when cache is full', () => {
    cache = new SessionCache({ maxSize: 2, sweepIntervalMs: 0 });
    cache.put(makeSession('s1'));
    cache.put(makeSession('s2'));
    cache.put(makeSession('s3'));
    expect(cache.size).toBe(2);
    expect(cache.get('s1')).toBeUndefined();
    expect(cache.get('s2')).toBeDefined();
    expect(cache.get('s3')).toBeDefined();
  });

  it('should evict least-recently-used, not oldest created', async () => {
    cache = new SessionCache({ maxSize: 2, sweepIntervalMs: 0 });
    cache.put(makeSession('s1'));
    cache.put(makeSession('s2'));
    // Wait to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 5));
    // Touch s1 to make it more recent than s2
    cache.get('s1');
    // Adding s3 should evict s2 (LRU), not s1
    cache.put(makeSession('s3'));
    expect(cache.peek('s1')).toBeDefined();
    expect(cache.peek('s2')).toBeUndefined();
  });

  it('should protect active sessions from eviction', () => {
    cache = new SessionCache({ maxSize: 2, sweepIntervalMs: 0 });
    const warnSpy = vi.spyOn(logger, 'warn');

    cache.put(makeSession('s1', 1)); // has plan
    cache.put(makeSession('s2', 1)); // has plan

    // All active — cannot evict, cache grows beyond maxSize
    cache.put(makeSession('s3'));
    expect(cache.size).toBe(3);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ cacheSize: 2, maxSize: 2 }),
      expect.stringContaining('all sessions have active plans'),
    );

    warnSpy.mockRestore();
  });

  it('should evict non-active over active sessions', () => {
    cache = new SessionCache({ maxSize: 2, sweepIntervalMs: 0 });
    cache.put(makeSession('s1', 1)); // active
    cache.put(makeSession('s2'));     // not active
    cache.put(makeSession('s3'));     // triggers eviction
    expect(cache.size).toBe(2);
    expect(cache.get('s1')).toBeDefined();  // protected
    expect(cache.get('s2')).toBeUndefined(); // evicted
  });
});

// ============================================================================
// TTL sweep
// ============================================================================

describe('TTL sweep', () => {
  it('should sweep expired entries', async () => {
    cache = new SessionCache({ ttlMs: 50, sweepIntervalMs: 0 });
    cache.put(makeSession('s1'));

    await new Promise((r) => setTimeout(r, 60));
    cache.sweepExpired();
    expect(cache.size).toBe(0);
  });

  it('should not sweep recently accessed entries', async () => {
    cache = new SessionCache({ ttlMs: 100, sweepIntervalMs: 0 });
    cache.put(makeSession('s1'));

    await new Promise((r) => setTimeout(r, 50));
    cache.get('s1'); // refresh

    await new Promise((r) => setTimeout(r, 60));
    cache.sweepExpired();
    expect(cache.size).toBe(1);
  });

  it('should not sweep active sessions', async () => {
    cache = new SessionCache({ ttlMs: 50, sweepIntervalMs: 0 });
    cache.put(makeSession('s1', 1));

    await new Promise((r) => setTimeout(r, 60));
    cache.sweepExpired();
    expect(cache.size).toBe(1);
  });
});

// ============================================================================
// markMessagePersisted
// ============================================================================

describe('markMessagePersisted', () => {
  it('should mark a message as persisted', () => {
    cache = new SessionCache({ sweepIntervalMs: 0 });
    const s = makeSession('s1');
    s.messages.push({
      id: 'msg-1',
      role: 'assistant',
      content: 'Hello',
      timestamp: new Date().toISOString(),
      persisted: false,
    });
    cache.put(s);

    cache.markMessagePersisted('s1', 'msg-1');
    expect(s.messages[0].persisted).toBe(true);
  });

  it('should be a no-op for non-existent session', () => {
    cache = new SessionCache({ sweepIntervalMs: 0 });
    // Should not throw
    cache.markMessagePersisted('nonexistent', 'msg-1');
  });

  it('should be a no-op for non-existent message', () => {
    cache = new SessionCache({ sweepIntervalMs: 0 });
    cache.put(makeSession('s1'));
    cache.markMessagePersisted('s1', 'nonexistent');
  });
});

// ============================================================================
// stopSweep
// ============================================================================

describe('stopSweep', () => {
  it('should stop without error', () => {
    cache = new SessionCache({ sweepIntervalMs: 100 });
    cache.stopSweep();
    cache.stopSweep(); // double stop is safe
  });
});
