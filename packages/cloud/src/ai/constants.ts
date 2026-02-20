// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * AI quota and model pricing constants.
 *
 * Values sourced from the Cloud pricing guide (docs/云服务开发指南.md):
 * - Free:       $0/mo, 100 calls/month (hard limit)
 * - Pro:        $19/mo, 2000 calls/month (soft), $50/mo spend cap
 * - Team:       $49/mo, unlimited (fair-use 5000/mo avg), $200/mo spend cap
 * - Enterprise: $199/mo, unlimited + dedicated model, $1000/mo spend cap
 *
 * Model pricing follows Anthropic Claude 4.5/4.6 public rates.
 *
 * @module cloud/ai/constants
 */

import type { ModelName, ModelPriceEntry, PlanId, PlanQuota } from './types.js';

/**
 * Per-plan AI quota configuration.
 *
 * - `maxCalls`: hard monthly call limit (Free only).
 * - `softLimit`: monthly USD spend threshold that triggers a warning
 *   but does NOT block requests (paid plans only).
 */
export const PLAN_QUOTAS: Record<PlanId, PlanQuota> = {
  free: {
    maxCalls: 100,
  },
  pro: {
    maxCalls: 2000,
    softLimit: 50,
  },
  team: {
    softLimit: 200,
  },
  enterprise: {
    softLimit: 1000,
  },
};

/**
 * Per-model token pricing (USD per million tokens).
 *
 * Source: Anthropic Claude pricing (as of 2026-02).
 */
export const MODEL_PRICING: Record<ModelName, ModelPriceEntry> = {
  'claude-haiku-4-5': {
    inputPerMTok: 0.25,
    outputPerMTok: 1.25,
    relativeCost: 1,
    useCase: 'Simple queries, fast responses',
  },
  'claude-sonnet-4-5': {
    inputPerMTok: 3.0,
    outputPerMTok: 15.0,
    relativeCost: 12,
    useCase: 'Complex tasks, default choice',
  },
  'claude-opus-4-6': {
    inputPerMTok: 15.0,
    outputPerMTok: 75.0,
    relativeCost: 60,
    useCase: 'Critical decisions, security audits',
  },
};

/**
 * Calculate the cost of a single AI call in USD.
 */
export function calculateCallCost(
  model: ModelName,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model];
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMTok;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMTok;
  return inputCost + outputCost;
}
