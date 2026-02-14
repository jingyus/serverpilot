// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for admin routes (database maintenance API).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import { onError } from "../middleware/error-handler.js";
import type { ApiEnv } from "./types.js";

// ============================================================================
// Module Mocks
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
      c: { set: (k: string, v: string) => void },
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

// Import after mocks
import { adminRoute } from "./admin.js";

// ============================================================================
// Test App Setup
// ============================================================================

function createTestApp() {
  const app = new Hono<ApiEnv>();
  app.route("/admin", adminRoute);
  app.onError(onError);
  return app;
}

// ============================================================================
// Tests
// ============================================================================

describe("admin routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRole = "owner";
  });

  // --------------------------------------------------------------------------
  // POST /admin/db/vacuum
  // --------------------------------------------------------------------------

  describe("POST /admin/db/vacuum", () => {
    it("should execute VACUUM and return result", async () => {
      mockRunVacuum.mockReturnValue({
        sizeBefore: 1048576,
        sizeAfter: 524288,
        durationMs: 150,
      });

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

    it("should return 500 if VACUUM fails", async () => {
      mockRunVacuum.mockImplementation(() => {
        throw new Error("Database locked");
      });

      const app = createTestApp();
      const res = await app.request("/admin/db/vacuum", { method: "POST" });

      expect(res.status).toBe(500);
    });

    it("should reject non-owner users", async () => {
      mockUserRole = "member";

      const app = createTestApp();
      const res = await app.request("/admin/db/vacuum", { method: "POST" });

      expect(res.status).toBe(500); // error from mock permission check
      expect(mockRunVacuum).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // GET /admin/db/status
  // --------------------------------------------------------------------------

  describe("GET /admin/db/status", () => {
    it("should return maintenance status", async () => {
      const mockStatus = {
        running: true,
        lastWalCheckpoint: "2026-02-14T10:00:00.000Z",
        lastPragmaOptimize: "2026-02-10T10:00:00.000Z",
        dbSizeBytes: 2097152,
        walSizeBytes: 4096,
      };
      mockGetMaintenanceStatus.mockReturnValue(mockStatus);

      const app = createTestApp();
      const res = await app.request("/admin/db/status");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.running).toBe(true);
      expect(body.lastWalCheckpoint).toBe("2026-02-14T10:00:00.000Z");
      expect(body.lastPragmaOptimize).toBe("2026-02-10T10:00:00.000Z");
      expect(body.dbSizeBytes).toBe(2097152);
      expect(body.walSizeBytes).toBe(4096);
    });

    it("should return status with null timestamps when not yet run", async () => {
      mockGetMaintenanceStatus.mockReturnValue({
        running: false,
        lastWalCheckpoint: null,
        lastPragmaOptimize: null,
        dbSizeBytes: 0,
        walSizeBytes: 0,
      });

      const app = createTestApp();
      const res = await app.request("/admin/db/status");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.running).toBe(false);
      expect(body.lastWalCheckpoint).toBeNull();
      expect(body.lastPragmaOptimize).toBeNull();
    });

    it("should reject non-owner users", async () => {
      mockUserRole = "admin";

      const app = createTestApp();
      const res = await app.request("/admin/db/status");

      expect(res.status).toBe(500);
      expect(mockGetMaintenanceStatus).not.toHaveBeenCalled();
    });
  });
});
