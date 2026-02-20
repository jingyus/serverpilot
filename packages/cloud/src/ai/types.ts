// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI quota management type definitions.
 *
 * @module cloud/ai/types
 */

/** Claude model identifiers used for routing and pricing. */
export type ModelName = 'claude-haiku-4-5' | 'claude-sonnet-4-5' | 'claude-opus-4-6';

/** Billing plan identifiers. */
export type PlanId = 'free' | 'pro' | 'team' | 'enterprise';

/** Per-model pricing in dollars per million tokens. */
export interface ModelPriceEntry {
  /** Cost per million input tokens (USD). */
  inputPerMTok: number;
  /** Cost per million output tokens (USD). */
  outputPerMTok: number;
  /** Relative cost multiplier compared to the cheapest model. */
  relativeCost: number;
  /** Human-readable description of ideal use case. */
  useCase: string;
}

/** Quota limits for a specific plan. */
export interface PlanQuota {
  /** Hard call limit per month (undefined = unlimited). */
  maxCalls?: number;
  /** Soft spending limit per month in USD (undefined = no soft limit). */
  softLimit?: number;
}

/** Result of a quota check. */
export interface QuotaCheckResult {
  /** Whether the AI call is allowed to proceed. */
  allowed: boolean;
  /** Remaining calls (for hard-limited plans) or remaining budget in USD (for soft-limited plans). */
  remaining: number;
  /** Human-readable denial reason (set when allowed = false). */
  reason?: string;
  /** URL to redirect user for plan upgrade (set when allowed = false). */
  upgradeUrl?: string;
}

/** Metrics recorded for a single AI call. */
export interface AICallMetrics {
  /** Tenant the user belongs to. */
  tenantId: string;
  /** Model used for the call. */
  model: ModelName;
  /** Number of input tokens consumed. */
  inputTokens: number;
  /** Number of output tokens generated. */
  outputTokens: number;
}

/** Aggregated quota status for dashboard display. */
export interface QuotaStatus {
  /** Current billing plan. */
  plan: PlanId;
  /** Number of AI calls used this month. */
  usedCalls: number;
  /** Maximum calls allowed (undefined = unlimited). */
  maxCalls?: number;
  /** Total AI spending this month in USD. */
  usedCostUsd: number;
  /** Soft spending limit in USD (undefined = no limit). */
  softLimitUsd?: number;
  /** Start of the current billing period (UTC). */
  periodStart: Date;
  /** End of the current billing period (UTC). */
  periodEnd: Date;
}

/** Context passed to the model router for routing decisions. */
export interface RoutingContext {
  /** The command being executed (if any). */
  command?: string;
  /** Risk level of the operation. */
  riskLevel?: 'green' | 'yellow' | 'red' | 'critical';
  /** Number of messages in the current conversation. */
  conversationLength: number;
  /** User's billing plan. */
  userPlan: PlanId;
  /** Whether the user explicitly requests the strongest model. */
  forceOpus?: boolean;
  /** Whether this is a knowledge-base retrieval query. */
  isKnowledgeQuery?: boolean;
}
