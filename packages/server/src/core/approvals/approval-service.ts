// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Command Approval Service — handles dangerous command approval workflow.
 *
 * Orchestrates approval creation, waiting for user decision, and cleanup.
 *
 * @module core/approvals/approval-service
 */

import { EventEmitter } from "node:events";
import {
  getCommandApprovalRepository,
  type CommandApprovalRepository,
  type CreateCommandApprovalInput,
  type CommandApproval,
} from "../../db/repositories/command-approval-repository.js";
import { createContextLogger } from "../../utils/logger.js";
import { getApprovalEventBus } from "./event-bus.js";

const logger = createContextLogger({ module: "approval-service" });

// ============================================================================
// Types
// ============================================================================

export interface ApprovalCheckInput {
  userId: string;
  serverId: string;
  command: string;
  riskLevel: "green" | "yellow" | "red" | "critical" | "forbidden";
  reason?: string;
  warnings?: string[];
  executionContext?: {
    taskId?: string;
    operationId?: string;
    sessionId?: string;
    chatMessageId?: string;
  };
}

export interface ApprovalCheckResult {
  required: boolean;
  approved: boolean;
  approvalId?: string;
  error?: string;
}

// ============================================================================
// Approval Service
// ============================================================================

export class CommandApprovalService {
  private repo: CommandApprovalRepository;
  private pendingApprovals = new Map<string, EventEmitter>();

  constructor(repo?: CommandApprovalRepository) {
    this.repo = repo ?? getCommandApprovalRepository();

    // Listen for approval decisions
    const eventBus = getApprovalEventBus();
    eventBus.on("approval.decided", (event) => {
      const emitter = this.pendingApprovals.get(event.approval.id);
      if (emitter) {
        emitter.emit("decided", event.approval);
        this.pendingApprovals.delete(event.approval.id);
      }
    });
  }

  /**
   * Check if a command requires approval and wait for user decision if needed.
   *
   * @returns approval check result with `approved` flag
   */
  async checkApproval(input: ApprovalCheckInput): Promise<ApprovalCheckResult> {
    // FORBIDDEN commands should never reach here (rejected by validator)
    if (input.riskLevel === "forbidden") {
      return {
        required: true,
        approved: false,
        error: "Forbidden command cannot be approved",
      };
    }

    // Only RED and CRITICAL require approval
    if (input.riskLevel !== "red" && input.riskLevel !== "critical") {
      return { required: false, approved: true };
    }

    logger.info(
      {
        serverId: input.serverId,
        command: input.command,
        riskLevel: input.riskLevel,
      },
      "Command requires approval",
    );

    // Create approval request
    const approval = await this.repo.create({
      userId: input.userId,
      serverId: input.serverId,
      command: input.command,
      riskLevel: input.riskLevel,
      reason: input.reason,
      warnings: input.warnings,
      executionContext: input.executionContext,
      expiryMinutes: 5,
    });

    // Emit event for SSE subscribers
    const eventBus = getApprovalEventBus();
    eventBus.emit("approval.created", { userId: input.userId, approval });

    logger.info(
      { approvalId: approval.id },
      "Waiting for user approval decision",
    );

    // Wait for approval decision
    const decision = await this.waitForDecision(approval.id, 5 * 60 * 1000); // 5 minutes

    if (decision === "approved") {
      logger.info({ approvalId: approval.id }, "Command approved by user");
      return { required: true, approved: true, approvalId: approval.id };
    } else if (decision === "rejected") {
      logger.info({ approvalId: approval.id }, "Command rejected by user");
      return {
        required: true,
        approved: false,
        approvalId: approval.id,
        error: "Command rejected by user",
      };
    } else {
      // Expired
      logger.warn({ approvalId: approval.id }, "Approval request expired");
      await this.repo.expireOldApprovals();
      return {
        required: true,
        approved: false,
        approvalId: approval.id,
        error: "Approval request expired",
      };
    }
  }

  /**
   * Wait for user to approve/reject or for timeout.
   */
  private waitForDecision(
    approvalId: string,
    timeoutMs: number,
  ): Promise<"approved" | "rejected" | "expired"> {
    return new Promise((resolve) => {
      const emitter = new EventEmitter();
      this.pendingApprovals.set(approvalId, emitter);

      const timeout = setTimeout(() => {
        emitter.removeAllListeners();
        this.pendingApprovals.delete(approvalId);
        resolve("expired");
      }, timeoutMs);

      emitter.once("decided", (approval: CommandApproval) => {
        clearTimeout(timeout);
        this.pendingApprovals.delete(approvalId);

        if (approval.status === "approved") {
          resolve("approved");
        } else if (approval.status === "rejected") {
          resolve("rejected");
        } else {
          resolve("expired");
        }
      });
    });
  }

  /**
   * Clean up expired approvals (called periodically by background job).
   */
  async cleanupExpiredApprovals(): Promise<number> {
    const expiredCount = await this.repo.expireOldApprovals();
    if (expiredCount > 0) {
      logger.info({ count: expiredCount }, "Expired old approval requests");
    }
    return expiredCount;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let serviceInstance: CommandApprovalService | null = null;

export function getCommandApprovalService(): CommandApprovalService {
  if (!serviceInstance) {
    serviceInstance = new CommandApprovalService();
  }
  return serviceInstance;
}

export function setCommandApprovalService(
  service: CommandApprovalService,
): void {
  serviceInstance = service;
}

export function _resetCommandApprovalService(): void {
  serviceInstance = null;
}
