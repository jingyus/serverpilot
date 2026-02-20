// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeAll } from 'vitest';
import { PLANS } from './index.js';
import type { BillingPlan } from './index.js';

describe('PLANS', () => {
  it('defines exactly four plans', () => {
    expect(PLANS).toHaveLength(4);
  });

  it('plans are ordered: free, pro, team, enterprise', () => {
    expect(PLANS[0].id).toBe('free');
    expect(PLANS[1].id).toBe('pro');
    expect(PLANS[2].id).toBe('team');
    expect(PLANS[3].id).toBe('enterprise');
  });

  it('plan IDs are unique', () => {
    const ids = PLANS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe('free plan', () => {
    let plan: BillingPlan;
    beforeAll(() => { plan = PLANS.find((p) => p.id === 'free')!; });

    it('costs $0/month', () => {
      expect(plan.monthlyPrice).toBe(0);
    });

    it('allows 100 AI calls per month', () => {
      expect(plan.aiCallsPerMonth).toBe(100);
    });

    it('limits servers and users to 1', () => {
      expect(plan.maxServers).toBe(1);
      expect(plan.maxUsers).toBe(1);
    });
  });

  describe('pro plan', () => {
    let plan: BillingPlan;
    beforeAll(() => { plan = PLANS.find((p) => p.id === 'pro')!; });

    it('costs $19/month', () => {
      expect(plan.monthlyPrice).toBe(19);
    });

    it('allows 2000 AI calls per month', () => {
      expect(plan.aiCallsPerMonth).toBe(2000);
    });

    it('allows 10 servers and 5 users', () => {
      expect(plan.maxServers).toBe(10);
      expect(plan.maxUsers).toBe(5);
    });
  });

  describe('team plan', () => {
    let plan: BillingPlan;
    beforeAll(() => { plan = PLANS.find((p) => p.id === 'team')!; });

    it('costs $49/month', () => {
      expect(plan.monthlyPrice).toBe(49);
    });

    it('has unlimited AI calls', () => {
      expect(plan.aiCallsPerMonth).toBe(-1);
    });

    it('has unlimited servers and users', () => {
      expect(plan.maxServers).toBe(-1);
      expect(plan.maxUsers).toBe(-1);
    });
  });

  describe('enterprise plan', () => {
    let plan: BillingPlan;
    beforeAll(() => { plan = PLANS.find((p) => p.id === 'enterprise')!; });

    it('costs $199/month', () => {
      expect(plan.monthlyPrice).toBe(199);
    });

    it('has unlimited AI calls', () => {
      expect(plan.aiCallsPerMonth).toBe(-1);
    });

    it('has unlimited servers and users', () => {
      expect(plan.maxServers).toBe(-1);
      expect(plan.maxUsers).toBe(-1);
    });
  });

  it('prices increase with plan tier', () => {
    for (let i = 1; i < PLANS.length; i++) {
      expect(PLANS[i].monthlyPrice).toBeGreaterThan(PLANS[i - 1].monthlyPrice);
    }
  });

  it('every plan has at least one feature', () => {
    for (const plan of PLANS) {
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });
});
