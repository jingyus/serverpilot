// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * LRU cache for chat sessions with TTL-based expiration.
 *
 * Sessions with active plans are protected from eviction.
 * Evicted sessions can be reloaded from DB on next access.
 *
 * @module core/session/session-cache
 */

import type { Session } from './manager.js';
import { logger } from '../../utils/logger.js';

/** Cache configuration */
export interface CacheOptions {
  /** Maximum number of sessions in cache (default: 100) */
  maxSize: number;
  /** TTL in milliseconds for inactive sessions (default: 30 minutes) */
  ttlMs: number;
  /** Interval for TTL sweep in milliseconds (default: 60 seconds) */
  sweepIntervalMs: number;
}

export const DEFAULT_CACHE_OPTIONS: CacheOptions = {
  maxSize: 100,
  ttlMs: 30 * 60 * 1000,       // 30 minutes
  sweepIntervalMs: 60 * 1000,   // 1 minute
};

/** Internal cache entry wrapping a Session with access tracking */
interface CacheEntry {
  session: Session;
  lastAccessedAt: number;
}

/**
 * LRU session cache with TTL sweep.
 *
 * Active sessions (those with plans) are protected from both LRU eviction
 * and TTL sweep.
 */
export class SessionCache {
  private cache = new Map<string, CacheEntry>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private options: CacheOptions;

  constructor(options?: Partial<CacheOptions>) {
    this.options = { ...DEFAULT_CACHE_OPTIONS, ...options };
    this.startSweep();
  }

  /** Get a session from cache, updating its access timestamp. */
  get(sessionId: string): Session | undefined {
    const entry = this.cache.get(sessionId);
    if (!entry) return undefined;
    this.touchEntry(entry);
    return entry.session;
  }

  /** Get a session from cache without updating access timestamp. */
  peek(sessionId: string): Session | undefined {
    const entry = this.cache.get(sessionId);
    return entry?.session;
  }

  /** Insert or update a session in cache, evicting LRU entries if needed. */
  put(session: Session): void {
    const existing = this.cache.get(session.id);
    if (existing) {
      existing.session = session;
      this.touchEntry(existing);
      return;
    }
    this.evictIfNeeded();
    this.cache.set(session.id, { session, lastAccessedAt: Date.now() });
  }

  /** Remove a session from cache. */
  delete(sessionId: string): void {
    this.cache.delete(sessionId);
  }

  /** Touch a session to mark it as recently accessed (used after cache-miss reload). */
  touch(sessionId: string): void {
    const entry = this.cache.get(sessionId);
    if (entry) this.touchEntry(entry);
  }

  /** Get current cache size. */
  get size(): number {
    return this.cache.size;
  }

  /** Mark a cached message as persisted. */
  markMessagePersisted(sessionId: string, messageId: string): void {
    const entry = this.cache.get(sessionId);
    if (!entry) return;
    const msg = entry.session.messages.find((m) => m.id === messageId);
    if (msg) msg.persisted = true;
  }

  /** Stop the sweep timer (for cleanup/testing). */
  stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Manually trigger TTL sweep (exposed for testing). */
  sweepExpired(): void {
    const now = Date.now();
    const expiry = this.options.ttlMs;
    let evicted = 0;

    for (const [key, entry] of this.cache) {
      if (this.isActive(entry)) continue;
      if (now - entry.lastAccessedAt > expiry) {
        this.cache.delete(key);
        evicted++;
      }
    }

    if (evicted > 0) {
      logger.debug({ evicted, cacheSize: this.cache.size }, 'TTL sweep evicted sessions');
    }
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private touchEntry(entry: CacheEntry): void {
    entry.lastAccessedAt = Date.now();
  }

  /** Check if a session has active plans (should not be evicted). */
  private isActive(entry: CacheEntry): boolean {
    return entry.session.plans.size > 0;
  }

  /**
   * Evict the least-recently-used non-active entry if cache is at capacity.
   * Active sessions (with plans) are protected from eviction.
   */
  private evictIfNeeded(): void {
    if (this.cache.size < this.options.maxSize) return;

    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (this.isActive(entry)) continue;
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      logger.debug({ sessionId: oldestKey, cacheSize: this.cache.size }, 'Session evicted from cache (LRU)');
    } else {
      logger.warn(
        { cacheSize: this.cache.size, maxSize: this.options.maxSize },
        'Cache full — all sessions have active plans, cannot evict',
      );
    }
  }

  private startSweep(): void {
    if (this.options.sweepIntervalMs <= 0) return;
    this.sweepTimer = setInterval(() => this.sweepExpired(), this.options.sweepIntervalMs);
    this.sweepTimer.unref();
  }
}
