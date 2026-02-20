// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import { PLAN_QUOTAS, MODEL_PRICING, calculateCallCost } from './constants.js';
import type { ModelName, PlanId } from './types.js';

describe('PLAN_QUOTAS', () => {
  it('defines quotas for all four plans', () => {
    const plans: PlanId[] = ['free', 'pro', 'team', 'enterprise'];
    for (const plan of plans) {
      expect(PLAN_QUOTAS[plan]).toBeDefined();
    }
  });

  it('free plan has 100 calls hard limit and no soft limit', () => {
    expect(PLAN_QUOTAS.free.maxCalls).toBe(100);
    expect(PLAN_QUOTAS.free.softLimit).toBeUndefined();
  });

  it('pro plan has 2000 calls and $50 soft limit', () => {
    expect(PLAN_QUOTAS.pro.maxCalls).toBe(2000);
    expect(PLAN_QUOTAS.pro.softLimit).toBe(50);
  });

  it('team plan has no call limit and $200 soft limit', () => {
    expect(PLAN_QUOTAS.team.maxCalls).toBeUndefined();
    expect(PLAN_QUOTAS.team.softLimit).toBe(200);
  });

  it('enterprise plan has no call limit and $1000 soft limit', () => {
    expect(PLAN_QUOTAS.enterprise.maxCalls).toBeUndefined();
    expect(PLAN_QUOTAS.enterprise.softLimit).toBe(1000);
  });
});

describe('MODEL_PRICING', () => {
  it('defines pricing for all three models', () => {
    const models: ModelName[] = ['claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-6'];
    for (const model of models) {
      expect(MODEL_PRICING[model]).toBeDefined();
      expect(MODEL_PRICING[model].inputPerMTok).toBeGreaterThan(0);
      expect(MODEL_PRICING[model].outputPerMTok).toBeGreaterThan(0);
      expect(MODEL_PRICING[model].relativeCost).toBeGreaterThan(0);
      expect(MODEL_PRICING[model].useCase).toBeTruthy();
    }
  });

  it('haiku pricing matches Anthropic rates', () => {
    expect(MODEL_PRICING['claude-haiku-4-5'].inputPerMTok).toBe(0.25);
    expect(MODEL_PRICING['claude-haiku-4-5'].outputPerMTok).toBe(1.25);
    expect(MODEL_PRICING['claude-haiku-4-5'].relativeCost).toBe(1);
  });

  it('sonnet pricing matches Anthropic rates', () => {
    expect(MODEL_PRICING['claude-sonnet-4-5'].inputPerMTok).toBe(3.0);
    expect(MODEL_PRICING['claude-sonnet-4-5'].outputPerMTok).toBe(15.0);
    expect(MODEL_PRICING['claude-sonnet-4-5'].relativeCost).toBe(12);
  });

  it('opus pricing matches Anthropic rates', () => {
    expect(MODEL_PRICING['claude-opus-4-6'].inputPerMTok).toBe(15.0);
    expect(MODEL_PRICING['claude-opus-4-6'].outputPerMTok).toBe(75.0);
    expect(MODEL_PRICING['claude-opus-4-6'].relativeCost).toBe(60);
  });

  it('relative costs are ordered haiku < sonnet < opus', () => {
    expect(MODEL_PRICING['claude-haiku-4-5'].relativeCost)
      .toBeLessThan(MODEL_PRICING['claude-sonnet-4-5'].relativeCost);
    expect(MODEL_PRICING['claude-sonnet-4-5'].relativeCost)
      .toBeLessThan(MODEL_PRICING['claude-opus-4-6'].relativeCost);
  });
});

describe('calculateCallCost', () => {
  it('returns 0 for zero tokens', () => {
    expect(calculateCallCost('claude-haiku-4-5', 0, 0)).toBe(0);
  });

  it('calculates haiku cost correctly for typical conversation', () => {
    // 5500 input + 1500 output → $0.001375 + $0.001875 = $0.00325
    const cost = calculateCallCost('claude-haiku-4-5', 5500, 1500);
    expect(cost).toBeCloseTo(0.00325, 6);
  });

  it('calculates sonnet cost correctly for typical conversation', () => {
    // 5500 input + 1500 output → $0.0165 + $0.0225 = $0.039
    const cost = calculateCallCost('claude-sonnet-4-5', 5500, 1500);
    expect(cost).toBeCloseTo(0.039, 6);
  });

  it('calculates opus cost correctly for typical conversation', () => {
    // 5500 input + 1500 output → $0.0825 + $0.1125 = $0.195
    const cost = calculateCallCost('claude-opus-4-6', 5500, 1500);
    expect(cost).toBeCloseTo(0.195, 6);
  });

  it('handles input-only calls', () => {
    const cost = calculateCallCost('claude-haiku-4-5', 1_000_000, 0);
    expect(cost).toBeCloseTo(0.25, 6);
  });

  it('handles output-only calls', () => {
    const cost = calculateCallCost('claude-haiku-4-5', 0, 1_000_000);
    expect(cost).toBeCloseTo(1.25, 6);
  });

  it('scales linearly with token count', () => {
    const cost1 = calculateCallCost('claude-sonnet-4-5', 1000, 500);
    const cost2 = calculateCallCost('claude-sonnet-4-5', 2000, 1000);
    expect(cost2).toBeCloseTo(cost1 * 2, 10);
  });
});
