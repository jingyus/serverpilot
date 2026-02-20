// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2024-2026 ServerPilot Contributors
import { describe, it, expect, beforeEach } from 'vitest';
import {
  CostTracker,
  fillMissingDays,
  getCostTracker,
  setCostTracker,
  _resetCostTracker,
} from './cost-tracker.js';
import type {
  CostTrackerDataAccess,
  DailyCostRow,
  ModelAggregateRow,
  TokenUsage,
} from './cost-tracker.js';
import type { ModelName } from './types.js';

// ---------------------------------------------------------------------------
// In-memory CostTrackerDataAccess implementation for testing
// ---------------------------------------------------------------------------

interface UsageRecord {
  userId: string;
  model: ModelName;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  createdAt: Date;
}

class InMemoryCostTrackerDataAccess implements CostTrackerDataAccess {
  private records: UsageRecord[] = [];

  addRecord(
    userId: string,
    model: ModelName,
    inputTokens: number,
    outputTokens: number,
    cost: number,
    createdAt: Date,
  ): void {
    this.records.push({ userId, model, inputTokens, outputTokens, cost, createdAt });
  }

  async getTotalCost(userId: string, since: Date, until: Date): Promise<number> {
    return this.records
      .filter((r) => r.userId === userId && r.createdAt >= since && r.createdAt < until)
      .reduce((sum, r) => sum + r.cost, 0);
  }

  async getDailyCosts(userId: string, since: Date, until: Date): Promise<DailyCostRow[]> {
    const dayMap = new Map<string, number>();
    for (const r of this.records) {
      if (r.userId !== userId || r.createdAt < since || r.createdAt >= until) continue;
      const key = formatDateUTC(r.createdAt);
      dayMap.set(key, (dayMap.get(key) ?? 0) + r.cost);
    }
    return Array.from(dayMap.entries()).map(([date, cost]) => ({ date, cost }));
  }

  async getModelAggregates(userId: string, since: Date, until: Date): Promise<ModelAggregateRow[]> {
    const map = new Map<ModelName, { callCount: number; totalCost: number }>();
    for (const r of this.records) {
      if (r.userId !== userId || r.createdAt < since || r.createdAt >= until) continue;
      const entry = map.get(r.model) ?? { callCount: 0, totalCost: 0 };
      entry.callCount += 1;
      entry.totalCost += r.cost;
      map.set(r.model, entry);
    }
    return Array.from(map.entries()).map(([model, agg]) => ({
      model,
      callCount: agg.callCount,
      totalCost: agg.totalCost,
    }));
  }

  async getTokenTotals(userId: string, since: Date, until: Date): Promise<TokenUsage> {
    let inputTokens = 0;
    let outputTokens = 0;
    for (const r of this.records) {
      if (r.userId !== userId || r.createdAt < since || r.createdAt >= until) continue;
      inputTokens += r.inputTokens;
      outputTokens += r.outputTokens;
    }
    return { inputTokens, outputTokens };
  }
}

function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'user-1';

/** Helper: date in current UTC month. */
function thisMonth(day: number, hour: number = 12): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, hour));
}

/** Helper: date in previous UTC month. */
function lastMonth(day: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, day, 12));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CostTracker', () => {
  let data: InMemoryCostTrackerDataAccess;
  let tracker: CostTracker;

  beforeEach(() => {
    data = new InMemoryCostTrackerDataAccess();
    tracker = new CostTracker(data);
    _resetCostTracker();
  });

  // -----------------------------------------------------------------------
  // getMonthlyCost
  // -----------------------------------------------------------------------

  describe('getMonthlyCost', () => {
    it('returns 0 when no usage records exist', async () => {
      const cost = await tracker.getMonthlyCost(USER_ID);
      expect(cost).toBe(0);
    });

    it('aggregates costs for the current month', async () => {
      data.addRecord(USER_ID, 'claude-haiku-4-5', 1000, 500, 0.000875, thisMonth(1));
      data.addRecord(USER_ID, 'claude-sonnet-4-5', 5000, 2000, 0.045, thisMonth(5));
      data.addRecord(USER_ID, 'claude-opus-4-6', 3000, 1000, 0.12, thisMonth(10));

      const cost = await tracker.getMonthlyCost(USER_ID);
      expect(cost).toBeCloseTo(0.000875 + 0.045 + 0.12, 6);
    });

    it('preserves 6-decimal precision', async () => {
      data.addRecord(USER_ID, 'claude-haiku-4-5', 1000, 500, 0.000875, thisMonth(3));

      const cost = await tracker.getMonthlyCost(USER_ID);
      expect(cost).toBeCloseTo(0.000875, 6);
    });

    it('excludes records from previous months', async () => {
      data.addRecord(USER_ID, 'claude-sonnet-4-5', 5000, 2000, 10.0, lastMonth(15));
      data.addRecord(USER_ID, 'claude-haiku-4-5', 1000, 500, 0.001, thisMonth(2));

      const cost = await tracker.getMonthlyCost(USER_ID);
      expect(cost).toBeCloseTo(0.001, 6);
    });

    it('isolates costs between users', async () => {
      data.addRecord('user-a', 'claude-haiku-4-5', 1000, 500, 5.0, thisMonth(1));
      data.addRecord('user-b', 'claude-haiku-4-5', 1000, 500, 3.0, thisMonth(1));

      const costA = await tracker.getMonthlyCost('user-a');
      const costB = await tracker.getMonthlyCost('user-b');
      expect(costA).toBeCloseTo(5.0, 6);
      expect(costB).toBeCloseTo(3.0, 6);
    });
  });

  // -----------------------------------------------------------------------
  // getDailyCosts
  // -----------------------------------------------------------------------

  describe('getDailyCosts', () => {
    it('returns zero-filled entries for days with no usage', async () => {
      const entries = await tracker.getDailyCosts(USER_ID, 7);
      expect(entries).toHaveLength(7);
      for (const entry of entries) {
        expect(entry.cost).toBe(0);
      }
    });

    it('returns correct costs for days with usage', async () => {
      const now = new Date();
      const todayStr = formatDateUTC(now);

      data.addRecord(USER_ID, 'claude-haiku-4-5', 1000, 500, 0.5, now);
      data.addRecord(USER_ID, 'claude-sonnet-4-5', 2000, 1000, 1.5, now);

      const entries = await tracker.getDailyCosts(USER_ID, 3);
      expect(entries).toHaveLength(3);

      const todayEntry = entries.find((e) => e.date === todayStr);
      expect(todayEntry).toBeDefined();
      expect(todayEntry!.cost).toBeCloseTo(2.0, 6);
    });

    it('defaults to 30 days when no days parameter given', async () => {
      const entries = await tracker.getDailyCosts(USER_ID);
      expect(entries).toHaveLength(30);
    });

    it('fills missing days with 0', async () => {
      // Only add usage for one specific day
      const now = new Date();
      const dayAgo = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2, 12,
      ));
      data.addRecord(USER_ID, 'claude-haiku-4-5', 1000, 500, 0.75, dayAgo);

      const entries = await tracker.getDailyCosts(USER_ID, 5);
      expect(entries).toHaveLength(5);

      const nonZero = entries.filter((e) => e.cost > 0);
      expect(nonZero).toHaveLength(1);
      expect(nonZero[0].cost).toBeCloseTo(0.75, 6);

      const zeroDays = entries.filter((e) => e.cost === 0);
      expect(zeroDays).toHaveLength(4);
    });
  });

  // -----------------------------------------------------------------------
  // getModelDistribution
  // -----------------------------------------------------------------------

  describe('getModelDistribution', () => {
    it('returns empty array when no usage exists', async () => {
      const dist = await tracker.getModelDistribution(USER_ID);
      expect(dist).toEqual([]);
    });

    it('returns correct call counts and costs per model', async () => {
      data.addRecord(USER_ID, 'claude-haiku-4-5', 1000, 500, 1.0, thisMonth(1));
      data.addRecord(USER_ID, 'claude-haiku-4-5', 1000, 500, 1.0, thisMonth(2));
      data.addRecord(USER_ID, 'claude-sonnet-4-5', 5000, 2000, 8.0, thisMonth(3));

      const dist = await tracker.getModelDistribution(USER_ID);
      expect(dist).toHaveLength(2);

      const haiku = dist.find((d) => d.model === 'claude-haiku-4-5');
      expect(haiku).toBeDefined();
      expect(haiku!.callCount).toBe(2);
      expect(haiku!.totalCost).toBeCloseTo(2.0, 6);

      const sonnet = dist.find((d) => d.model === 'claude-sonnet-4-5');
      expect(sonnet).toBeDefined();
      expect(sonnet!.callCount).toBe(1);
      expect(sonnet!.totalCost).toBeCloseTo(8.0, 6);
    });

    it('calculates cost percentages summing to 100', async () => {
      data.addRecord(USER_ID, 'claude-haiku-4-5', 1000, 500, 2.0, thisMonth(1));
      data.addRecord(USER_ID, 'claude-sonnet-4-5', 5000, 2000, 8.0, thisMonth(2));

      const dist = await tracker.getModelDistribution(USER_ID);
      const totalPercent = dist.reduce((sum, d) => sum + d.costPercent, 0);
      expect(totalPercent).toBeCloseTo(100, 1);

      const haiku = dist.find((d) => d.model === 'claude-haiku-4-5')!;
      expect(haiku.costPercent).toBe(20); // 2/10 = 20%

      const sonnet = dist.find((d) => d.model === 'claude-sonnet-4-5')!;
      expect(sonnet.costPercent).toBe(80); // 8/10 = 80%
    });

    it('returns 0 costPercent when total cost is 0', async () => {
      data.addRecord(USER_ID, 'claude-haiku-4-5', 0, 0, 0, thisMonth(1));

      const dist = await tracker.getModelDistribution(USER_ID);
      expect(dist).toHaveLength(1);
      expect(dist[0].costPercent).toBe(0);
    });

    it('excludes previous-month records from distribution', async () => {
      data.addRecord(USER_ID, 'claude-opus-4-6', 3000, 1000, 50.0, lastMonth(15));
      data.addRecord(USER_ID, 'claude-haiku-4-5', 1000, 500, 1.0, thisMonth(1));

      const dist = await tracker.getModelDistribution(USER_ID);
      expect(dist).toHaveLength(1);
      expect(dist[0].model).toBe('claude-haiku-4-5');
    });
  });

  // -----------------------------------------------------------------------
  // getMonthlyTokens
  // -----------------------------------------------------------------------

  describe('getMonthlyTokens', () => {
    it('returns zero tokens when no usage exists', async () => {
      const tokens = await tracker.getMonthlyTokens(USER_ID);
      expect(tokens.inputTokens).toBe(0);
      expect(tokens.outputTokens).toBe(0);
    });

    it('aggregates tokens across multiple calls', async () => {
      data.addRecord(USER_ID, 'claude-haiku-4-5', 1000, 500, 0.001, thisMonth(1));
      data.addRecord(USER_ID, 'claude-sonnet-4-5', 5000, 2000, 0.05, thisMonth(3));
      data.addRecord(USER_ID, 'claude-opus-4-6', 3000, 1000, 0.12, thisMonth(5));

      const tokens = await tracker.getMonthlyTokens(USER_ID);
      expect(tokens.inputTokens).toBe(9000);
      expect(tokens.outputTokens).toBe(3500);
    });

    it('excludes tokens from previous months', async () => {
      data.addRecord(USER_ID, 'claude-haiku-4-5', 100000, 50000, 10.0, lastMonth(15));
      data.addRecord(USER_ID, 'claude-haiku-4-5', 1000, 500, 0.001, thisMonth(1));

      const tokens = await tracker.getMonthlyTokens(USER_ID);
      expect(tokens.inputTokens).toBe(1000);
      expect(tokens.outputTokens).toBe(500);
    });
  });

  // -----------------------------------------------------------------------
  // fillMissingDays — pure function
  // -----------------------------------------------------------------------

  describe('fillMissingDays', () => {
    it('fills a 3-day range with all missing days', () => {
      const since = new Date('2026-02-10T00:00:00Z');
      const until = new Date('2026-02-13T00:00:00Z');
      const result = fillMissingDays([], since, until);

      expect(result).toEqual([
        { date: '2026-02-10', cost: 0 },
        { date: '2026-02-11', cost: 0 },
        { date: '2026-02-12', cost: 0 },
      ]);
    });

    it('preserves existing cost values and fills gaps', () => {
      const since = new Date('2026-02-10T00:00:00Z');
      const until = new Date('2026-02-13T00:00:00Z');
      const rows: DailyCostRow[] = [
        { date: '2026-02-11', cost: 3.5 },
      ];
      const result = fillMissingDays(rows, since, until);

      expect(result).toEqual([
        { date: '2026-02-10', cost: 0 },
        { date: '2026-02-11', cost: 3.5 },
        { date: '2026-02-12', cost: 0 },
      ]);
    });

    it('returns empty array when since === until', () => {
      const d = new Date('2026-02-10T00:00:00Z');
      const result = fillMissingDays([], d, d);
      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Singleton management
  // -----------------------------------------------------------------------

  describe('singleton', () => {
    it('throws when accessed before initialization', () => {
      expect(() => getCostTracker()).toThrow('CostTracker not initialized');
    });

    it('returns the set instance after initialization', () => {
      setCostTracker(tracker);
      expect(getCostTracker()).toBe(tracker);
    });

    it('can be reset and re-set', () => {
      setCostTracker(tracker);
      _resetCostTracker();
      expect(() => getCostTracker()).toThrow('CostTracker not initialized');

      const tracker2 = new CostTracker(data);
      setCostTracker(tracker2);
      expect(getCostTracker()).toBe(tracker2);
    });
  });
});
