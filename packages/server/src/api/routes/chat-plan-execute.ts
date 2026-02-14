// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Legacy plan execution routes — execute confirmed plans and emergency cancel.
 *
 * Separated from chat.ts to keep file sizes under the 500-line limit.
 * Mounts under the same `/chat` prefix via the route index.
 *
 * @module api/routes/chat-plan-execute
 */

import { randomUUID } from "node:crypto";
import { streamSSE } from "hono/streaming";
import { Hono } from "hono";
import { validateBody } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRole, requirePermission } from "../middleware/rbac.js";
import { ApiError } from "../middleware/error-handler.js";
import { getSessionManager } from "../../core/session/manager.js";
import { getServerRepository } from "../../db/repositories/server-repository.js";
import { getProfileManager } from "../../core/profile/manager.js";
import { logger } from "../../utils/logger.js";
import { findConnectedAgent } from "../../core/agent/agent-connector.js";
import { getTaskExecutor } from "../../core/task/executor.js";
import {
  executePlanSteps,
  rejectAllPendingDecisions,
  getActiveExecution,
  hasActiveExecution,
  removeActiveExecution,
} from "./chat-execution.js";
import type { StoredPlan } from "./chat-execution.js";
import { safeWriteSSE } from "./chat.js";
import { ExecutePlanBodySchema, CancelExecutionBodySchema } from "./schemas.js";
import type { ExecutePlanBody, CancelExecutionBody } from "./schemas.js";
import type { ApiEnv } from "./types.js";

const chatPlanExecute = new Hono<ApiEnv>();

// All plan execution routes require authentication
chatPlanExecute.use("*", requireAuth, resolveRole);

// POST /chat/:serverId/execute — Execute confirmed plan (SSE) [legacy]
chatPlanExecute.post(
  "/:serverId/execute",
  requirePermission("chat:use"),
  validateBody(ExecutePlanBodySchema),
  async (c) => {
    const { serverId } = c.req.param();
    const userId = c.get("userId");
    const body = c.get("validatedBody") as ExecutePlanBody;

    const repo = getServerRepository();
    const server = await repo.findById(serverId, userId);
    if (!server) {
      throw ApiError.notFound("Server");
    }

    const sessionMgr = getSessionManager();
    const plan = sessionMgr.getPlan(body.sessionId, body.planId) as
      | StoredPlan
      | undefined;
    if (!plan) {
      throw ApiError.notFound("Plan");
    }

    logger.info(
      {
        operation: "plan_execute",
        serverId,
        planId: body.planId,
        sessionId: body.sessionId,
        userId,
      },
      `Executing plan: ${plan.description}`,
    );

    return streamSSE(c, async (stream) => {
      const clientId = findConnectedAgent(serverId);
      if (!clientId) {
        await stream.writeSSE({
          event: "output",
          data: JSON.stringify({
            stepId: "connection-check",
            content: "[ERROR] No agent connected.\n",
          }),
        });
        await stream.writeSSE({
          event: "complete",
          data: JSON.stringify({
            success: false,
            operationId: randomUUID(),
            error: "Agent not connected",
          }),
        });
        return;
      }

      let serverProfile;
      try {
        const profileMgr = getProfileManager();
        serverProfile = await profileMgr.getProfile(serverId, userId);
      } catch (profileErr) {
        logger.error(
          {
            operation: "profile_load",
            serverId,
            error:
              profileErr instanceof Error
                ? profileErr.message
                : String(profileErr),
          },
          "Failed to load server profile for plan execution",
        );
        await safeWriteSSE(
          stream,
          "complete",
          JSON.stringify({
            success: false,
            error: "Failed to load server profile",
          }),
        );
        return;
      }

      await executePlanSteps({
        plan,
        serverId,
        userId,
        sessionId: body.sessionId,
        clientId,
        stream,
        serverProfile,
        planId: body.planId,
        mode: "auto",
      });
    });
  },
);

// POST /chat/:serverId/execute/cancel — Emergency stop running execution
chatPlanExecute.post(
  "/:serverId/execute/cancel",
  requirePermission("chat:use"),
  validateBody(CancelExecutionBodySchema),
  async (c) => {
    const { serverId } = c.req.param();
    const userId = c.get("userId");
    const body = c.get("validatedBody") as CancelExecutionBody;

    const repo = getServerRepository();
    const server = await repo.findById(serverId, userId);
    if (!server) {
      throw ApiError.notFound("Server");
    }

    const isTracked = hasActiveExecution(body.planId);

    // Resolve any pending step decisions as 'reject'
    rejectAllPendingDecisions(body.planId);

    if (!isTracked) {
      return c.json(
        { success: false, message: "No active execution found for this plan" },
        404,
      );
    }

    // Get executionId before removing (may be undefined if not yet assigned)
    const executionId = getActiveExecution(body.planId);

    // Remove from tracking map so the step loop breaks on next iteration
    removeActiveExecution(body.planId);

    let cancelled = true;

    if (executionId) {
      // ExecutionId is available — cancel the running command in the executor
      const executor = getTaskExecutor();
      cancelled = executor.cancelExecution(executionId);
    }
    // If executionId was not yet assigned, the execution just started and hasn't
    // dispatched a command yet. Removing from the tracking map is sufficient —
    // the step loop will detect the removal and break with cancelled=true.

    logger.info(
      {
        operation: "plan_cancel",
        serverId,
        planId: body.planId,
        executionId: executionId ?? "(not yet assigned)",
        userId,
        cancelled,
      },
      `Emergency stop: plan execution ${cancelled ? "cancelled" : "not found"}`,
    );

    return c.json({ success: cancelled });
  },
);

export { chatPlanExecute };
