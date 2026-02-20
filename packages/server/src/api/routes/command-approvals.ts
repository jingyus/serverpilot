// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Command Approval routes — dangerous command approval workflow.
 *
 * Handles creation, approval, rejection of dangerous command requests.
 * Provides SSE stream for real-time approval notifications.
 *
 * @module api/routes/command-approvals
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRole, requirePermission } from "../middleware/rbac.js";
import { ApiError } from "../middleware/error-handler.js";
import { getCommandApprovalRepository } from "../../db/repositories/command-approval-repository.js";
import { getApprovalEventBus } from "../../core/approvals/event-bus.js";
import { logger } from "../../utils/logger.js";
import type { CreateCommandApprovalInput } from "../../db/repositories/command-approval-repository.js";
import type { ApiEnv } from "./types.js";

const commandApprovalsRoute = new Hono<ApiEnv>();

// All routes require authentication
commandApprovalsRoute.use("*", requireAuth, resolveRole);

// ============================================================================
// Validation Schemas
// ============================================================================

const CreateApprovalBodySchema = z.object({
  serverId: z.string().min(1),
  command: z.string().min(1),
  riskLevel: z.enum(["red", "critical", "forbidden"]),
  reason: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  executionContext: z
    .object({
      taskId: z.string().optional(),
      operationId: z.string().optional(),
      sessionId: z.string().optional(),
      chatMessageId: z.string().optional(),
    })
    .optional(),
});

const ApprovalQuerySchema = z.object({
  serverId: z.string().optional(),
  status: z.enum(["pending", "approved", "rejected", "expired"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const ApprovalDecisionBodySchema = z.object({
  decision: z.enum(["approve", "reject"]),
});

type CreateApprovalBody = z.infer<typeof CreateApprovalBodySchema>;
type ApprovalQuery = z.infer<typeof ApprovalQuerySchema>;
type ApprovalDecisionBody = z.infer<typeof ApprovalDecisionBodySchema>;

// ============================================================================
// POST /approvals — Create approval request
// ============================================================================

commandApprovalsRoute.post(
  "/",
  requirePermission("command:approve"),
  validateBody(CreateApprovalBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const body = c.get("validatedBody") as CreateApprovalBody;
    const repo = getCommandApprovalRepository();

    const input: CreateCommandApprovalInput = {
      userId,
      serverId: body.serverId,
      command: body.command,
      riskLevel: body.riskLevel,
      reason: body.reason,
      warnings: body.warnings,
      executionContext: body.executionContext,
      expiryMinutes: 5,
    };

    const approval = await repo.create(input);

    // Emit event for SSE subscribers
    const eventBus = getApprovalEventBus();
    eventBus.emit("approval.created", { userId, approval });

    logger.info(
      {
        approvalId: approval.id,
        serverId: body.serverId,
        riskLevel: body.riskLevel,
      },
      "Command approval requested",
    );

    return c.json({ approval });
  },
);

// ============================================================================
// GET /approvals — List user's approval requests
// ============================================================================

commandApprovalsRoute.get(
  "/",
  requirePermission("command:approve"),
  validateQuery(ApprovalQuerySchema),
  async (c) => {
    const userId = c.get("userId");
    const query = c.get("validatedQuery") as ApprovalQuery;
    const repo = getCommandApprovalRepository();

    const approvals = await repo.findByUser(userId, {
      serverId: query.serverId,
      status: query.status,
      limit: query.limit,
    });

    return c.json({ approvals, total: approvals.length });
  },
);

// ============================================================================
// GET /approvals/pending — Get pending approvals for user
// ============================================================================

commandApprovalsRoute.get(
  "/pending",
  requirePermission("command:approve"),
  async (c) => {
    const userId = c.get("userId");
    const repo = getCommandApprovalRepository();

    const approvals = await repo.findPending(userId);

    return c.json({ approvals, total: approvals.length });
  },
);

// ============================================================================
// GET /approvals/:id — Get specific approval
// ============================================================================

commandApprovalsRoute.get(
  "/:id",
  requirePermission("command:approve"),
  async (c) => {
    const userId = c.get("userId");
    const approvalId = c.req.param("id");
    const repo = getCommandApprovalRepository();

    const approval = await repo.findById(approvalId);
    if (!approval) {
      throw ApiError.notFound("Approval");
    }

    // Verify ownership
    if (approval.userId !== userId) {
      throw ApiError.forbidden("Not authorized to view this approval");
    }

    return c.json({ approval });
  },
);

// ============================================================================
// POST /approvals/:id/decide — Approve or reject
// ============================================================================

commandApprovalsRoute.post(
  "/:id/decide",
  requirePermission("command:approve"),
  validateBody(ApprovalDecisionBodySchema),
  async (c) => {
    const userId = c.get("userId");
    const approvalId = c.req.param("id");
    const body = c.get("validatedBody") as ApprovalDecisionBody;
    const repo = getCommandApprovalRepository();

    // Verify approval exists and user owns it
    const approval = await repo.findById(approvalId);
    if (!approval) {
      throw ApiError.notFound("Approval");
    }

    if (approval.userId !== userId) {
      throw ApiError.forbidden("Not authorized to decide this approval");
    }

    if (approval.status !== "pending") {
      throw ApiError.badRequest(`Approval already ${approval.status}`);
    }

    // Check if expired
    if (new Date(approval.expiresAt).getTime() <= Date.now()) {
      await repo.expireOldApprovals(); // Clean up
      throw ApiError.badRequest("Approval has expired");
    }

    // Apply decision
    const updatedApproval =
      body.decision === "approve"
        ? await repo.approve(approvalId, userId)
        : await repo.reject(approvalId, userId);

    // Emit event for waiting executors
    const eventBus = getApprovalEventBus();
    eventBus.emit("approval.decided", { userId, approval: updatedApproval });

    logger.info(
      { approvalId, decision: body.decision, serverId: approval.serverId },
      "Command approval decided",
    );

    return c.json({ approval: updatedApproval });
  },
);

// ============================================================================
// GET /approvals/stream — SSE stream for real-time notifications
// ============================================================================

commandApprovalsRoute.get(
  "/stream",
  requirePermission("command:approve"),
  async (c) => {
    const userId = c.get("userId");
    const eventBus = getApprovalEventBus();

    return streamSSE(c, async (stream) => {
      // Send initial connection event
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ status: "connected" }),
      });

      // Setup event listeners
      const onApprovalCreated = async (data: {
        userId: string;
        approval: unknown;
      }) => {
        if (data.userId === userId) {
          await stream.writeSSE({
            event: "approval",
            data: JSON.stringify(data.approval),
          });
        }
      };

      const onApprovalDecided = async (data: {
        userId: string;
        approval: unknown;
      }) => {
        if (data.userId === userId) {
          await stream.writeSSE({
            event: "decision",
            data: JSON.stringify(data.approval),
          });
        }
      };

      eventBus.on("approval.created", onApprovalCreated);
      eventBus.on("approval.decided", onApprovalDecided);

      // Periodic ping to keep connection alive
      const pingInterval = setInterval(async () => {
        try {
          await stream.writeSSE({
            event: "ping",
            data: JSON.stringify({ timestamp: new Date().toISOString() }),
          });
        } catch (err) {
          clearInterval(pingInterval);
        }
      }, 30000); // 30 seconds

      // Cleanup on disconnect
      stream.onAbort(() => {
        eventBus.off("approval.created", onApprovalCreated);
        eventBus.off("approval.decided", onApprovalDecided);
        clearInterval(pingInterval);
        logger.debug({ userId }, "Approval SSE stream closed");
      });

      // Keep the stream open until client disconnects
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    });
  },
);

export default commandApprovalsRoute;
