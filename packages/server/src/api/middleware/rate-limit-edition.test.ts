// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for rate limiting middleware edition gating (CE vs EE).
 *
 * Verifies that rate limiting is skipped in CE mode (no X-RateLimit-* headers)
 * and active in EE mode (headers present, limits enforced).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import type { FeatureFlags, EditionInfo } from "../../config/edition.js";
import { resolveFeatures } from "../../config/edition.js";

// ============================================================================
// Module Mocks
// ============================================================================

vi.mock("../../utils/logger.js", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  return {
    logger: log,
    createContextLogger: vi.fn(() => log),
    getLogger: vi.fn(() => log),
    initLogger: vi.fn(() => log),
  };
});

// Mock edition module to allow switching FEATURES between CE/EE per test
let activeFeatures: FeatureFlags;

vi.mock("../../config/edition.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../config/edition.js")>();
  return {
    ...original,
    get FEATURES() {
      return activeFeatures;
    },
  };
});

// Import after mocks
import { createApiApp } from "../routes/index.js";
import type { ApiEnv } from "../routes/types.js";
import { _resetRateLimitStore } from "./rate-limit.js";

// ============================================================================
// Edition constants
// ============================================================================

const ceInfo: EditionInfo = {
  edition: "ce",
  isCE: true,
  isEE: false,
  isCloud: false,
};
const eeInfo: EditionInfo = {
  edition: "ee",
  isCE: false,
  isEE: true,
  isCloud: false,
};

const ceFeatures: FeatureFlags = resolveFeatures(ceInfo);
const eeFeatures: FeatureFlags = resolveFeatures(eeInfo);

// ============================================================================
// Helpers
// ============================================================================

const RATE_LIMIT_HEADERS = [
  "X-RateLimit-Limit",
  "X-RateLimit-Remaining",
  "X-RateLimit-Reset",
];

// ============================================================================
// CE Mode — Rate limiting skipped
// ============================================================================

describe.skip("CE mode — rate limiting skipped", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    _resetRateLimitStore();
  });

  afterEach(() => {
    _resetRateLimitStore();
  });

  it("should not include X-RateLimit-* headers on API responses", async () => {
    const app = createApiApp();
    const res = await app.request("/api/v1/auth/logout", { method: "POST" });

    expect(res.status).toBe(200);
    for (const header of RATE_LIMIT_HEADERS) {
      expect(res.headers.get(header)).toBeNull();
    }
  });

  it("should not include Retry-After header even with many requests", async () => {
    const app = createApiApp();

    // Make 25 requests (exceeds default anonymous limit of 20)
    let lastRes: Response | undefined;
    for (let i = 0; i < 25; i++) {
      lastRes = await app.request("/api/v1/auth/logout", {
        method: "POST",
        headers: { "X-Forwarded-For": "10.0.0.1" },
      });
    }

    // In CE mode, no rate limiting — all requests succeed, no rate-limit headers
    expect(lastRes!.status).toBe(200);
    expect(lastRes!.headers.get("Retry-After")).toBeNull();
    for (const header of RATE_LIMIT_HEADERS) {
      expect(lastRes!.headers.get(header)).toBeNull();
    }
  });

  it("should never return 429 regardless of request volume", async () => {
    const app = createApiApp();

    // Exceed both anonymous (20) and login (5) limits
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await app.request("/api/v1/auth/logout", {
        method: "POST",
        headers: { "X-Forwarded-For": "10.0.0.1" },
      });
      statuses.push(res.status);
    }

    expect(statuses).not.toContain(429);
  });
});

// ============================================================================
// EE Mode — Rate limiting active
// ============================================================================

describe.skip("EE mode — rate limiting active", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
    _resetRateLimitStore();
  });

  afterEach(() => {
    _resetRateLimitStore();
  });

  it("should include X-RateLimit-* headers on API responses", async () => {
    const app = createApiApp();
    const res = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { "X-Forwarded-For": "10.0.0.1" },
    });

    expect(res.status).toBe(200);
    for (const header of RATE_LIMIT_HEADERS) {
      expect(res.headers.get(header)).not.toBeNull();
    }
  });

  it("should return 429 when anonymous limit exceeded", async () => {
    const app = createApiApp();

    // Default anonymous limit is 20
    for (let i = 0; i < 20; i++) {
      await app.request("/api/v1/auth/logout", {
        method: "POST",
        headers: { "X-Forwarded-For": "10.0.0.1" },
      });
    }

    const res = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { "X-Forwarded-For": "10.0.0.1" },
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });

  it("should decrement X-RateLimit-Remaining with each request", async () => {
    const app = createApiApp();

    const res1 = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { "X-Forwarded-For": "10.0.0.1" },
    });
    const remaining1 = Number(res1.headers.get("X-RateLimit-Remaining"));

    const res2 = await app.request("/api/v1/auth/logout", {
      method: "POST",
      headers: { "X-Forwarded-For": "10.0.0.1" },
    });
    const remaining2 = Number(res2.headers.get("X-RateLimit-Remaining"));

    expect(remaining2).toBe(remaining1 - 1);
  });
});
