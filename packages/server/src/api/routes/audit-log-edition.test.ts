// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for audit-log routes edition gating (CE vs EE).
 *
 * Verifies that GET /audit-log/export is blocked in CE mode
 * while GET /audit-log (basic query) remains accessible.
 * Both endpoints work normally in EE mode.
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

const mockAuditLogger = {
  log: vi.fn(),
  updateExecutionResult: vi.fn(),
  query: vi.fn(async () => ({ logs: [], total: 0 })),
  queryAll: vi.fn(async () => []),
};

vi.mock("../../core/security/audit-logger.js", () => ({
  getAuditLogger: () => mockAuditLogger,
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
import { auditLog } from "./audit-log.js";
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
  app.route("/audit-log", auditLog);
  return app;
}

// ============================================================================
// CE Mode — export blocked, basic query allowed
// ============================================================================

describe("CE mode — audit-log edition gating", () => {
  beforeEach(() => {
    activeFeatures = ceFeatures;
    vi.clearAllMocks();
  });

  it("GET /audit-log returns 200 (basic query allowed in CE)", async () => {
    const app = createTestApp();
    const res = await app.request("/audit-log");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs).toBeDefined();
    expect(body.total).toBe(0);
  });

  it("GET /audit-log/export returns 403 FEATURE_DISABLED", async () => {
    const app = createTestApp();
    const res = await app.request("/audit-log/export?format=csv");
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(body.error.feature).toBe("auditExport");
  });

  it("GET /audit-log/export does not call queryAll when blocked", async () => {
    const app = createTestApp();
    await app.request("/audit-log/export?format=csv");
    expect(mockAuditLogger.queryAll).not.toHaveBeenCalled();
  });
});

// ============================================================================
// EE Mode — both query and export accessible
// ============================================================================

describe("EE mode — audit-log edition gating", () => {
  beforeEach(() => {
    activeFeatures = eeFeatures;
    vi.clearAllMocks();
  });

  it("GET /audit-log returns 200", async () => {
    const app = createTestApp();
    const res = await app.request("/audit-log");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.logs).toBeDefined();
  });

  it("GET /audit-log/export returns 200 with CSV content", async () => {
    const app = createTestApp();
    const res = await app.request("/audit-log/export?format=csv");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
  });
});
