// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Command Approval Event Bus — pub/sub for real-time approval notifications.
 *
 * Emits events when approvals are created or decided, consumed by SSE streams.
 *
 * @module core/approvals/event-bus
 */

import { EventEmitter } from "node:events";
import type { CommandApproval } from "../../db/repositories/command-approval-repository.js";

// ============================================================================
// Event Types
// ============================================================================

export interface ApprovalCreatedEvent {
  userId: string;
  approval: CommandApproval;
}

export interface ApprovalDecidedEvent {
  userId: string;
  approval: CommandApproval;
}

// ============================================================================
// Event Bus
// ============================================================================

export class ApprovalEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100); // Support many concurrent SSE connections
  }

  emitApprovalCreated(event: ApprovalCreatedEvent): void {
    this.emit("approval.created", event);
  }

  emitApprovalDecided(event: ApprovalDecidedEvent): void {
    this.emit("approval.decided", event);
  }

  onApprovalCreated(
    handler: (event: ApprovalCreatedEvent) => void | Promise<void>,
  ): void {
    this.on("approval.created", handler);
  }

  onApprovalDecided(
    handler: (event: ApprovalDecidedEvent) => void | Promise<void>,
  ): void {
    this.on("approval.decided", handler);
  }

  removeApprovalCreatedListener(
    handler: (event: ApprovalCreatedEvent) => void | Promise<void>,
  ): void {
    this.off("approval.created", handler);
  }

  removeApprovalDecidedListener(
    handler: (event: ApprovalDecidedEvent) => void | Promise<void>,
  ): void {
    this.off("approval.decided", handler);
  }
}

// ============================================================================
// Singleton
// ============================================================================

let eventBusInstance: ApprovalEventBus | null = null;

export function getApprovalEventBus(): ApprovalEventBus {
  if (!eventBusInstance) {
    eventBusInstance = new ApprovalEventBus();
  }
  return eventBusInstance;
}

export function _resetApprovalEventBus(): void {
  if (eventBusInstance) {
    eventBusInstance.removeAllListeners();
  }
  eventBusInstance = null;
}
