/**
 * Tests for token usage statistics tracker.
 *
 * @module ai/token-tracker.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TokenTracker,
  estimateCost,
  getPricing,
  fromApiUsage,
  aggregateStats,
  MODEL_PRICING,
  type TokenUsage,
  type TokenUsageEntry,
} from './token-tracker.js';

// ============================================================================
// Helpers
// ============================================================================

function makeUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    ...overrides,
  };
}

function recordSample(
  tracker: TokenTracker,
  overrides: Partial<{
    requestId: string;
    sessionId: string;
    model: string;
    usage: Partial<TokenUsage>;
    timestamp: number;
  }> = {},
): TokenUsageEntry {
  return tracker.record({
    requestId: overrides.requestId ?? 'req-1',
    sessionId: overrides.sessionId ?? 'session-1',
    model: overrides.model ?? 'claude-sonnet-4-20250514',
    usage: makeUsage(overrides.usage),
    timestamp: overrides.timestamp,
  });
}

// ============================================================================
// estimateCost
// ============================================================================

describe('estimateCost', () => {
  it('should calculate cost for input tokens only', () => {
    const usage = makeUsage({ inputTokens: 1_000_000 });
    const cost = estimateCost('claude-sonnet-4-20250514', usage);

    // 1M input tokens at $3/M = $3
    expect(cost).toBeCloseTo(3, 4);
  });

  it('should calculate cost for output tokens only', () => {
    const usage = makeUsage({ outputTokens: 1_000_000 });
    const cost = estimateCost('claude-sonnet-4-20250514', usage);

    // 1M output tokens at $15/M = $15
    expect(cost).toBeCloseTo(15, 4);
  });

  it('should calculate cost for cache creation tokens', () => {
    const usage = makeUsage({ cacheCreationInputTokens: 1_000_000 });
    const cost = estimateCost('claude-sonnet-4-20250514', usage);

    // 1M cache creation tokens at $3.75/M = $3.75
    expect(cost).toBeCloseTo(3.75, 4);
  });

  it('should calculate cost for cache read tokens', () => {
    const usage = makeUsage({ cacheReadInputTokens: 1_000_000 });
    const cost = estimateCost('claude-sonnet-4-20250514', usage);

    // 1M cache read tokens at $0.30/M = $0.30
    expect(cost).toBeCloseTo(0.3, 4);
  });

  it('should sum all token type costs', () => {
    const usage: TokenUsage = {
      inputTokens: 500,
      outputTokens: 200,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 300,
    };
    const cost = estimateCost('claude-sonnet-4-20250514', usage);

    const expected =
      (500 / 1e6) * 3 +
      (200 / 1e6) * 15 +
      (100 / 1e6) * 3.75 +
      (300 / 1e6) * 0.3;
    expect(cost).toBeCloseTo(expected, 10);
  });

  it('should return 0 for zero usage', () => {
    const usage = makeUsage();
    expect(estimateCost('claude-sonnet-4-20250514', usage)).toBe(0);
  });

  it('should use haiku pricing for haiku model', () => {
    const usage = makeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const cost = estimateCost('claude-haiku-3-5-20241022', usage);

    // $0.80/M input + $4/M output = $4.80
    expect(cost).toBeCloseTo(4.8, 4);
  });

  it('should use opus pricing for opus model', () => {
    const usage = makeUsage({ inputTokens: 1_000_000, outputTokens: 1_000_000 });
    const cost = estimateCost('claude-opus-4-20250514', usage);

    // $15/M input + $75/M output = $90
    expect(cost).toBeCloseTo(90, 4);
  });

  it('should fall back to default pricing for unknown models', () => {
    const usage = makeUsage({ inputTokens: 1_000_000 });
    const cost = estimateCost('unknown-model-xyz', usage);

    // Default input pricing = $3/M
    expect(cost).toBeCloseTo(3, 4);
  });
});

// ============================================================================
// getPricing
// ============================================================================

describe('getPricing', () => {
  it('should return sonnet pricing', () => {
    const pricing = getPricing('claude-sonnet-4-20250514');
    expect(pricing).toEqual(MODEL_PRICING['claude-sonnet-4-20250514']);
  });

  it('should return haiku pricing', () => {
    const pricing = getPricing('claude-haiku-3-5-20241022');
    expect(pricing).toEqual(MODEL_PRICING['claude-haiku-3-5-20241022']);
  });

  it('should return opus pricing', () => {
    const pricing = getPricing('claude-opus-4-20250514');
    expect(pricing).toEqual(MODEL_PRICING['claude-opus-4-20250514']);
  });

  it('should return default pricing for unknown model', () => {
    const pricing = getPricing('unknown-model');
    expect(pricing.inputPerMillion).toBe(3);
    expect(pricing.outputPerMillion).toBe(15);
  });
});

// ============================================================================
// fromApiUsage
// ============================================================================

describe('fromApiUsage', () => {
  it('should convert snake_case API usage to camelCase', () => {
    const result = fromApiUsage({
      input_tokens: 500,
      output_tokens: 200,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 50,
    });

    expect(result).toEqual({
      inputTokens: 500,
      outputTokens: 200,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 50,
    });
  });

  it('should default null cache tokens to 0', () => {
    const result = fromApiUsage({
      input_tokens: 500,
      output_tokens: 200,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    });

    expect(result.cacheCreationInputTokens).toBe(0);
    expect(result.cacheReadInputTokens).toBe(0);
  });

  it('should default undefined cache tokens to 0', () => {
    const result = fromApiUsage({
      input_tokens: 500,
      output_tokens: 200,
    });

    expect(result.cacheCreationInputTokens).toBe(0);
    expect(result.cacheReadInputTokens).toBe(0);
  });

  it('should preserve zero values', () => {
    const result = fromApiUsage({
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });

    expect(result).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });
});

// ============================================================================
// aggregateStats
// ============================================================================

describe('aggregateStats', () => {
  it('should return zeroed stats for empty entries', () => {
    const stats = aggregateStats([]);

    expect(stats.totalRequests).toBe(0);
    expect(stats.totalInputTokens).toBe(0);
    expect(stats.totalOutputTokens).toBe(0);
    expect(stats.totalCacheCreationTokens).toBe(0);
    expect(stats.totalCacheReadTokens).toBe(0);
    expect(stats.totalCostUsd).toBe(0);
    expect(stats.avgInputTokens).toBe(0);
    expect(stats.avgOutputTokens).toBe(0);
  });

  it('should aggregate a single entry', () => {
    const entry: TokenUsageEntry = {
      requestId: 'r1',
      sessionId: 's1',
      model: 'claude-sonnet-4-20250514',
      usage: makeUsage({ inputTokens: 100, outputTokens: 50 }),
      estimatedCostUsd: 0.001,
      timestamp: Date.now(),
    };

    const stats = aggregateStats([entry]);

    expect(stats.totalRequests).toBe(1);
    expect(stats.totalInputTokens).toBe(100);
    expect(stats.totalOutputTokens).toBe(50);
    expect(stats.avgInputTokens).toBe(100);
    expect(stats.avgOutputTokens).toBe(50);
    expect(stats.totalCostUsd).toBe(0.001);
  });

  it('should aggregate multiple entries', () => {
    const entries: TokenUsageEntry[] = [
      {
        requestId: 'r1',
        sessionId: 's1',
        model: 'claude-sonnet-4-20250514',
        usage: makeUsage({ inputTokens: 100, outputTokens: 50 }),
        estimatedCostUsd: 0.001,
        timestamp: 1000,
      },
      {
        requestId: 'r2',
        sessionId: 's1',
        model: 'claude-sonnet-4-20250514',
        usage: makeUsage({ inputTokens: 200, outputTokens: 100 }),
        estimatedCostUsd: 0.002,
        timestamp: 2000,
      },
      {
        requestId: 'r3',
        sessionId: 's2',
        model: 'claude-sonnet-4-20250514',
        usage: makeUsage({
          inputTokens: 300,
          outputTokens: 150,
          cacheCreationInputTokens: 50,
          cacheReadInputTokens: 25,
        }),
        estimatedCostUsd: 0.003,
        timestamp: 3000,
      },
    ];

    const stats = aggregateStats(entries);

    expect(stats.totalRequests).toBe(3);
    expect(stats.totalInputTokens).toBe(600);
    expect(stats.totalOutputTokens).toBe(300);
    expect(stats.totalCacheCreationTokens).toBe(50);
    expect(stats.totalCacheReadTokens).toBe(25);
    expect(stats.totalCostUsd).toBeCloseTo(0.006, 6);
    expect(stats.avgInputTokens).toBe(200);
    expect(stats.avgOutputTokens).toBe(100);
  });
});

// ============================================================================
// TokenTracker class
// ============================================================================

describe('TokenTracker', () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    tracker = new TokenTracker();
  });

  // --------------------------------------------------------------------------
  // record
  // --------------------------------------------------------------------------

  describe('record', () => {
    it('should create an entry with calculated cost', () => {
      const entry = recordSample(tracker, {
        usage: { inputTokens: 1000, outputTokens: 500 },
      });

      expect(entry.requestId).toBe('req-1');
      expect(entry.sessionId).toBe('session-1');
      expect(entry.model).toBe('claude-sonnet-4-20250514');
      expect(entry.usage.inputTokens).toBe(1000);
      expect(entry.usage.outputTokens).toBe(500);
      expect(entry.estimatedCostUsd).toBeGreaterThan(0);
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it('should use provided timestamp', () => {
      const entry = recordSample(tracker, { timestamp: 12345 });
      expect(entry.timestamp).toBe(12345);
    });

    it('should use Date.now() when timestamp not provided', () => {
      const before = Date.now();
      const entry = recordSample(tracker);
      const after = Date.now();

      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
    });

    it('should correctly calculate cost for the entry', () => {
      const entry = recordSample(tracker, {
        model: 'claude-sonnet-4-20250514',
        usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      });

      // $3/M input + $15/M output = $18
      expect(entry.estimatedCostUsd).toBeCloseTo(18, 4);
    });

    it('should increment tracker size', () => {
      expect(tracker.size).toBe(0);
      recordSample(tracker);
      expect(tracker.size).toBe(1);
      recordSample(tracker, { requestId: 'req-2' });
      expect(tracker.size).toBe(2);
    });
  });

  // --------------------------------------------------------------------------
  // getEntries
  // --------------------------------------------------------------------------

  describe('getEntries', () => {
    it('should return empty array initially', () => {
      expect(tracker.getEntries()).toEqual([]);
    });

    it('should return all recorded entries', () => {
      recordSample(tracker, { requestId: 'r1' });
      recordSample(tracker, { requestId: 'r2' });
      recordSample(tracker, { requestId: 'r3' });

      const entries = tracker.getEntries();
      expect(entries).toHaveLength(3);
      expect(entries[0].requestId).toBe('r1');
      expect(entries[1].requestId).toBe('r2');
      expect(entries[2].requestId).toBe('r3');
    });
  });

  // --------------------------------------------------------------------------
  // getEntriesBySession
  // --------------------------------------------------------------------------

  describe('getEntriesBySession', () => {
    it('should return empty array when no entries match', () => {
      recordSample(tracker, { sessionId: 'other' });
      expect(tracker.getEntriesBySession('session-1')).toEqual([]);
    });

    it('should filter entries by session ID', () => {
      recordSample(tracker, { requestId: 'r1', sessionId: 'session-a' });
      recordSample(tracker, { requestId: 'r2', sessionId: 'session-b' });
      recordSample(tracker, { requestId: 'r3', sessionId: 'session-a' });
      recordSample(tracker, { requestId: 'r4', sessionId: 'session-c' });

      const sessionA = tracker.getEntriesBySession('session-a');
      expect(sessionA).toHaveLength(2);
      expect(sessionA[0].requestId).toBe('r1');
      expect(sessionA[1].requestId).toBe('r3');
    });
  });

  // --------------------------------------------------------------------------
  // getEntriesByModel
  // --------------------------------------------------------------------------

  describe('getEntriesByModel', () => {
    it('should return empty array when no entries match', () => {
      recordSample(tracker, { model: 'claude-sonnet-4-20250514' });
      expect(tracker.getEntriesByModel('claude-opus-4-20250514')).toEqual([]);
    });

    it('should filter entries by model', () => {
      recordSample(tracker, { requestId: 'r1', model: 'claude-sonnet-4-20250514' });
      recordSample(tracker, { requestId: 'r2', model: 'claude-haiku-3-5-20241022' });
      recordSample(tracker, { requestId: 'r3', model: 'claude-sonnet-4-20250514' });

      const sonnet = tracker.getEntriesByModel('claude-sonnet-4-20250514');
      expect(sonnet).toHaveLength(2);
      expect(sonnet[0].requestId).toBe('r1');
      expect(sonnet[1].requestId).toBe('r3');
    });
  });

  // --------------------------------------------------------------------------
  // getStats
  // --------------------------------------------------------------------------

  describe('getStats', () => {
    it('should return zeroed stats when empty', () => {
      const stats = tracker.getStats();

      expect(stats.totalRequests).toBe(0);
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.totalCostUsd).toBe(0);
    });

    it('should aggregate all entries', () => {
      recordSample(tracker, {
        requestId: 'r1',
        usage: { inputTokens: 100, outputTokens: 50 },
      });
      recordSample(tracker, {
        requestId: 'r2',
        usage: { inputTokens: 200, outputTokens: 100 },
      });

      const stats = tracker.getStats();

      expect(stats.totalRequests).toBe(2);
      expect(stats.totalInputTokens).toBe(300);
      expect(stats.totalOutputTokens).toBe(150);
      expect(stats.avgInputTokens).toBe(150);
      expect(stats.avgOutputTokens).toBe(75);
    });
  });

  // --------------------------------------------------------------------------
  // getSessionStats
  // --------------------------------------------------------------------------

  describe('getSessionStats', () => {
    it('should return stats for a specific session', () => {
      recordSample(tracker, {
        requestId: 'r1',
        sessionId: 'session-a',
        usage: { inputTokens: 100, outputTokens: 50 },
      });
      recordSample(tracker, {
        requestId: 'r2',
        sessionId: 'session-b',
        usage: { inputTokens: 999, outputTokens: 999 },
      });
      recordSample(tracker, {
        requestId: 'r3',
        sessionId: 'session-a',
        usage: { inputTokens: 200, outputTokens: 100 },
      });

      const stats = tracker.getSessionStats('session-a');

      expect(stats.totalRequests).toBe(2);
      expect(stats.totalInputTokens).toBe(300);
      expect(stats.totalOutputTokens).toBe(150);
    });

    it('should return zeroed stats for non-existent session', () => {
      const stats = tracker.getSessionStats('non-existent');
      expect(stats.totalRequests).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // getStatsByModel
  // --------------------------------------------------------------------------

  describe('getStatsByModel', () => {
    it('should return empty object when no entries', () => {
      expect(tracker.getStatsByModel()).toEqual({});
    });

    it('should group stats by model', () => {
      recordSample(tracker, {
        requestId: 'r1',
        model: 'claude-sonnet-4-20250514',
        usage: { inputTokens: 100, outputTokens: 50 },
      });
      recordSample(tracker, {
        requestId: 'r2',
        model: 'claude-haiku-3-5-20241022',
        usage: { inputTokens: 200, outputTokens: 100 },
      });
      recordSample(tracker, {
        requestId: 'r3',
        model: 'claude-sonnet-4-20250514',
        usage: { inputTokens: 300, outputTokens: 150 },
      });

      const byModel = tracker.getStatsByModel();

      expect(Object.keys(byModel)).toHaveLength(2);

      expect(byModel['claude-sonnet-4-20250514'].totalRequests).toBe(2);
      expect(byModel['claude-sonnet-4-20250514'].totalInputTokens).toBe(400);
      expect(byModel['claude-sonnet-4-20250514'].totalOutputTokens).toBe(200);

      expect(byModel['claude-haiku-3-5-20241022'].totalRequests).toBe(1);
      expect(byModel['claude-haiku-3-5-20241022'].totalInputTokens).toBe(200);
      expect(byModel['claude-haiku-3-5-20241022'].totalOutputTokens).toBe(100);
    });
  });

  // --------------------------------------------------------------------------
  // size
  // --------------------------------------------------------------------------

  describe('size', () => {
    it('should be 0 initially', () => {
      expect(tracker.size).toBe(0);
    });

    it('should reflect number of entries', () => {
      recordSample(tracker, { requestId: 'r1' });
      recordSample(tracker, { requestId: 'r2' });
      recordSample(tracker, { requestId: 'r3' });
      expect(tracker.size).toBe(3);
    });
  });

  // --------------------------------------------------------------------------
  // reset
  // --------------------------------------------------------------------------

  describe('reset', () => {
    it('should clear all entries', () => {
      recordSample(tracker, { requestId: 'r1' });
      recordSample(tracker, { requestId: 'r2' });
      expect(tracker.size).toBe(2);

      tracker.reset();

      expect(tracker.size).toBe(0);
      expect(tracker.getEntries()).toEqual([]);
      expect(tracker.getStats().totalRequests).toBe(0);
    });

    it('should allow recording after reset', () => {
      recordSample(tracker, { requestId: 'r1' });
      tracker.reset();

      recordSample(tracker, { requestId: 'r2' });
      expect(tracker.size).toBe(1);
      expect(tracker.getEntries()[0].requestId).toBe('r2');
    });
  });

  // --------------------------------------------------------------------------
  // Integration: cost accuracy
  // --------------------------------------------------------------------------

  describe('cost accuracy', () => {
    it('should correctly compute cost across mixed models', () => {
      // Sonnet: 500 input, 200 output
      recordSample(tracker, {
        requestId: 'r1',
        model: 'claude-sonnet-4-20250514',
        usage: { inputTokens: 500, outputTokens: 200 },
      });

      // Haiku: 1000 input, 500 output
      recordSample(tracker, {
        requestId: 'r2',
        model: 'claude-haiku-3-5-20241022',
        usage: { inputTokens: 1000, outputTokens: 500 },
      });

      const stats = tracker.getStats();

      const expectedSonnetCost = (500 / 1e6) * 3 + (200 / 1e6) * 15;
      const expectedHaikuCost = (1000 / 1e6) * 0.8 + (500 / 1e6) * 4;

      expect(stats.totalCostUsd).toBeCloseTo(
        expectedSonnetCost + expectedHaikuCost,
        10,
      );
    });

    it('should include cache token costs', () => {
      recordSample(tracker, {
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationInputTokens: 200,
          cacheReadInputTokens: 800,
        },
      });

      const stats = tracker.getStats();
      const expected =
        (1000 / 1e6) * 3 +
        (500 / 1e6) * 15 +
        (200 / 1e6) * 3.75 +
        (800 / 1e6) * 0.3;

      expect(stats.totalCostUsd).toBeCloseTo(expected, 10);
    });
  });
});
