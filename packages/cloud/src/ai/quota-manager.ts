// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI Quota Manager — enforces per-plan usage limits.
 *
 * - Free users: 100 calls/month hard limit (429 on exceed).
 * - Paid users: soft spending limits (warning only, never blocked).
 *
 * Uses dependency-injected data access so the manager can be tested
 * without a real PostgreSQL connection.
 *
 * @module cloud/ai/quota-manager
 */

import { PLAN_QUOTAS, MODEL_PRICING, calculateCallCost } from './constants.js';
import type {
  AICallMetrics,
  ModelName,
  PlanId,
  QuotaCheckResult,
  QuotaStatus,
} from './types.js';

// ---------------------------------------------------------------------------
// Data-access interface (injected at construction)
// ---------------------------------------------------------------------------

/** Record stored in the ai_usage table. */
export interface AIUsageRecord {
  id: number;
  userId: string;
  tenantId: string;
  model: ModelName;
  inputTokens: number;
  outputTokens: number;
  cost: string; // numeric column → string from PG
  createdAt: Date;
}

/** Minimal data-access layer the quota manager needs. */
export interface QuotaDataAccess {
  /** Return the plan id for a given tenant. */
  getTenantPlan(tenantId: string): Promise<PlanId | null>;

  /** Count AI usage rows for a user since `since`. */
  getCallCount(userId: string, since: Date): Promise<number>;

  /** Sum the `cost` column for a user since `since`. */
  getTotalCost(userId: string, since: Date): Promise<number>;

  /** Insert a new AI usage record and return its id. */
  insertUsage(record: Omit<AIUsageRecord, 'id' | 'createdAt'>): Promise<number>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the first millisecond of the current UTC month. */
export function startOfMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Return the first millisecond of the next UTC month. */
export function endOfMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// ---------------------------------------------------------------------------
// Warning log callback (replaceable for testing)
// ---------------------------------------------------------------------------

export type WarningCallback = (
  userId: string,
  plan: PlanId,
  usedCost: number,
  softLimit: number,
) => void;

const defaultWarningCallback: WarningCallback = (userId, plan, usedCost, softLimit) => {
  // eslint-disable-next-line no-console
  console.warn(
    `[AIQuota] User ${userId} on "${plan}" plan exceeded soft limit: $${usedCost.toFixed(4)} / $${softLimit}`,
  );
};

// ---------------------------------------------------------------------------
// AIQuotaManager
// ---------------------------------------------------------------------------

export class AIQuotaManager {
  private readonly data: QuotaDataAccess;
  private onWarning: WarningCallback;

  constructor(data: QuotaDataAccess, onWarning?: WarningCallback) {
    this.data = data;
    this.onWarning = onWarning ?? defaultWarningCallback;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Check whether a user is allowed to make another AI call.
   *
   * - **Free plan**: hard limit — returns `allowed: false` when exceeded.
   * - **Paid plans**: soft limit — always `allowed: true`, warning on excess.
   */
  async checkQuota(userId: string, tenantId: string): Promise<QuotaCheckResult> {
    const plan = await this.data.getTenantPlan(tenantId);
    if (!plan) {
      return { allowed: false, remaining: 0, reason: 'Tenant not found' };
    }

    const quota = PLAN_QUOTAS[plan];
    const monthStart = startOfMonth();

    // --- Free plan: hard call limit ---
    if (quota.maxCalls !== undefined && quota.softLimit === undefined) {
      const used = await this.data.getCallCount(userId, monthStart);
      const remaining = Math.max(0, quota.maxCalls - used);

      if (remaining <= 0) {
        return {
          allowed: false,
          remaining: 0,
          reason: `Free plan limit reached (${quota.maxCalls} calls/month). Upgrade to Pro for more.`,
          upgradeUrl: '/billing?upgrade=pro',
        };
      }

      return { allowed: true, remaining };
    }

    // --- Pro plan: hard call limit + soft spending limit ---
    if (quota.maxCalls !== undefined && quota.softLimit !== undefined) {
      const used = await this.data.getCallCount(userId, monthStart);
      const remaining = Math.max(0, quota.maxCalls - used);

      if (remaining <= 0) {
        // Pro has a hard call limit too — check cost-based soft limit for warning only
        const usedCost = await this.data.getTotalCost(userId, monthStart);
        if (usedCost > quota.softLimit) {
          this.onWarning(userId, plan, usedCost, quota.softLimit);
        }
        return {
          allowed: true,
          remaining: 0,
        };
      }

      // Check soft spending limit for warning
      const usedCost = await this.data.getTotalCost(userId, monthStart);
      if (quota.softLimit !== undefined && usedCost > quota.softLimit) {
        this.onWarning(userId, plan, usedCost, quota.softLimit);
      }

      return { allowed: true, remaining };
    }

    // --- Team / Enterprise: soft spending limit only ---
    if (quota.softLimit !== undefined) {
      const usedCost = await this.data.getTotalCost(userId, monthStart);
      const remaining = Math.max(0, quota.softLimit - usedCost);

      if (usedCost > quota.softLimit) {
        this.onWarning(userId, plan, usedCost, quota.softLimit);
      }

      return { allowed: true, remaining };
    }

    // Fallback: no limits configured
    return { allowed: true, remaining: Infinity };
  }

  /**
   * Record an AI call and persist it to the database.
   *
   * Returns the computed cost of the call in USD.
   */
  async trackAICall(userId: string, call: AICallMetrics): Promise<number> {
    const cost = calculateCallCost(call.model, call.inputTokens, call.outputTokens);

    await this.data.insertUsage({
      userId,
      tenantId: call.tenantId,
      model: call.model,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      cost: cost.toFixed(6),
    });

    return cost;
  }

  /**
   * Get the number of AI calls a user has made this month.
   */
  async getMonthlyCallCount(userId: string): Promise<number> {
    return this.data.getCallCount(userId, startOfMonth());
  }

  /**
   * Get the total AI spending for a user this month (USD).
   */
  async getMonthlyCost(userId: string): Promise<number> {
    return this.data.getTotalCost(userId, startOfMonth());
  }

  /**
   * Calculate the cost of a single AI call without recording it.
   */
  calculateCost(model: ModelName, inputTokens: number, outputTokens: number): number {
    return calculateCallCost(model, inputTokens, outputTokens);
  }

  /**
   * Build a full quota status snapshot for dashboard display.
   */
  async getQuotaStatus(userId: string, tenantId: string): Promise<QuotaStatus | null> {
    const plan = await this.data.getTenantPlan(tenantId);
    if (!plan) return null;

    const quota = PLAN_QUOTAS[plan];
    const now = new Date();
    const periodStart = startOfMonth(now);
    const periodEnd = endOfMonth(now);

    const [usedCalls, usedCostUsd] = await Promise.all([
      this.data.getCallCount(userId, periodStart),
      this.data.getTotalCost(userId, periodStart),
    ]);

    return {
      plan,
      usedCalls,
      maxCalls: quota.maxCalls,
      usedCostUsd,
      softLimitUsd: quota.softLimit,
      periodStart,
      periodEnd,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: AIQuotaManager | null = null;

/** Get or create the singleton AIQuotaManager. */
export function getAIQuotaManager(): AIQuotaManager {
  if (!instance) {
    throw new Error('AIQuotaManager not initialized — call setAIQuotaManager() first');
  }
  return instance;
}

/** Set the singleton AIQuotaManager instance. */
export function setAIQuotaManager(manager: AIQuotaManager): void {
  instance = manager;
}

/** Reset the singleton (for testing). */
export function _resetAIQuotaManager(): void {
  instance = null;
}
