// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AIQuotaManager,
  startOfMonth,
  endOfMonth,
  getAIQuotaManager,
  setAIQuotaManager,
  _resetAIQuotaManager,
} from './quota-manager.js';
import type { QuotaDataAccess, WarningCallback, AIUsageRecord } from './quota-manager.js';
import type { AICallMetrics, PlanId } from './types.js';
import { PLAN_QUOTAS } from './constants.js';

// ---------------------------------------------------------------------------
// In-memory QuotaDataAccess implementation for testing
// ---------------------------------------------------------------------------

class InMemoryQuotaDataAccess implements QuotaDataAccess {
  private tenantPlans = new Map<string, PlanId>();
  private usageRecords: AIUsageRecord[] = [];
  private nextId = 1;

  setTenantPlan(tenantId: string, plan: PlanId): void {
    this.tenantPlans.set(tenantId, plan);
  }

  async getTenantPlan(tenantId: string): Promise<PlanId | null> {
    return this.tenantPlans.get(tenantId) ?? null;
  }

  async getCallCount(userId: string, since: Date): Promise<number> {
    return this.usageRecords.filter(
      (r) => r.userId === userId && r.createdAt >= since,
    ).length;
  }

  async getTotalCost(userId: string, since: Date): Promise<number> {
    return this.usageRecords
      .filter((r) => r.userId === userId && r.createdAt >= since)
      .reduce((sum, r) => sum + parseFloat(r.cost), 0);
  }

  async insertUsage(record: Omit<AIUsageRecord, 'id' | 'createdAt'>): Promise<number> {
    const id = this.nextId++;
    this.usageRecords.push({ ...record, id, createdAt: new Date() });
    return id;
  }

  /** Inject a usage record with a custom date (for month-boundary tests). */
  addUsageWithDate(
    userId: string,
    tenantId: string,
    cost: number,
    createdAt: Date,
  ): void {
    this.usageRecords.push({
      id: this.nextId++,
      userId,
      tenantId,
      model: 'claude-haiku-4-5',
      inputTokens: 1000,
      outputTokens: 500,
      cost: cost.toFixed(6),
      createdAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';
const TENANT_ID = 'tenant-1';

function makeCall(overrides?: Partial<AICallMetrics>): AICallMetrics {
  return {
    tenantId: TENANT_ID,
    model: 'claude-haiku-4-5',
    inputTokens: 5500,
    outputTokens: 1500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AIQuotaManager', () => {
  let data: InMemoryQuotaDataAccess;
  let warningFn: ReturnType<typeof vi.fn<WarningCallback>>;
  let manager: AIQuotaManager;

  beforeEach(() => {
    data = new InMemoryQuotaDataAccess();
    warningFn = vi.fn<WarningCallback>();
    manager = new AIQuotaManager(data, warningFn);
    _resetAIQuotaManager();
  });

  // -----------------------------------------------------------------------
  // checkQuota — Free plan
  // -----------------------------------------------------------------------

  describe('checkQuota — free plan', () => {
    beforeEach(() => {
      data.setTenantPlan(TENANT_ID, 'free');
    });

    it('allows calls when under the 100-call limit', async () => {
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(100);
    });

    it('returns correct remaining when some calls have been made', async () => {
      // Simulate 50 calls this month
      for (let i = 0; i < 50; i++) {
        await manager.trackAICall(USER_ID, makeCall());
      }
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(50);
    });

    it('allows the 99th call (remaining = 1)', async () => {
      for (let i = 0; i < 99; i++) {
        await manager.trackAICall(USER_ID, makeCall());
      }
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('blocks the 101st call (remaining = 0)', async () => {
      for (let i = 0; i < 100; i++) {
        await manager.trackAICall(USER_ID, makeCall());
      }
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.reason).toContain('Free plan limit reached');
      expect(result.reason).toContain('100 calls/month');
      expect(result.upgradeUrl).toBe('/billing?upgrade=pro');
    });

    it('does not trigger warning callback for free plan', async () => {
      for (let i = 0; i < 100; i++) {
        await manager.trackAICall(USER_ID, makeCall());
      }
      await manager.checkQuota(USER_ID, TENANT_ID);
      expect(warningFn).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // checkQuota — Pro plan
  // -----------------------------------------------------------------------

  describe('checkQuota — pro plan', () => {
    beforeEach(() => {
      data.setTenantPlan(TENANT_ID, 'pro');
    });

    it('allows calls when under both limits', async () => {
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2000);
    });

    it('still allows calls when call count exceeds 2000 (soft limit)', async () => {
      for (let i = 0; i < 2000; i++) {
        await manager.trackAICall(USER_ID, makeCall());
      }
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('triggers warning when cost exceeds $50 soft limit', async () => {
      // Inject high-cost usage to exceed $50
      data.addUsageWithDate(USER_ID, TENANT_ID, 55, new Date());
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
      expect(warningFn).toHaveBeenCalledWith(USER_ID, 'pro', 55, 50);
    });
  });

  // -----------------------------------------------------------------------
  // checkQuota — Team plan
  // -----------------------------------------------------------------------

  describe('checkQuota — team plan', () => {
    beforeEach(() => {
      data.setTenantPlan(TENANT_ID, 'team');
    });

    it('always allows calls', async () => {
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
    });

    it('returns remaining as budget distance from $200 limit', async () => {
      data.addUsageWithDate(USER_ID, TENANT_ID, 150, new Date());
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeCloseTo(50, 2);
    });

    it('triggers warning when cost exceeds $200 soft limit', async () => {
      data.addUsageWithDate(USER_ID, TENANT_ID, 250, new Date());
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
      expect(warningFn).toHaveBeenCalledWith(USER_ID, 'team', 250, 200);
    });
  });

  // -----------------------------------------------------------------------
  // checkQuota — Enterprise plan
  // -----------------------------------------------------------------------

  describe('checkQuota — enterprise plan', () => {
    beforeEach(() => {
      data.setTenantPlan(TENANT_ID, 'enterprise');
    });

    it('always allows calls', async () => {
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
    });

    it('triggers warning when cost exceeds $1000 soft limit', async () => {
      data.addUsageWithDate(USER_ID, TENANT_ID, 1100, new Date());
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
      expect(warningFn).toHaveBeenCalledWith(USER_ID, 'enterprise', 1100, 1000);
    });
  });

  // -----------------------------------------------------------------------
  // checkQuota — edge cases
  // -----------------------------------------------------------------------

  describe('checkQuota — edge cases', () => {
    it('returns allowed:false when tenant is not found', async () => {
      const result = await manager.checkQuota(USER_ID, 'nonexistent');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.reason).toBe('Tenant not found');
    });
  });

  // -----------------------------------------------------------------------
  // trackAICall
  // -----------------------------------------------------------------------

  describe('trackAICall', () => {
    it('returns the cost of the call', async () => {
      const cost = await manager.trackAICall(USER_ID, makeCall());
      // haiku: 5500/1M * 0.25 + 1500/1M * 1.25 = 0.001375 + 0.001875 = 0.00325
      expect(cost).toBeCloseTo(0.00325, 6);
    });

    it('increments monthly call count', async () => {
      expect(await manager.getMonthlyCallCount(USER_ID)).toBe(0);
      await manager.trackAICall(USER_ID, makeCall());
      expect(await manager.getMonthlyCallCount(USER_ID)).toBe(1);
      await manager.trackAICall(USER_ID, makeCall());
      expect(await manager.getMonthlyCallCount(USER_ID)).toBe(2);
    });

    it('accumulates monthly cost', async () => {
      await manager.trackAICall(USER_ID, makeCall());
      await manager.trackAICall(USER_ID, makeCall());
      const totalCost = await manager.getMonthlyCost(USER_ID);
      expect(totalCost).toBeCloseTo(0.00325 * 2, 5);
    });
  });

  // -----------------------------------------------------------------------
  // calculateCost
  // -----------------------------------------------------------------------

  describe('calculateCost', () => {
    it('calculates haiku cost for a typical call', () => {
      const cost = manager.calculateCost('claude-haiku-4-5', 5500, 1500);
      expect(cost).toBeCloseTo(0.00325, 6);
    });

    it('calculates sonnet cost for a typical call', () => {
      const cost = manager.calculateCost('claude-sonnet-4-5', 5500, 1500);
      expect(cost).toBeCloseTo(0.039, 6);
    });

    it('calculates opus cost for a typical call', () => {
      const cost = manager.calculateCost('claude-opus-4-6', 5500, 1500);
      expect(cost).toBeCloseTo(0.195, 6);
    });

    it('returns 0 for zero tokens', () => {
      expect(manager.calculateCost('claude-haiku-4-5', 0, 0)).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getQuotaStatus
  // -----------------------------------------------------------------------

  describe('getQuotaStatus', () => {
    it('returns null for unknown tenant', async () => {
      const status = await manager.getQuotaStatus(USER_ID, 'nonexistent');
      expect(status).toBeNull();
    });

    it('returns correct status for free plan', async () => {
      data.setTenantPlan(TENANT_ID, 'free');
      await manager.trackAICall(USER_ID, makeCall());

      const status = await manager.getQuotaStatus(USER_ID, TENANT_ID);
      expect(status).not.toBeNull();
      expect(status!.plan).toBe('free');
      expect(status!.usedCalls).toBe(1);
      expect(status!.maxCalls).toBe(100);
      expect(status!.softLimitUsd).toBeUndefined();
      expect(status!.usedCostUsd).toBeGreaterThan(0);
      expect(status!.periodStart).toBeInstanceOf(Date);
      expect(status!.periodEnd).toBeInstanceOf(Date);
      expect(status!.periodEnd.getTime()).toBeGreaterThan(status!.periodStart.getTime());
    });

    it('returns correct status for team plan', async () => {
      data.setTenantPlan(TENANT_ID, 'team');

      const status = await manager.getQuotaStatus(USER_ID, TENANT_ID);
      expect(status).not.toBeNull();
      expect(status!.plan).toBe('team');
      expect(status!.maxCalls).toBeUndefined();
      expect(status!.softLimitUsd).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // Month boundary — calls from prior month are not counted
  // -----------------------------------------------------------------------

  describe('month boundary reset', () => {
    it('does not count calls from previous months', async () => {
      data.setTenantPlan(TENANT_ID, 'free');

      // Insert 100 calls from last month
      const lastMonth = new Date();
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
      for (let i = 0; i < 100; i++) {
        data.addUsageWithDate(USER_ID, TENANT_ID, 0.01, lastMonth);
      }

      // This month should be fresh
      const result = await manager.checkQuota(USER_ID, TENANT_ID);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(100);
    });

    it('does not include last-month cost in monthly spending', async () => {
      const lastMonth = new Date();
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
      data.addUsageWithDate(USER_ID, TENANT_ID, 999, lastMonth);

      const cost = await manager.getMonthlyCost(USER_ID);
      expect(cost).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // startOfMonth / endOfMonth helpers
  // -----------------------------------------------------------------------

  describe('startOfMonth / endOfMonth', () => {
    it('returns first day of current month at midnight UTC', () => {
      const now = new Date('2026-02-15T10:30:00Z');
      const start = startOfMonth(now);
      expect(start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    });

    it('returns first day of next month at midnight UTC', () => {
      const now = new Date('2026-02-15T10:30:00Z');
      const end = endOfMonth(now);
      expect(end.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    });

    it('handles December → January year rollover', () => {
      const now = new Date('2026-12-25T00:00:00Z');
      const end = endOfMonth(now);
      expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
    });

    it('handles January start of year', () => {
      const now = new Date('2026-01-01T00:00:00Z');
      const start = startOfMonth(now);
      expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  // -----------------------------------------------------------------------
  // Singleton management
  // -----------------------------------------------------------------------

  describe('singleton', () => {
    it('throws when accessed before initialization', () => {
      expect(() => getAIQuotaManager()).toThrow('AIQuotaManager not initialized');
    });

    it('returns the set instance after initialization', () => {
      setAIQuotaManager(manager);
      expect(getAIQuotaManager()).toBe(manager);
    });

    it('can be reset and re-set', () => {
      setAIQuotaManager(manager);
      _resetAIQuotaManager();
      expect(() => getAIQuotaManager()).toThrow('AIQuotaManager not initialized');

      const manager2 = new AIQuotaManager(data);
      setAIQuotaManager(manager2);
      expect(getAIQuotaManager()).toBe(manager2);
    });
  });

  // -----------------------------------------------------------------------
  // Multi-user isolation
  // -----------------------------------------------------------------------

  describe('multi-user isolation', () => {
    it('tracks calls independently per user', async () => {
      data.setTenantPlan(TENANT_ID, 'free');
      const USER_A = 'user-a';
      const USER_B = 'user-b';

      // User A makes 99 calls
      for (let i = 0; i < 99; i++) {
        await manager.trackAICall(USER_A, makeCall());
      }

      // User B has zero calls
      expect(await manager.getMonthlyCallCount(USER_B)).toBe(0);

      const resultA = await manager.checkQuota(USER_A, TENANT_ID);
      const resultB = await manager.checkQuota(USER_B, TENANT_ID);
      expect(resultA.remaining).toBe(1);
      expect(resultB.remaining).toBe(100);
    });
  });

  // -----------------------------------------------------------------------
  // Cost precision
  // -----------------------------------------------------------------------

  describe('cost precision', () => {
    it('preserves 6-decimal precision through track/retrieve cycle', async () => {
      // haiku: 1000 in, 500 out → 0.000250 + 0.000625 = 0.000875
      const cost = await manager.trackAICall(USER_ID, makeCall({
        model: 'claude-haiku-4-5',
        inputTokens: 1000,
        outputTokens: 500,
      }));
      expect(cost).toBeCloseTo(0.000875, 6);

      const monthly = await manager.getMonthlyCost(USER_ID);
      expect(monthly).toBeCloseTo(0.000875, 6);
    });
  });
});
