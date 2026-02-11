// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Sliding-window rate limiting middleware for Hono REST API.
 *
 * Limits requests per IP (anonymous) or per user ID (authenticated).
 * Supports route-specific overrides for sensitive endpoints
 * (login, register, chat).
 *
 * @module api/middleware/rate-limit
 */

import type { Context, Next } from 'hono';
import type { ApiEnv } from '../routes/types.js';

// ============================================================================
// Types
// ============================================================================

interface WindowEntry {
  /** Sorted timestamps of requests within the current window. */
  timestamps: number[];
}

export interface RateLimitConfig {
  /** Max requests per window for authenticated users. */
  authenticatedLimit: number;
  /** Max requests per window for anonymous users. */
  anonymousLimit: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Interval for cleaning up expired entries (ms). */
  cleanupIntervalMs: number;
}

export interface RouteRateLimitConfig {
  /** Route path pattern to match (matched against full path). */
  pattern: RegExp;
  /** Max requests per window for this route. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_CONFIG: RateLimitConfig = {
  authenticatedLimit: 100,
  anonymousLimit: 20,
  windowMs: 60_000, // 1 minute
  cleanupIntervalMs: 60_000, // clean every minute
};

const DEFAULT_ROUTE_OVERRIDES: RouteRateLimitConfig[] = [
  {
    pattern: /^\/api\/v1\/auth\/(login|register)$/,
    limit: 5,
    windowMs: 60_000,
  },
  {
    pattern: /^\/api\/v1\/chat\//,
    limit: 30,
    windowMs: 60_000,
  },
];

// ============================================================================
// In-Memory Sliding Window Store
// ============================================================================

export class RateLimitStore {
  /** key → WindowEntry. Key format: `"ip:<addr>"` or `"user:<id>"` or `"route:<pattern>:<key>"`. */
  private readonly _store = new Map<string, WindowEntry>();
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Start periodic cleanup of expired entries.
   * @param intervalMs - How often to run cleanup (ms).
   * @param maxAge - Remove timestamps older than this (ms).
   */
  start(intervalMs: number, maxAge: number): void {
    this.stop();
    this._cleanupTimer = setInterval(() => this._cleanup(maxAge), intervalMs);
    // Allow Node to exit even if timer is active
    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  stop(): void {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  /**
   * Record a request and check if it exceeds the limit.
   *
   * Uses a sliding window: counts only timestamps within [now - windowMs, now].
   *
   * @returns `{ allowed, remaining, resetMs }` where resetMs is when the
   *          oldest request in the window expires (epoch ms).
   */
  hit(key: string, limit: number, windowMs: number, now = Date.now()): {
    allowed: boolean;
    remaining: number;
    resetMs: number;
  } {
    let entry = this._store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      this._store.set(key, entry);
    }

    const windowStart = now - windowMs;

    // Prune timestamps outside the window
    const firstValid = entry.timestamps.findIndex((t) => t > windowStart);
    if (firstValid > 0) {
      entry.timestamps = entry.timestamps.slice(firstValid);
    } else if (firstValid === -1) {
      entry.timestamps = [];
    }

    const count = entry.timestamps.length;

    if (count >= limit) {
      // Oldest timestamp in window determines when the window resets
      const resetMs = entry.timestamps[0]! + windowMs;
      return { allowed: false, remaining: 0, resetMs };
    }

    // Record this request
    entry.timestamps.push(now);
    const remaining = limit - entry.timestamps.length;
    const resetMs = entry.timestamps[0]! + windowMs;
    return { allowed: true, remaining, resetMs };
  }

  /** Remove all entries whose timestamps are entirely expired. */
  private _cleanup(maxAge: number): void {
    const cutoff = Date.now() - maxAge;
    for (const [key, entry] of this._store) {
      // If the newest timestamp is older than cutoff, the entire entry is stale
      if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1]! <= cutoff) {
        this._store.delete(key);
      }
    }
  }

  /** Number of tracked keys (for testing/monitoring). */
  get size(): number {
    return this._store.size;
  }

  /** Clear all entries (for testing). */
  clear(): void {
    this._store.clear();
  }
}

// ============================================================================
// Singleton Store
// ============================================================================

let _store: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
  if (!_store) {
    _store = new RateLimitStore();
  }
  return _store;
}

export function setRateLimitStore(store: RateLimitStore): void {
  _store = store;
}

/** @internal Reset for tests. */
export function _resetRateLimitStore(): void {
  if (_store) {
    _store.stop();
    _store.clear();
  }
  _store = null;
}

// ============================================================================
// Helpers
// ============================================================================

function getClientIp(c: Context): string {
  return (
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    'unknown'
  );
}

function resolveUserId(c: Context<ApiEnv>): string | null {
  try {
    return c.get('userId') || null;
  } catch {
    return null;
  }
}

function findRouteOverride(path: string, overrides: RouteRateLimitConfig[]): RouteRateLimitConfig | undefined {
  return overrides.find((o) => o.pattern.test(path));
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create a rate limiting middleware for Hono.
 *
 * Applies sliding-window rate limiting based on:
 * 1. Route-specific overrides (login/register: 5/min, chat: 30/min)
 * 2. User-level limits for authenticated users (100/min)
 * 3. IP-level limits for anonymous users (20/min)
 *
 * Sets standard `X-RateLimit-*` headers on every response.
 *
 * @param config - Override default rate limit configuration.
 * @param routeOverrides - Override default route-specific limits.
 */
export function createRateLimitMiddleware(
  config: Partial<RateLimitConfig> = {},
  routeOverrides: RouteRateLimitConfig[] = DEFAULT_ROUTE_OVERRIDES,
) {
  const cfg: RateLimitConfig = { ...DEFAULT_CONFIG, ...config };

  // Reset and initialize a fresh store for this middleware instance
  _resetRateLimitStore();
  const store = getRateLimitStore();
  store.start(cfg.cleanupIntervalMs, cfg.windowMs * 2);

  return async function rateLimit(c: Context<ApiEnv>, next: Next): Promise<Response | void> {
    // Use the current global store (allows test resets)
    const currentStore = getRateLimitStore();
    const path = c.req.path;
    const ip = getClientIp(c);
    const userId = resolveUserId(c);

    // 1. Check route-specific override
    const routeOverride = findRouteOverride(path, routeOverrides);

    if (routeOverride) {
      // Route overrides key by IP (most are anonymous endpoints like login)
      const routeKey = `route:${routeOverride.pattern.source}:${ip}`;
      const result = currentStore.hit(routeKey, routeOverride.limit, routeOverride.windowMs);
      setRateLimitHeaders(c, routeOverride.limit, result.remaining, result.resetMs);
      if (!result.allowed) {
        return respondRateLimited(c, result.resetMs);
      }
    }

    // 2. Check global limit (user-based for authenticated, IP-based for anonymous)
    const globalKey = userId ? `user:${userId}` : `ip:${ip}`;
    const globalLimit = userId ? cfg.authenticatedLimit : cfg.anonymousLimit;
    const globalResult = currentStore.hit(globalKey, globalLimit, cfg.windowMs);

    // Use the more restrictive remaining count if both apply
    if (routeOverride) {
      // Route headers already set; only block if global also exceeded
      if (!globalResult.allowed) {
        setRateLimitHeaders(c, globalLimit, globalResult.remaining, globalResult.resetMs);
        return respondRateLimited(c, globalResult.resetMs);
      }
    } else {
      setRateLimitHeaders(c, globalLimit, globalResult.remaining, globalResult.resetMs);
      if (!globalResult.allowed) {
        return respondRateLimited(c, globalResult.resetMs);
      }
    }

    await next();
  };
}

// ============================================================================
// Response Helpers
// ============================================================================

function setRateLimitHeaders(c: Context, limit: number, remaining: number, resetMs: number): void {
  c.header('X-RateLimit-Limit', String(limit));
  c.header('X-RateLimit-Remaining', String(Math.max(0, remaining)));
  c.header('X-RateLimit-Reset', String(Math.ceil(resetMs / 1000)));
}

function respondRateLimited(c: Context, resetMs: number): Response {
  const retryAfter = Math.max(1, Math.ceil((resetMs - Date.now()) / 1000));
  c.header('Retry-After', String(retryAfter));
  return c.json(
    {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, please try again later',
      },
    },
    429,
  );
}
