// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect } from 'vitest';
import {
  SUBSCRIPTION_STATUSES,
  PLAN_PRICE_IDS,
  PLAN_LIMITS,
  HANDLED_STRIPE_EVENTS,
  isActiveStatus,
  getPriceId,
  getPlanLimits,
} from './constants.js';
import type { SubscriptionStatus } from './constants.js';

describe('SUBSCRIPTION_STATUSES', () => {
  it('defines 5 statuses', () => {
    expect(SUBSCRIPTION_STATUSES).toHaveLength(5);
  });

  it('includes all Stripe lifecycle statuses', () => {
    expect(SUBSCRIPTION_STATUSES).toContain('incomplete');
    expect(SUBSCRIPTION_STATUSES).toContain('active');
    expect(SUBSCRIPTION_STATUSES).toContain('past_due');
    expect(SUBSCRIPTION_STATUSES).toContain('canceled');
    expect(SUBSCRIPTION_STATUSES).toContain('unpaid');
  });
});

describe('PLAN_PRICE_IDS', () => {
  it('maps pro, team, enterprise to price IDs', () => {
    expect(PLAN_PRICE_IDS.pro).toBeDefined();
    expect(PLAN_PRICE_IDS.team).toBeDefined();
    expect(PLAN_PRICE_IDS.enterprise).toBeDefined();
  });

  it('does not include free plan', () => {
    expect((PLAN_PRICE_IDS as Record<string, unknown>).free).toBeUndefined();
  });

  it('price IDs are non-empty strings', () => {
    expect(typeof PLAN_PRICE_IDS.pro).toBe('string');
    expect(PLAN_PRICE_IDS.pro.length).toBeGreaterThan(0);
    expect(typeof PLAN_PRICE_IDS.team).toBe('string');
    expect(PLAN_PRICE_IDS.team.length).toBeGreaterThan(0);
    expect(typeof PLAN_PRICE_IDS.enterprise).toBe('string');
    expect(PLAN_PRICE_IDS.enterprise.length).toBeGreaterThan(0);
  });
});

describe('PLAN_LIMITS', () => {
  it('defines limits for all 4 plans', () => {
    expect(PLAN_LIMITS.free).toBeDefined();
    expect(PLAN_LIMITS.pro).toBeDefined();
    expect(PLAN_LIMITS.team).toBeDefined();
    expect(PLAN_LIMITS.enterprise).toBeDefined();
  });

  describe('free plan limits', () => {
    it('limits servers to 1', () => {
      expect(PLAN_LIMITS.free.maxServers).toBe(1);
    });

    it('limits users to 1', () => {
      expect(PLAN_LIMITS.free.maxUsers).toBe(1);
    });

    it('limits AI calls to 100', () => {
      expect(PLAN_LIMITS.free.maxAiCalls).toBe(100);
    });

    it('has no soft limit', () => {
      expect(PLAN_LIMITS.free.softLimitUsd).toBeUndefined();
    });
  });

  describe('pro plan limits', () => {
    it('limits servers to 10', () => {
      expect(PLAN_LIMITS.pro.maxServers).toBe(10);
    });

    it('limits users to 5', () => {
      expect(PLAN_LIMITS.pro.maxUsers).toBe(5);
    });

    it('limits AI calls to 2000', () => {
      expect(PLAN_LIMITS.pro.maxAiCalls).toBe(2000);
    });

    it('has $50 soft limit', () => {
      expect(PLAN_LIMITS.pro.softLimitUsd).toBe(50);
    });
  });

  describe('team plan limits', () => {
    it('has unlimited servers', () => {
      expect(PLAN_LIMITS.team.maxServers).toBe(-1);
    });

    it('has unlimited users', () => {
      expect(PLAN_LIMITS.team.maxUsers).toBe(-1);
    });

    it('has unlimited AI calls', () => {
      expect(PLAN_LIMITS.team.maxAiCalls).toBe(-1);
    });

    it('has $200 soft limit', () => {
      expect(PLAN_LIMITS.team.softLimitUsd).toBe(200);
    });
  });

  describe('enterprise plan limits', () => {
    it('has unlimited servers', () => {
      expect(PLAN_LIMITS.enterprise.maxServers).toBe(-1);
    });

    it('has unlimited users', () => {
      expect(PLAN_LIMITS.enterprise.maxUsers).toBe(-1);
    });

    it('has unlimited AI calls', () => {
      expect(PLAN_LIMITS.enterprise.maxAiCalls).toBe(-1);
    });

    it('has $1000 soft limit', () => {
      expect(PLAN_LIMITS.enterprise.softLimitUsd).toBe(1000);
    });
  });

  it('soft limits increase with plan tier', () => {
    const softLimits = [
      PLAN_LIMITS.pro.softLimitUsd!,
      PLAN_LIMITS.team.softLimitUsd!,
      PLAN_LIMITS.enterprise.softLimitUsd!,
    ];
    for (let i = 1; i < softLimits.length; i++) {
      expect(softLimits[i]).toBeGreaterThan(softLimits[i - 1]);
    }
  });
});

describe('HANDLED_STRIPE_EVENTS', () => {
  it('defines 5 event types', () => {
    expect(HANDLED_STRIPE_EVENTS).toHaveLength(5);
  });

  it('includes subscription lifecycle events', () => {
    expect(HANDLED_STRIPE_EVENTS).toContain('customer.subscription.created');
    expect(HANDLED_STRIPE_EVENTS).toContain('customer.subscription.updated');
    expect(HANDLED_STRIPE_EVENTS).toContain('customer.subscription.deleted');
  });

  it('includes invoice events', () => {
    expect(HANDLED_STRIPE_EVENTS).toContain('invoice.payment_succeeded');
    expect(HANDLED_STRIPE_EVENTS).toContain('invoice.payment_failed');
  });
});

describe('isActiveStatus', () => {
  it('returns true for active', () => {
    expect(isActiveStatus('active')).toBe(true);
  });

  it('returns false for non-active statuses', () => {
    const nonActive: SubscriptionStatus[] = ['incomplete', 'past_due', 'canceled', 'unpaid'];
    for (const status of nonActive) {
      expect(isActiveStatus(status)).toBe(false);
    }
  });
});

describe('getPriceId', () => {
  it('returns undefined for free plan', () => {
    expect(getPriceId('free')).toBeUndefined();
  });

  it('returns a string for paid plans', () => {
    expect(typeof getPriceId('pro')).toBe('string');
    expect(typeof getPriceId('team')).toBe('string');
    expect(typeof getPriceId('enterprise')).toBe('string');
  });

  it('returns the configured price IDs', () => {
    expect(getPriceId('pro')).toBe(PLAN_PRICE_IDS.pro);
    expect(getPriceId('team')).toBe(PLAN_PRICE_IDS.team);
    expect(getPriceId('enterprise')).toBe(PLAN_PRICE_IDS.enterprise);
  });
});

describe('getPlanLimits', () => {
  it('returns limits for each plan', () => {
    for (const plan of ['free', 'pro', 'team', 'enterprise'] as const) {
      const limits = getPlanLimits(plan);
      expect(limits).toBeDefined();
      expect(typeof limits.maxServers).toBe('number');
      expect(typeof limits.maxUsers).toBe('number');
      expect(typeof limits.maxAiCalls).toBe('number');
    }
  });

  it('returns the same object as PLAN_LIMITS', () => {
    expect(getPlanLimits('free')).toBe(PLAN_LIMITS.free);
    expect(getPlanLimits('pro')).toBe(PLAN_LIMITS.pro);
  });
});
