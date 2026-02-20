// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Intelligent Model Router — selects the optimal Claude model per request.
 *
 * Routing priority (first match wins):
 *  1. Enterprise user with forceOpus → Opus
 *  2. Critical / high risk operation → Opus
 *  3. Knowledge-base retrieval query → Haiku
 *  4. Simple query (short conversation, no command) → Haiku
 *  5. Default → Sonnet
 *
 * Every routing decision is logged to `ai_routing_logs` for cost analytics.
 *
 * @module cloud/ai/model-router
 */

import type { ModelName, PlanId, RoutingContext } from './types.js';

// ---------------------------------------------------------------------------
// Data-access interface (injected at construction)
// ---------------------------------------------------------------------------

/** Minimal data-access layer the model router needs for logging. */
export interface RoutingDataAccess {
  /** Insert a routing decision log and return its id. */
  insertRoutingLog(record: {
    userId: string;
    tenantId: string;
    command: string | null;
    riskLevel: string | null;
    conversationLength: number;
    selectedModel: ModelName;
    actualCost: string;
  }): Promise<number>;
}

// ---------------------------------------------------------------------------
// Routing decision result
// ---------------------------------------------------------------------------

/** Result returned by `selectModel()`. */
export interface RoutingDecision {
  /** The selected model identifier. */
  model: ModelName;
  /** Human-readable reason for the routing decision. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Conversation length threshold: conversations with fewer messages are "short". */
const SHORT_CONVERSATION_THRESHOLD = 3;

/** Risk levels that require the most capable model. */
const HIGH_RISK_LEVELS: ReadonlySet<string> = new Set(['high', 'critical']);

// ---------------------------------------------------------------------------
// ModelRouter
// ---------------------------------------------------------------------------

export class ModelRouter {
  private readonly data: RoutingDataAccess;

  constructor(data: RoutingDataAccess) {
    this.data = data;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Select the optimal model for a given routing context.
   *
   * Rules are evaluated top-to-bottom; first match wins.
   */
  selectModel(context: RoutingContext): RoutingDecision {
    // 1. Enterprise + forceOpus → Opus
    if (context.forceOpus && context.userPlan === 'enterprise') {
      return { model: 'claude-opus-4-6', reason: 'Enterprise user requested Opus' };
    }

    // 2. Critical / high risk → Opus
    if (context.riskLevel && HIGH_RISK_LEVELS.has(context.riskLevel)) {
      return {
        model: 'claude-opus-4-6',
        reason: `High-risk operation (${context.riskLevel})`,
      };
    }

    // 3. Knowledge-base retrieval → Haiku
    if (context.isKnowledgeQuery) {
      return { model: 'claude-haiku-4-5', reason: 'Knowledge-base retrieval query' };
    }

    // 4. Simple query: short conversation and no command → Haiku
    if (context.conversationLength < SHORT_CONVERSATION_THRESHOLD && !context.command) {
      return { model: 'claude-haiku-4-5', reason: 'Simple query (short conversation, no command)' };
    }

    // 5. Default → Sonnet
    return { model: 'claude-sonnet-4-5', reason: 'Default routing' };
  }

  /**
   * Log a routing decision to the `ai_routing_logs` table.
   */
  async logRoutingDecision(
    userId: string,
    tenantId: string,
    context: RoutingContext,
    selectedModel: ModelName,
    actualCost: number,
  ): Promise<number> {
    return this.data.insertRoutingLog({
      userId,
      tenantId,
      command: context.command ?? null,
      riskLevel: context.riskLevel ?? null,
      conversationLength: context.conversationLength,
      selectedModel,
      actualCost: actualCost.toFixed(6),
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: ModelRouter | null = null;

/** Get the singleton ModelRouter. */
export function getModelRouter(): ModelRouter {
  if (!instance) {
    throw new Error('ModelRouter not initialized — call setModelRouter() first');
  }
  return instance;
}

/** Set the singleton ModelRouter instance. */
export function setModelRouter(router: ModelRouter): void {
  instance = router;
}

/** Reset the singleton (for testing). */
export function _resetModelRouter(): void {
  instance = null;
}
