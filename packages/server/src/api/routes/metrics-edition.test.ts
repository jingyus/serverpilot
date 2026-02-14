// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for metrics routes edition gating (CE vs EE).
 *
 * Verifies that all /metrics/* endpoints are blocked in CE mode
 * and accessible in EE mode via requireFeature('metricsMonitoring').
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { FeatureFlags, EditionInfo } from "../../config/edition.js";
import { resolveFeatures } from "../../config/edition.js";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

// Mock auth/RBAC to pass-through (we test feature gating, not permissions)
vi.mock("../middleware/auth.js", () => ({
  requireAuth: vi.fn(
    async (
      c: Record<string, (k: string, v: string) => void>,
      next: () => Promise<void>,
    ) => {
      c.set("userId", "user-1");
      await next();
    },
  ),
}));

vi.mock("../middleware/rbac.js", () => ({
  resolveRole: vi.fn(
    async (
      c: Record<string, (k: string, v: string) => void>,
      next: () => Promise<void>,
    ) => {
      c.set("userRole", "owner");
      await next();
    },
  ),
  requirePermission: vi.fn(() => {
    return async (_c: unknown, next: () => Promise<void>) => {
      await next();
    };
  }),
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../db/repositories/metrics-repository.js", () => ({
  getMetricsRepository: () => ({
    getByServerAndRange: vi.fn(async () => []),
    getLatest: vi.fn(async () => ({
      id: "metric-1",
      serverId: "server-1",
      cpuUsage: 45.5,
      memoryUsage: 2048,
      memoryTotal: 8192,
      diskUsage: 50000,
      diskTotal: 100000,
      networkIn: 1024,
      networkOut: 2048,
      timestamp: new Date().toISOString(),
    })),
  }),
}));

vi.mock("../../db/repositories/server-repository.js", () => ({
  getServerRepository: () => ({
    findById: vi.fn(async () => ({ id: "server-1", name: "test-server" })),
  }),
}));

vi.mock("../../core/metrics/metrics-bus.js", () => ({
  getMetricsBus: () => ({
    subscribe: vi.fn(() => vi.fn()),
    publish: vi.fn(),
  }),
}));

// Keep the real requireFeature — we test actual feature gating behavior.
// Override the FEATURES singleton via a mocked edition module getter.
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
import { metricsRoutes } from "./metrics.js";
import type { AuthContext } from "./types.js";

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

function createTestApp() {
  const app = new Hono<AuthContext>();
  app.route("/metrics", metricsRoutes);
  return app;
}

// ============================================================================
// CE Mode — All metrics routes blocked
// ============================================================================

describe("CE mode — metrics routes blocked", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
  });

  it("GET /metrics returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/metrics?serverId=server-1&range=24h");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("metricsMonitoring");
  });

  it("GET /metrics/latest returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/metrics/latest?serverId=server-1");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("metricsMonitoring");
  });

  it("GET /metrics/aggregated returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/metrics/aggregated?serverId=server-1&range=24h",
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("metricsMonitoring");
  });

  it("GET /metrics/stream returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/metrics/stream?serverId=server-1");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("metricsMonitoring");
  });
});

// ============================================================================
// EE Mode — All metrics routes accessible
// ============================================================================

describe("EE mode — metrics routes accessible", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
  });

  it("GET /metrics returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/metrics?serverId=server-1&range=24h");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toBeDefined();
  });

  it("GET /metrics/latest returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/metrics/latest?serverId=server-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.latest).toBeDefined();
  });

  it("GET /metrics/aggregated returns 200", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/metrics/aggregated?serverId=server-1&range=24h",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.metrics).toBeDefined();
  });
});
