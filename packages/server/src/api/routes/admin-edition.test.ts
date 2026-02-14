// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for admin routes edition behavior (CE vs EE).
 *
 * Admin DB maintenance routes (/admin/db/vacuum, /admin/db/status) should be
 * available in BOTH CE and EE modes — SQLite needs maintenance regardless of
 * edition. Owner-only permission enforcement applies in both modes.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import type { FeatureFlags, EditionInfo } from "../../config/edition.js";
import { resolveFeatures } from "../../config/edition.js";

// ============================================================================
// Module Mocks — must be before imports of the module under test
// ============================================================================

const mockRunVacuum = vi.fn();
const mockGetMaintenanceStatus = vi.fn();

vi.mock("../../db/maintenance.js", () => ({
  runVacuum: (...args: unknown[]) => mockRunVacuum(...args),
  getMaintenanceStatus: (...args: unknown[]) =>
    mockGetMaintenanceStatus(...args),
}));

let mockUserRole = "owner";

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
      c.set("userRole", mockUserRole);
      await next();
    },
  ),
  requirePermission: vi.fn((permission: string) => {
    return async (_c: unknown, next: () => Promise<void>) => {
      if (mockUserRole !== "owner") {
        throw new Error(`Missing permission: ${permission}`);
      }
      await next();
    };
  }),
}));

// Keep the real requireFeature — override FEATURES singleton via getter.
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
import { adminRoute } from "./admin.js";
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
  app.route("/admin", adminRoute);
  return app;
}

const defaultVacuumResult = {
  sizeBefore: 1048576,
  sizeAfter: 524288,
  durationMs: 150,
};

const defaultStatus = {
  running: true,
  lastWalCheckpoint: "2026-02-14T10:00:00.000Z",
  lastPragmaOptimize: "2026-02-10T10:00:00.000Z",
  dbSizeBytes: 2097152,
  walSizeBytes: 4096,
};

// ============================================================================
// CE Mode — Admin routes available (SQLite needs maintenance in CE too)
// ============================================================================

describe("CE mode — admin routes available", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeFeatures = ceFeatures;
    mockUserRole = "owner";
  });

  it("POST /admin/db/vacuum returns 200 in CE mode", async () => {
    mockRunVacuum.mockReturnValue(defaultVacuumResult);

    const app = createTestApp();
    const res = await app.request("/admin/db/vacuum", { method: "POST" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("VACUUM completed");
    expect(body.sizeBefore).toBe(1048576);
    expect(body.sizeAfter).toBe(524288);
    expect(body.freedBytes).toBe(524288);
    expect(body.durationMs).toBe(150);
    expect(mockRunVacuum).toHaveBeenCalledOnce();
  });

  it("GET /admin/db/status returns 200 in CE mode", async () => {
    mockGetMaintenanceStatus.mockReturnValue(defaultStatus);

    const app = createTestApp();
    const res = await app.request("/admin/db/status");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.running).toBe(true);
    expect(body.dbSizeBytes).toBe(2097152);
  });

  it("POST /admin/db/vacuum rejects non-owner in CE mode", async () => {
    mockUserRole = "member";

    const app = createTestApp();
    const res = await app.request("/admin/db/vacuum", { method: "POST" });

    expect(res.status).toBe(500);
    expect(mockRunVacuum).not.toHaveBeenCalled();
  });

  it("GET /admin/db/status rejects non-owner in CE mode", async () => {
    mockUserRole = "admin";

    const app = createTestApp();
    const res = await app.request("/admin/db/status");

    expect(res.status).toBe(500);
    expect(mockGetMaintenanceStatus).not.toHaveBeenCalled();
  });
});

// ============================================================================
// EE Mode — Admin routes available (same behavior as CE)
// ============================================================================

describe("EE mode — admin routes available", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeFeatures = eeFeatures;
    mockUserRole = "owner";
  });

  it("POST /admin/db/vacuum returns 200 in EE mode", async () => {
    mockRunVacuum.mockReturnValue(defaultVacuumResult);

    const app = createTestApp();
    const res = await app.request("/admin/db/vacuum", { method: "POST" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toBe("VACUUM completed");
    expect(mockRunVacuum).toHaveBeenCalledOnce();
  });

  it("GET /admin/db/status returns 200 in EE mode", async () => {
    mockGetMaintenanceStatus.mockReturnValue(defaultStatus);

    const app = createTestApp();
    const res = await app.request("/admin/db/status");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.running).toBe(true);
  });

  it("POST /admin/db/vacuum rejects non-owner in EE mode", async () => {
    mockUserRole = "member";

    const app = createTestApp();
    const res = await app.request("/admin/db/vacuum", { method: "POST" });

    expect(res.status).toBe(500);
    expect(mockRunVacuum).not.toHaveBeenCalled();
  });

  it("GET /admin/db/status rejects non-owner in EE mode", async () => {
    mockUserRole = "admin";

    const app = createTestApp();
    const res = await app.request("/admin/db/status");

    expect(res.status).toBe(500);
    expect(mockGetMaintenanceStatus).not.toHaveBeenCalled();
  });
});
