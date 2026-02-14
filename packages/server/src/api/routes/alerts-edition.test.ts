// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for alerts & alert-rules routes edition gating (CE vs EE).
 *
 * Verifies that all /alerts/* and /alert-rules/* endpoints are blocked
 * in CE mode and accessible in EE mode via requireFeature('alerts').
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

vi.mock("../middleware/validate.js", () => ({
  validateQuery: vi.fn(() => {
    return async (
      c: {
        req: { query: () => Record<string, string> };
        set: (k: string, v: unknown) => void;
      },
      next: () => Promise<void>,
    ) => {
      c.set("validatedQuery", c.req.query());
      await next();
    };
  }),
  validateBody: vi.fn(() => {
    return async (
      c: {
        req: { json: () => Promise<unknown> };
        set: (k: string, v: unknown) => void;
      },
      next: () => Promise<void>,
    ) => {
      c.set("validatedBody", await c.req.json());
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

vi.mock("../../db/repositories/alert-repository.js", () => ({
  getAlertRepository: () => ({
    listUnresolved: vi.fn(async () => ({ alerts: [], total: 0 })),
    listByServer: vi.fn(async () => ({ alerts: [], total: 0 })),
    getById: vi.fn(async () => ({
      id: "alert-1",
      serverId: "server-1",
      type: "cpu",
      severity: "warning",
      message: "CPU high",
      value: "90",
      threshold: "80",
      resolved: false,
      resolvedAt: null,
      createdAt: new Date().toISOString(),
    })),
    resolve: vi.fn(async () => true),
  }),
}));

vi.mock("../../db/repositories/alert-rule-repository.js", () => ({
  getAlertRuleRepository: () => ({
    create: vi.fn(async () => ({
      id: "rule-1",
      serverId: "server-1",
      userId: "user-1",
      name: "High CPU",
      metricType: "cpu",
      operator: "gt",
      threshold: 80,
      severity: "warning",
      enabled: true,
      emailRecipients: [],
      cooldownMinutes: 5,
      lastTriggeredAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    listByUser: vi.fn(async () => ({ rules: [], total: 0 })),
    listByServer: vi.fn(async () => ({ rules: [], total: 0 })),
    getById: vi.fn(async () => ({
      id: "rule-1",
      serverId: "server-1",
      userId: "user-1",
      name: "High CPU",
      metricType: "cpu",
      operator: "gt",
      threshold: 80,
      severity: "warning",
      enabled: true,
      emailRecipients: [],
      cooldownMinutes: 5,
      lastTriggeredAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    update: vi.fn(async () => ({
      id: "rule-1",
      serverId: "server-1",
      userId: "user-1",
      name: "Updated",
      metricType: "cpu",
      operator: "gt",
      threshold: 90,
      severity: "critical",
      enabled: true,
      emailRecipients: [],
      cooldownMinutes: 5,
      lastTriggeredAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    delete: vi.fn(async () => true),
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
import { onError } from "../middleware/error-handler.js";
import { alerts } from "./alerts.js";
import { alertRules } from "./alert-rules.js";
import type { ApiEnv } from "./types.js";

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
  const app = new Hono<ApiEnv>();
  app.onError(onError);
  app.route("/alerts", alerts);
  app.route("/alert-rules", alertRules);
  return app;
}

// ============================================================================
// CE Mode — All alerts routes blocked
// ============================================================================

describe("CE mode — alerts routes blocked", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
  });

  it("GET /alerts returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/alerts");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("alerts");
  });

  it("GET /alerts/:id returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/alerts/alert-1");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("PATCH /alerts/:id/resolve returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/alerts/alert-1/resolve", {
      method: "PATCH",
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });
});

// ============================================================================
// CE Mode — All alert-rules routes blocked
// ============================================================================

describe("CE mode — alert-rules routes blocked", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
  });

  it("GET /alert-rules returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/alert-rules");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("alerts");
  });

  it("POST /alert-rules returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/alert-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId: "server-1",
        name: "High CPU",
        metricType: "cpu",
        operator: "gt",
        threshold: 80,
        severity: "warning",
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("GET /alert-rules/:id returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/alert-rules/rule-1");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("PATCH /alert-rules/:id returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/alert-rules/rule-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("DELETE /alert-rules/:id returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/alert-rules/rule-1", { method: "DELETE" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });
});

// ============================================================================
// EE Mode — All alerts routes accessible
// ============================================================================

describe("EE mode — alerts routes accessible", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
  });

  it("GET /alerts returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/alerts");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alerts).toBeDefined();
  });

  it("GET /alerts/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/alerts/alert-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alert).toBeDefined();
  });

  it("PATCH /alerts/:id/resolve returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/alerts/alert-1/resolve", {
      method: "PATCH",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

// ============================================================================
// EE Mode — All alert-rules routes accessible
// ============================================================================

describe("EE mode — alert-rules routes accessible", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
  });

  it("GET /alert-rules returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/alert-rules");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toBeDefined();
  });

  it("POST /alert-rules returns 201", async () => {
    const app = createTestApp();
    const res = await app.request("/alert-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        serverId: "server-1",
        name: "High CPU",
        metricType: "cpu",
        operator: "gt",
        threshold: 80,
        severity: "warning",
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.rule).toBeDefined();
  });

  it("GET /alert-rules/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/alert-rules/rule-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rule).toBeDefined();
  });

  it("PATCH /alert-rules/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/alert-rules/rule-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rule).toBeDefined();
  });

  it("DELETE /alert-rules/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/alert-rules/rule-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
