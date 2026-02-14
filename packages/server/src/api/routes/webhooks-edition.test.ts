// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for webhooks routes edition gating (CE vs EE).
 *
 * Verifies that all /webhooks/* endpoints are blocked in CE mode
 * and accessible in EE mode via requireFeature('webhooks').
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

vi.mock("../../db/repositories/webhook-repository.js", () => ({
  getWebhookRepository: () => ({
    create: vi.fn(async () => ({
      id: "wh-1",
      userId: "user-1",
      tenantId: null,
      name: "Test",
      url: "https://example.com/hook",
      secret: "secret-key-123",
      events: ["task.completed"],
      enabled: true,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    findById: vi.fn(async () => ({
      id: "wh-1",
      userId: "user-1",
      tenantId: null,
      name: "Test",
      url: "https://example.com/hook",
      secret: "secret-key-123",
      events: ["task.completed"],
      enabled: true,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    listByUser: vi.fn(async () => ({ webhooks: [], total: 0 })),
    update: vi.fn(async () => ({
      id: "wh-1",
      userId: "user-1",
      tenantId: null,
      name: "Updated",
      url: "https://example.com/hook",
      secret: "secret-key-123",
      events: ["task.completed"],
      enabled: true,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    delete: vi.fn(async () => true),
    listDeliveries: vi.fn(async () => ({ deliveries: [], total: 0 })),
  }),
}));

vi.mock("../../core/webhook/dispatcher.js", () => ({
  getWebhookDispatcher: () => ({
    dispatch: vi.fn(async () => {}),
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
import { webhooksRoute } from "./webhooks.js";
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
  app.route("/webhooks", webhooksRoute);
  return app;
}

// ============================================================================
// CE Mode — All webhook routes blocked
// ============================================================================

describe("CE mode — webhooks routes blocked", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
  });

  it("GET /webhooks returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("webhooks");
  });

  it("POST /webhooks returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test",
        url: "https://example.com/hook",
        events: ["task.completed"],
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("webhooks");
  });

  it("GET /webhooks/:id returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks/wh-1");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("PATCH /webhooks/:id returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks/wh-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("DELETE /webhooks/:id returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks/wh-1", { method: "DELETE" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("POST /webhooks/:id/test returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks/wh-1/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "task.completed" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });

  it("GET /webhooks/:id/deliveries returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks/wh-1/deliveries");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
  });
});

// ============================================================================
// EE Mode — All webhook routes accessible
// ============================================================================

describe("EE mode — webhooks routes accessible", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
  });

  it("GET /webhooks returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webhooks).toBeDefined();
  });

  it("POST /webhooks returns 201", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Test",
        url: "https://example.com/hook",
        events: ["task.completed"],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.webhook).toBeDefined();
  });

  it("GET /webhooks/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks/wh-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webhook).toBeDefined();
  });

  it("PATCH /webhooks/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks/wh-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webhook).toBeDefined();
  });

  it("DELETE /webhooks/:id returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks/wh-1", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("POST /webhooks/:id/test returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks/wh-1/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "task.completed" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("GET /webhooks/:id/deliveries returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/webhooks/wh-1/deliveries");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deliveries).toBeDefined();
  });
});
