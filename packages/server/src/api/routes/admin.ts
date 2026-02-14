// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Admin routes — database maintenance operations.
 *
 * Provides endpoints for manual VACUUM and maintenance status.
 * All routes require owner role.
 *
 * @module api/routes/admin
 */

import { Hono } from "hono";
import { requireAuth } from "../middleware/auth.js";
import { resolveRole, requirePermission } from "../middleware/rbac.js";
import { runVacuum, getMaintenanceStatus } from "../../db/maintenance.js";
import type { ApiEnv } from "./types.js";

export const adminRoute = new Hono<ApiEnv>();

adminRoute.use("*", requireAuth, resolveRole);

/**
 * POST /admin/db/vacuum
 *
 * Trigger a manual VACUUM to rebuild the database and reclaim disk space.
 * Owner-only operation — may take several seconds on large databases.
 */
adminRoute.post(
  "/db/vacuum",
  requirePermission("admin:db-vacuum"),
  async (c) => {
    const result = runVacuum();
    return c.json({
      message: "VACUUM completed",
      sizeBefore: result.sizeBefore,
      sizeAfter: result.sizeAfter,
      freedBytes: result.sizeBefore - result.sizeAfter,
      durationMs: result.durationMs,
    });
  },
);

/**
 * GET /admin/db/status
 *
 * Get database maintenance status including file sizes and last maintenance times.
 * Owner-only operation.
 */
adminRoute.get(
  "/db/status",
  requirePermission("admin:db-vacuum"),
  async (c) => {
    const status = getMaintenanceStatus();
    return c.json(status);
  },
);
