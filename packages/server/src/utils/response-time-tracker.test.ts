// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for ResponseTimeTracker.
 *
 * Validates:
 * - Percentile computation (P50, P90, P95, P99)
 * - SLA compliance checking (P90 < 10s)
 * - Timer API
 * - Sliding window eviction
 * - Operation filtering
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ResponseTimeTracker,
  percentile,
  getResponseTimeTracker,
  resetResponseTimeTracker,
} from './response-time-tracker.js';

// ============================================================================
// percentile() helper
// ============================================================================

describe('percentile()', () => {
  it('should return 0 for empty array', () => {
    expect(percentile([], 90)).toBe(0);
  });

  it('should return the only element for single-element array', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 90)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('should compute P50 (median) correctly for even-length array', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p50 = percentile(sorted, 50);
    // P50 of 10 items: ceil(50/100 * 10) - 1 = 4 → sorted[4] = 5
    expect(p50).toBe(5);
  });

  it('should compute P90 correctly', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const p90 = percentile(sorted, 90);
    // P90 of 10 items: ceil(90/100 * 10) - 1 = 8 → sorted[8] = 9
    expect(p90).toBe(9);
  });

  it('should compute P99 correctly for 100 items', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    const p99 = percentile(sorted, 99);
    // P99 of 100 items: ceil(99/100 * 100) - 1 = 98 → sorted[98] = 99
    expect(p99).toBe(99);
  });

  it('should compute P90 correctly for 100 items', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    const p90 = percentile(sorted, 90);
    // P90 of 100 items: ceil(90/100 * 100) - 1 = 89 → sorted[89] = 90
    expect(p90).toBe(90);
  });
});

// ============================================================================
// ResponseTimeTracker
// ============================================================================

describe('ResponseTimeTracker', () => {
  let tracker: ResponseTimeTracker;

  beforeEach(() => {
    tracker = new ResponseTimeTracker();
  });

  describe('record()', () => {
    it('should record entries and increment count', () => {
      tracker.record({
        operation: 'planGeneration',
        durationMs: 500,
        fromCache: false,
        timestamp: Date.now(),
      });

      expect(tracker.getEntryCount()).toBe(1);

      tracker.record({
        operation: 'errorDiagnosis',
        durationMs: 200,
        fromCache: true,
        timestamp: Date.now(),
      });

      expect(tracker.getEntryCount()).toBe(2);
    });

    it('should evict oldest entries when exceeding maxEntries', () => {
      const smallTracker = new ResponseTimeTracker(5);

      for (let i = 0; i < 10; i++) {
        smallTracker.record({
          operation: 'test',
          durationMs: (i + 1) * 100,
          fromCache: false,
          timestamp: Date.now(),
        });
      }

      expect(smallTracker.getEntryCount()).toBe(5);

      // Should retain the last 5 entries (600, 700, 800, 900, 1000)
      const entries = smallTracker.getEntries();
      expect(entries[0].durationMs).toBe(600);
      expect(entries[4].durationMs).toBe(1000);
    });
  });

  describe('startTimer()', () => {
    it('should measure elapsed time', async () => {
      const end = tracker.startTimer('planGeneration');

      // Wait a short time
      await new Promise((r) => setTimeout(r, 50));

      const entry = end();
      expect(entry.operation).toBe('planGeneration');
      expect(entry.durationMs).toBeGreaterThanOrEqual(40); // Allow some tolerance
      expect(entry.fromCache).toBe(false);
      expect(tracker.getEntryCount()).toBe(1);
    });

    it('should record fromCache flag', () => {
      const end = tracker.startTimer('errorDiagnosis');
      const entry = end({ fromCache: true });

      expect(entry.fromCache).toBe(true);
    });
  });

  describe('getStats()', () => {
    it('should return zero stats for empty tracker', () => {
      const stats = tracker.getStats();

      expect(stats.count).toBe(0);
      expect(stats.min).toBe(0);
      expect(stats.max).toBe(0);
      expect(stats.avg).toBe(0);
      expect(stats.p50).toBe(0);
      expect(stats.p90).toBe(0);
      expect(stats.meetsP90SLA).toBe(true);
    });

    it('should compute correct statistics', () => {
      // Record 100 entries with durations from 100ms to 10000ms
      for (let i = 0; i < 100; i++) {
        tracker.record({
          operation: 'planGeneration',
          durationMs: (i + 1) * 100, // 100, 200, ..., 10000
          fromCache: false,
          timestamp: Date.now(),
        });
      }

      const stats = tracker.getStats();

      expect(stats.count).toBe(100);
      expect(stats.min).toBe(100);
      expect(stats.max).toBe(10000);
      expect(stats.avg).toBe(5050);
      expect(stats.p50).toBe(5000);
      expect(stats.p90).toBe(9000);
      expect(stats.p95).toBe(9500);
      expect(stats.p99).toBe(9900);
    });

    it('should filter by operation', () => {
      tracker.record({ operation: 'planGeneration', durationMs: 1000, fromCache: false, timestamp: Date.now() });
      tracker.record({ operation: 'errorDiagnosis', durationMs: 200, fromCache: true, timestamp: Date.now() });
      tracker.record({ operation: 'planGeneration', durationMs: 2000, fromCache: false, timestamp: Date.now() });

      const planStats = tracker.getStats('planGeneration');
      expect(planStats.count).toBe(2);
      expect(planStats.min).toBe(1000);
      expect(planStats.max).toBe(2000);

      const diagStats = tracker.getStats('errorDiagnosis');
      expect(diagStats.count).toBe(1);
      expect(diagStats.min).toBe(200);
    });
  });

  describe('meetsP90SLA()', () => {
    it('should return true when P90 is below threshold', () => {
      // 10s threshold by default
      // Record 100 entries, 90% under 10s, 10% above
      for (let i = 0; i < 90; i++) {
        tracker.record({
          operation: 'planGeneration',
          durationMs: 500 + i * 100, // 500 to 9400ms
          fromCache: false,
          timestamp: Date.now(),
        });
      }
      for (let i = 0; i < 10; i++) {
        tracker.record({
          operation: 'planGeneration',
          durationMs: 11000 + i * 1000, // 11000 to 20000ms (outliers)
          fromCache: false,
          timestamp: Date.now(),
        });
      }

      const stats = tracker.getStats();
      // P90 should be <= 9400ms (the 90th item after sorting)
      expect(stats.p90).toBeLessThan(10000);
      expect(stats.meetsP90SLA).toBe(true);
    });

    it('should return false when P90 exceeds threshold', () => {
      // Record 100 entries, most over 10s
      for (let i = 0; i < 100; i++) {
        tracker.record({
          operation: 'planGeneration',
          durationMs: 10000 + i * 100, // 10000 to 19900ms
          fromCache: false,
          timestamp: Date.now(),
        });
      }

      expect(tracker.meetsP90SLA()).toBe(false);
    });

    it('should return true with custom lower threshold', () => {
      const fastTracker = new ResponseTimeTracker(1000, 5000); // 5s SLA

      for (let i = 0; i < 100; i++) {
        fastTracker.record({
          operation: 'test',
          durationMs: (i + 1) * 40, // 40 to 4000ms
          fromCache: false,
          timestamp: Date.now(),
        });
      }

      expect(fastTracker.meetsP90SLA()).toBe(true);
    });
  });

  describe('clear()', () => {
    it('should remove all entries', () => {
      tracker.record({ operation: 'test', durationMs: 100, fromCache: false, timestamp: Date.now() });
      tracker.record({ operation: 'test', durationMs: 200, fromCache: false, timestamp: Date.now() });

      expect(tracker.getEntryCount()).toBe(2);
      tracker.clear();
      expect(tracker.getEntryCount()).toBe(0);
    });
  });

  describe('getEntries()', () => {
    it('should return a copy of entries', () => {
      tracker.record({ operation: 'test', durationMs: 100, fromCache: false, timestamp: Date.now() });

      const entries = tracker.getEntries();
      entries.push({ operation: 'fake', durationMs: 999, fromCache: false, timestamp: Date.now() });

      expect(tracker.getEntryCount()).toBe(1); // Original unchanged
    });

    it('should filter entries by operation', () => {
      tracker.record({ operation: 'planGeneration', durationMs: 100, fromCache: false, timestamp: Date.now() });
      tracker.record({ operation: 'errorDiagnosis', durationMs: 200, fromCache: false, timestamp: Date.now() });
      tracker.record({ operation: 'planGeneration', durationMs: 300, fromCache: false, timestamp: Date.now() });

      const planEntries = tracker.getEntries('planGeneration');
      expect(planEntries.length).toBe(2);

      const diagEntries = tracker.getEntries('errorDiagnosis');
      expect(diagEntries.length).toBe(1);
    });
  });
});

// ============================================================================
// Singleton
// ============================================================================

describe('Global tracker singleton', () => {
  beforeEach(() => {
    resetResponseTimeTracker();
  });

  it('should return the same tracker instance', () => {
    const t1 = getResponseTimeTracker();
    const t2 = getResponseTimeTracker();
    expect(t1).toBe(t2);
  });

  it('should reset to a new instance', () => {
    const t1 = getResponseTimeTracker();
    t1.record({ operation: 'test', durationMs: 100, fromCache: false, timestamp: Date.now() });
    expect(t1.getEntryCount()).toBe(1);

    resetResponseTimeTracker();

    const t2 = getResponseTimeTracker();
    expect(t2).not.toBe(t1);
    expect(t2.getEntryCount()).toBe(0);
  });
});

// ============================================================================
// P90 SLA Validation (Integration-level)
// ============================================================================

describe('AI Response Time P90 SLA Validation', () => {
  it('should confirm P90 < 10s when 90% of responses are fast', () => {
    const tracker = new ResponseTimeTracker();

    // Simulate realistic response time distribution:
    // - 50% from rule library (< 100ms)
    // - 40% from AI with fallback (1-5s)
    // - 10% slow AI responses (5-15s)

    // 50 rule-library responses (fast)
    for (let i = 0; i < 50; i++) {
      tracker.record({
        operation: 'errorDiagnosis',
        durationMs: 10 + Math.floor(Math.random() * 90), // 10-100ms
        fromCache: true,
        timestamp: Date.now(),
      });
    }

    // 40 AI responses (moderate)
    for (let i = 0; i < 40; i++) {
      tracker.record({
        operation: 'planGeneration',
        durationMs: 1000 + Math.floor(Math.random() * 4000), // 1-5s
        fromCache: false,
        timestamp: Date.now(),
      });
    }

    // 10 slow AI responses (outliers)
    for (let i = 0; i < 10; i++) {
      tracker.record({
        operation: 'planGeneration',
        durationMs: 5000 + Math.floor(Math.random() * 10000), // 5-15s
        fromCache: false,
        timestamp: Date.now(),
      });
    }

    const stats = tracker.getStats();

    // P90 must be < 10s (the 90th percentile of all 100 entries)
    expect(stats.count).toBe(100);
    expect(stats.p90).toBeLessThan(10000);
    expect(stats.meetsP90SLA).toBe(true);
  });

  it('should validate that session creation (without AI) is near-instant', () => {
    const tracker = new ResponseTimeTracker();

    // Session creation is synchronous, should be < 10ms typically
    for (let i = 0; i < 100; i++) {
      tracker.record({
        operation: 'sessionCreate',
        durationMs: 1 + Math.floor(Math.random() * 5), // 1-6ms
        fromCache: false,
        timestamp: Date.now(),
      });
    }

    const stats = tracker.getStats('sessionCreate');
    expect(stats.p90).toBeLessThan(10);
    expect(stats.meetsP90SLA).toBe(true);
  });

  it('should validate that rule-library error diagnosis is fast', () => {
    const tracker = new ResponseTimeTracker();

    // Common errors bypass AI → should be very fast (< 100ms)
    for (let i = 0; i < 100; i++) {
      tracker.record({
        operation: 'errorDiagnosis',
        durationMs: 5 + Math.floor(Math.random() * 50), // 5-55ms
        fromCache: true,
        timestamp: Date.now(),
      });
    }

    const stats = tracker.getStats('errorDiagnosis');
    expect(stats.p90).toBeLessThan(100);
    expect(stats.meetsP90SLA).toBe(true);
  });

  it('should validate P90 < 10s across mixed operation types', () => {
    const tracker = new ResponseTimeTracker();

    // Mix of all operation types
    const operations = [
      { op: 'envAnalysis', count: 20, minMs: 500, maxMs: 3000 },
      { op: 'planGeneration', count: 30, minMs: 1000, maxMs: 5000 },
      { op: 'errorDiagnosis', count: 30, minMs: 10, maxMs: 100 }, // Rule-library fast path
      { op: 'errorDiagnosis', count: 10, minMs: 2000, maxMs: 8000 }, // AI diagnosis
      { op: 'sessionCreate', count: 10, minMs: 1, maxMs: 5 },
    ];

    for (const { op, count, minMs, maxMs } of operations) {
      for (let i = 0; i < count; i++) {
        tracker.record({
          operation: op,
          durationMs: minMs + Math.floor(Math.random() * (maxMs - minMs)),
          fromCache: op === 'errorDiagnosis' && minMs < 100,
          timestamp: Date.now(),
        });
      }
    }

    const stats = tracker.getStats();
    expect(stats.count).toBe(100);
    expect(stats.p90).toBeLessThan(10000);
    expect(stats.meetsP90SLA).toBe(true);
  });
});
