// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for solution success rate tracker module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SuccessRateTracker,
  formatSuccessRate,
  rankBySuccessRate,
  type SolutionOutcome,
  type SuccessRateStats,
  type TrackerSnapshot,
} from './success-rate-tracker.js';
import type { SwitchResult, SwitchAttempt } from './auto-switch.js';
import type { ExecResult } from '@aiinstaller/shared';

// ============================================================================
// Test helpers
// ============================================================================

function makeOutcome(overrides: Partial<SolutionOutcome> = {}): SolutionOutcome {
  return {
    solutionId: 'test-solution',
    stepId: 'install-pnpm',
    success: true,
    timestamp: Date.now(),
    durationMs: 100,
    ...overrides,
  };
}

function makeExecResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    command: 'test-command',
    exitCode: 0,
    stdout: 'ok',
    stderr: '',
    duration: 100,
    timedOut: false,
    ...overrides,
  };
}

function makeSwitchResult(overrides: Partial<SwitchResult> = {}): SwitchResult {
  return {
    stepId: 'install-pnpm',
    success: true,
    successCommand: 'npm install -g pnpm',
    successAlternativeId: null,
    attempts: [
      {
        command: 'npm install -g pnpm',
        type: 'primary',
        alternativeId: null,
        result: makeExecResult({ command: 'npm install -g pnpm' }),
        timestamp: 1000,
      },
    ],
    totalAttempts: 1,
    ...overrides,
  };
}

// ============================================================================
// SuccessRateTracker - recording
// ============================================================================

describe('SuccessRateTracker', () => {
  let tracker: SuccessRateTracker;

  beforeEach(() => {
    tracker = new SuccessRateTracker();
  });

  describe('recordOutcome', () => {
    it('records a single outcome', () => {
      tracker.recordOutcome(makeOutcome());
      expect(tracker.getOutcomeCount()).toBe(1);
    });

    it('records multiple outcomes', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'a' }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'b' }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'c' }));
      expect(tracker.getOutcomeCount()).toBe(3);
    });

    it('does not mutate the original outcome object', () => {
      const outcome = makeOutcome();
      tracker.recordOutcome(outcome);
      outcome.success = false;
      const recorded = tracker.getOutcomes();
      expect(recorded[0].success).toBe(true);
    });
  });

  describe('recordSwitchResult', () => {
    it('records primary success correctly', () => {
      const switchResult = makeSwitchResult();
      tracker.recordSwitchResult(switchResult);

      const outcomes = tracker.getOutcomes();
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].solutionId).toBe('primary');
      expect(outcomes[0].stepId).toBe('install-pnpm');
      expect(outcomes[0].success).toBe(true);
    });

    it('records primary failure and alternative success', () => {
      const switchResult = makeSwitchResult({
        success: true,
        successCommand: 'brew install pnpm',
        successAlternativeId: 'install-pnpm-brew',
        attempts: [
          {
            command: 'npm install -g pnpm',
            type: 'primary',
            alternativeId: null,
            result: makeExecResult({
              command: 'npm install -g pnpm',
              exitCode: 1,
              stderr: 'EACCES',
            }),
            timestamp: 1000,
          },
          {
            command: 'brew install pnpm',
            type: 'alternative',
            alternativeId: 'install-pnpm-brew',
            result: makeExecResult({ command: 'brew install pnpm' }),
            timestamp: 2000,
          },
        ],
        totalAttempts: 2,
      });

      tracker.recordSwitchResult(switchResult);

      const outcomes = tracker.getOutcomes();
      expect(outcomes).toHaveLength(2);

      // Primary should be marked as failed
      expect(outcomes[0].solutionId).toBe('primary');
      expect(outcomes[0].success).toBe(false);

      // Alternative should be marked as succeeded
      expect(outcomes[1].solutionId).toBe('install-pnpm-brew');
      expect(outcomes[1].success).toBe(true);
    });

    it('records all failures when no command succeeds', () => {
      const switchResult = makeSwitchResult({
        success: false,
        successCommand: null,
        successAlternativeId: null,
        attempts: [
          {
            command: 'npm install -g pnpm',
            type: 'primary',
            alternativeId: null,
            result: makeExecResult({
              command: 'npm install -g pnpm',
              exitCode: 1,
              stderr: 'error 1',
            }),
            timestamp: 1000,
          },
          {
            command: 'corepack enable',
            type: 'alternative',
            alternativeId: 'install-pnpm-corepack',
            result: makeExecResult({
              command: 'corepack enable',
              exitCode: 1,
              stderr: 'error 2',
            }),
            timestamp: 2000,
          },
        ],
        totalAttempts: 2,
      });

      tracker.recordSwitchResult(switchResult);

      const outcomes = tracker.getOutcomes();
      expect(outcomes).toHaveLength(2);
      expect(outcomes.every((o) => o.success === false)).toBe(true);
    });

    it('records error messages for failed attempts', () => {
      const switchResult = makeSwitchResult({
        success: false,
        successCommand: null,
        successAlternativeId: null,
        attempts: [
          {
            command: 'npm install -g pnpm',
            type: 'primary',
            alternativeId: null,
            result: makeExecResult({
              command: 'npm install -g pnpm',
              exitCode: 1,
              stderr: 'EACCES: permission denied',
            }),
            timestamp: 1000,
          },
        ],
        totalAttempts: 1,
      });

      tracker.recordSwitchResult(switchResult);

      const outcomes = tracker.getOutcomes();
      expect(outcomes[0].errorMessage).toBe('EACCES: permission denied');
    });

    it('records duration from exec results', () => {
      const switchResult = makeSwitchResult({
        attempts: [
          {
            command: 'npm install -g pnpm',
            type: 'primary',
            alternativeId: null,
            result: makeExecResult({ duration: 5000 }),
            timestamp: 1000,
          },
        ],
      });

      tracker.recordSwitchResult(switchResult);

      const outcomes = tracker.getOutcomes();
      expect(outcomes[0].durationMs).toBe(5000);
    });
  });

  // ============================================================================
  // Querying
  // ============================================================================

  describe('getOutcomes', () => {
    it('returns a copy (not reference)', () => {
      tracker.recordOutcome(makeOutcome());
      const outcomes = tracker.getOutcomes();
      outcomes.push(makeOutcome({ solutionId: 'injected' }));
      expect(tracker.getOutcomeCount()).toBe(1);
    });
  });

  describe('getStats', () => {
    it('returns null for unknown solution', () => {
      expect(tracker.getStats('nonexistent')).toBeNull();
    });

    it('calculates stats for a solution with all successes', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'sol-a', success: true, durationMs: 100 }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'sol-a', success: true, durationMs: 200 }));

      const stats = tracker.getStats('sol-a');
      expect(stats).not.toBeNull();
      expect(stats!.totalAttempts).toBe(2);
      expect(stats!.successCount).toBe(2);
      expect(stats!.failureCount).toBe(0);
      expect(stats!.successRate).toBe(1.0);
      expect(stats!.avgSuccessDurationMs).toBe(150);
    });

    it('calculates stats for a solution with all failures', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'sol-b', success: false }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'sol-b', success: false }));

      const stats = tracker.getStats('sol-b');
      expect(stats!.successRate).toBe(0.0);
      expect(stats!.failureCount).toBe(2);
      expect(stats!.avgSuccessDurationMs).toBeNull();
    });

    it('calculates stats for mixed outcomes', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'sol-c', success: true, durationMs: 100 }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'sol-c', success: false }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'sol-c', success: true, durationMs: 300 }));

      const stats = tracker.getStats('sol-c');
      expect(stats!.totalAttempts).toBe(3);
      expect(stats!.successCount).toBe(2);
      expect(stats!.failureCount).toBe(1);
      expect(stats!.successRate).toBeCloseTo(2 / 3);
      expect(stats!.avgSuccessDurationMs).toBe(200);
    });

    it('tracks lastAttemptAt correctly', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'sol-d', timestamp: 1000 }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'sol-d', timestamp: 3000 }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'sol-d', timestamp: 2000 }));

      const stats = tracker.getStats('sol-d');
      expect(stats!.lastAttemptAt).toBe(3000);
    });

    it('handles outcomes without durationMs', () => {
      tracker.recordOutcome(makeOutcome({
        solutionId: 'sol-e',
        success: true,
        durationMs: undefined,
      }));

      const stats = tracker.getStats('sol-e');
      expect(stats!.avgSuccessDurationMs).toBeNull();
    });
  });

  describe('getAllStats', () => {
    it('returns empty array when no outcomes', () => {
      expect(tracker.getAllStats()).toEqual([]);
    });

    it('returns stats for all tracked solutions', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'a', success: true }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'b', success: false }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'c', success: true }));

      const allStats = tracker.getAllStats();
      expect(allStats).toHaveLength(3);
    });

    it('sorts by success rate descending', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'low', success: false }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'high', success: true }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'mid', success: true }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'mid', success: false }));

      const allStats = tracker.getAllStats();
      expect(allStats[0].solutionId).toBe('high');
      expect(allStats[0].successRate).toBe(1.0);
      expect(allStats[1].solutionId).toBe('mid');
      expect(allStats[1].successRate).toBe(0.5);
      expect(allStats[2].solutionId).toBe('low');
      expect(allStats[2].successRate).toBe(0.0);
    });
  });

  describe('getStatsByStep', () => {
    it('returns empty array when no outcomes for step', () => {
      tracker.recordOutcome(makeOutcome({ stepId: 'install-openclaw' }));
      expect(tracker.getStatsByStep('install-pnpm')).toEqual([]);
    });

    it('returns stats filtered by step', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'a', stepId: 'install-pnpm', success: true }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'a', stepId: 'install-openclaw', success: false }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'b', stepId: 'install-pnpm', success: false }));

      const stats = tracker.getStatsByStep('install-pnpm');
      expect(stats).toHaveLength(2);

      const statA = stats.find((s) => s.solutionId === 'a');
      expect(statA!.totalAttempts).toBe(1);
      expect(statA!.successRate).toBe(1.0);

      const statB = stats.find((s) => s.solutionId === 'b');
      expect(statB!.totalAttempts).toBe(1);
      expect(statB!.successRate).toBe(0.0);
    });

    it('sorts by success rate descending', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'x', stepId: 's1', success: false }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'y', stepId: 's1', success: true }));

      const stats = tracker.getStatsByStep('s1');
      expect(stats[0].solutionId).toBe('y');
      expect(stats[1].solutionId).toBe('x');
    });
  });

  // ============================================================================
  // Confidence adjustment
  // ============================================================================

  describe('adjustConfidence', () => {
    it('returns original confidence when no data exists', () => {
      const adjusted = tracker.adjustConfidence('unknown', 0.8);
      expect(adjusted).toBe(0.8);
    });

    it('returns original confidence when below minAttempts', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'few', success: true }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'few', success: true }));

      const adjusted = tracker.adjustConfidence('few', 0.5, { minAttempts: 3 });
      expect(adjusted).toBe(0.5);
    });

    it('adjusts confidence upward when success rate is higher', () => {
      // 100% success rate over 5 attempts
      for (let i = 0; i < 5; i++) {
        tracker.recordOutcome(makeOutcome({ solutionId: 'good', success: true }));
      }

      // Original confidence 0.5, success rate 1.0, weight 0.5
      // Expected: 0.5 * 0.5 + 1.0 * 0.5 = 0.75
      const adjusted = tracker.adjustConfidence('good', 0.5, {
        minAttempts: 3,
        historyWeight: 0.5,
      });
      expect(adjusted).toBeCloseTo(0.75);
    });

    it('adjusts confidence downward when success rate is lower', () => {
      // 0% success rate over 5 attempts
      for (let i = 0; i < 5; i++) {
        tracker.recordOutcome(makeOutcome({ solutionId: 'bad', success: false }));
      }

      // Original confidence 0.8, success rate 0.0, weight 0.5
      // Expected: 0.8 * 0.5 + 0.0 * 0.5 = 0.4
      const adjusted = tracker.adjustConfidence('bad', 0.8, {
        minAttempts: 3,
        historyWeight: 0.5,
      });
      expect(adjusted).toBeCloseTo(0.4);
    });

    it('clamps result to [0, 1]', () => {
      for (let i = 0; i < 5; i++) {
        tracker.recordOutcome(makeOutcome({ solutionId: 'max', success: true }));
      }

      // Even with high original + high success rate, should not exceed 1
      const adjusted = tracker.adjustConfidence('max', 1.0, {
        minAttempts: 3,
        historyWeight: 0.5,
      });
      expect(adjusted).toBeLessThanOrEqual(1.0);
      expect(adjusted).toBeGreaterThanOrEqual(0.0);
    });

    it('uses default options when not provided', () => {
      for (let i = 0; i < 3; i++) {
        tracker.recordOutcome(makeOutcome({ solutionId: 'def', success: true }));
      }

      // Default minAttempts=3, historyWeight=0.5
      const adjusted = tracker.adjustConfidence('def', 0.6);
      // 0.6 * 0.5 + 1.0 * 0.5 = 0.8
      expect(adjusted).toBeCloseTo(0.8);
    });

    it('handles mixed success rate correctly', () => {
      // 2/4 = 50% success rate
      tracker.recordOutcome(makeOutcome({ solutionId: 'mix', success: true }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'mix', success: true }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'mix', success: false }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'mix', success: false }));

      // Original 0.8, success rate 0.5, weight 0.5
      // Expected: 0.8 * 0.5 + 0.5 * 0.5 = 0.65
      const adjusted = tracker.adjustConfidence('mix', 0.8, {
        minAttempts: 3,
        historyWeight: 0.5,
      });
      expect(adjusted).toBeCloseTo(0.65);
    });
  });

  // ============================================================================
  // Persistence
  // ============================================================================

  describe('exportSnapshot / importSnapshot', () => {
    it('exports a snapshot with all outcomes', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'a' }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'b' }));

      const snapshot = tracker.exportSnapshot();
      expect(snapshot.outcomes).toHaveLength(2);
      expect(snapshot.exportedAt).toBeGreaterThan(0);
    });

    it('imports a snapshot and merges with existing data', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'existing' }));

      const snapshot: TrackerSnapshot = {
        outcomes: [
          makeOutcome({ solutionId: 'imported-1' }),
          makeOutcome({ solutionId: 'imported-2' }),
        ],
        exportedAt: Date.now(),
      };

      tracker.importSnapshot(snapshot);
      expect(tracker.getOutcomeCount()).toBe(3);
    });

    it('roundtrips correctly (export then import into new tracker)', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'x', success: true, durationMs: 200 }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'x', success: false }));

      const snapshot = tracker.exportSnapshot();

      const newTracker = new SuccessRateTracker();
      newTracker.importSnapshot(snapshot);

      const stats = newTracker.getStats('x');
      expect(stats!.totalAttempts).toBe(2);
      expect(stats!.successCount).toBe(1);
      expect(stats!.successRate).toBe(0.5);
    });

    it('exported snapshot does not share references', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'ref-test' }));
      const snapshot = tracker.exportSnapshot();

      // Mutate snapshot
      snapshot.outcomes.push(makeOutcome({ solutionId: 'injected' }));

      // Original tracker should not be affected
      expect(tracker.getOutcomeCount()).toBe(1);
    });
  });

  describe('clear', () => {
    it('removes all outcomes', () => {
      tracker.recordOutcome(makeOutcome({ solutionId: 'a' }));
      tracker.recordOutcome(makeOutcome({ solutionId: 'b' }));
      expect(tracker.getOutcomeCount()).toBe(2);

      tracker.clear();
      expect(tracker.getOutcomeCount()).toBe(0);
      expect(tracker.getAllStats()).toEqual([]);
    });
  });
});

// ============================================================================
// formatSuccessRate
// ============================================================================

describe('formatSuccessRate', () => {
  it('formats stats with success duration', () => {
    const stats: SuccessRateStats = {
      solutionId: 'use-mirror',
      totalAttempts: 10,
      successCount: 8,
      failureCount: 2,
      successRate: 0.8,
      avgSuccessDurationMs: 1500,
      lastAttemptAt: Date.now(),
    };

    const formatted = formatSuccessRate(stats);
    expect(formatted).toContain('use-mirror');
    expect(formatted).toContain('80.0%');
    expect(formatted).toContain('8/10');
    expect(formatted).toContain('avg 1500ms');
  });

  it('formats stats without success duration', () => {
    const stats: SuccessRateStats = {
      solutionId: 'failed-sol',
      totalAttempts: 5,
      successCount: 0,
      failureCount: 5,
      successRate: 0.0,
      avgSuccessDurationMs: null,
      lastAttemptAt: Date.now(),
    };

    const formatted = formatSuccessRate(stats);
    expect(formatted).toContain('failed-sol');
    expect(formatted).toContain('0.0%');
    expect(formatted).toContain('0/5');
    expect(formatted).not.toContain('avg');
  });

  it('formats fractional success rate', () => {
    const stats: SuccessRateStats = {
      solutionId: 'partial',
      totalAttempts: 3,
      successCount: 1,
      failureCount: 2,
      successRate: 1 / 3,
      avgSuccessDurationMs: 200,
      lastAttemptAt: Date.now(),
    };

    const formatted = formatSuccessRate(stats);
    expect(formatted).toContain('33.3%');
    expect(formatted).toContain('1/3');
  });
});

// ============================================================================
// rankBySuccessRate
// ============================================================================

describe('rankBySuccessRate', () => {
  let tracker: SuccessRateTracker;

  beforeEach(() => {
    tracker = new SuccessRateTracker();
  });

  it('ranks solutions by success rate (best first)', () => {
    // 'a' has 100% success
    tracker.recordOutcome(makeOutcome({ solutionId: 'a', success: true }));
    tracker.recordOutcome(makeOutcome({ solutionId: 'a', success: true }));

    // 'b' has 50% success
    tracker.recordOutcome(makeOutcome({ solutionId: 'b', success: true }));
    tracker.recordOutcome(makeOutcome({ solutionId: 'b', success: false }));

    // 'c' has 0% success
    tracker.recordOutcome(makeOutcome({ solutionId: 'c', success: false }));

    const ranked = rankBySuccessRate(['c', 'a', 'b'], tracker);
    expect(ranked).toEqual(['a', 'b', 'c']);
  });

  it('places solutions without data at the end', () => {
    tracker.recordOutcome(makeOutcome({ solutionId: 'known', success: true }));

    const ranked = rankBySuccessRate(['unknown', 'known', 'also-unknown'], tracker);
    expect(ranked[0]).toBe('known');
    // Unknown solutions should come after known ones
    expect(ranked.slice(1)).toEqual(['unknown', 'also-unknown']);
  });

  it('preserves order for solutions without data', () => {
    const ranked = rankBySuccessRate(['z', 'a', 'm'], tracker);
    expect(ranked).toEqual(['z', 'a', 'm']);
  });

  it('handles empty input', () => {
    const ranked = rankBySuccessRate([], tracker);
    expect(ranked).toEqual([]);
  });

  it('handles single solution', () => {
    tracker.recordOutcome(makeOutcome({ solutionId: 'only', success: true }));
    const ranked = rankBySuccessRate(['only'], tracker);
    expect(ranked).toEqual(['only']);
  });
});

// ============================================================================
// Integration: SwitchResult → stats → adjustConfidence
// ============================================================================

describe('integration: SwitchResult to adjusted confidence', () => {
  let tracker: SuccessRateTracker;

  beforeEach(() => {
    tracker = new SuccessRateTracker();
  });

  it('records multiple switch results and produces accurate stats', () => {
    // Simulate 3 sessions where primary fails but brew succeeds
    for (let i = 0; i < 3; i++) {
      tracker.recordSwitchResult(makeSwitchResult({
        stepId: 'install-pnpm',
        success: true,
        successCommand: 'brew install pnpm',
        successAlternativeId: 'install-pnpm-brew',
        attempts: [
          {
            command: 'npm install -g pnpm',
            type: 'primary',
            alternativeId: null,
            result: makeExecResult({ exitCode: 1, stderr: 'EACCES' }),
            timestamp: 1000 + i,
          },
          {
            command: 'brew install pnpm',
            type: 'alternative',
            alternativeId: 'install-pnpm-brew',
            result: makeExecResult({ exitCode: 0 }),
            timestamp: 2000 + i,
          },
        ],
        totalAttempts: 2,
      }));
    }

    // Primary should have 0% success rate
    const primaryStats = tracker.getStats('primary');
    expect(primaryStats!.successRate).toBe(0.0);
    expect(primaryStats!.totalAttempts).toBe(3);

    // Brew alternative should have 100% success rate
    const brewStats = tracker.getStats('install-pnpm-brew');
    expect(brewStats!.successRate).toBe(1.0);
    expect(brewStats!.totalAttempts).toBe(3);

    // Adjust confidence: brew original 0.75, should increase
    const adjusted = tracker.adjustConfidence('install-pnpm-brew', 0.75, {
      minAttempts: 3,
      historyWeight: 0.5,
    });
    // 0.75 * 0.5 + 1.0 * 0.5 = 0.875
    expect(adjusted).toBeCloseTo(0.875);
  });

  it('step-filtered stats exclude other steps', () => {
    // Record brew success on install-pnpm
    tracker.recordSwitchResult(makeSwitchResult({
      stepId: 'install-pnpm',
      success: true,
      successAlternativeId: 'install-pnpm-brew',
      attempts: [
        {
          command: 'npm install -g pnpm',
          type: 'primary',
          alternativeId: null,
          result: makeExecResult({ exitCode: 1 }),
          timestamp: 1000,
        },
        {
          command: 'brew install pnpm',
          type: 'alternative',
          alternativeId: 'install-pnpm-brew',
          result: makeExecResult({ exitCode: 0 }),
          timestamp: 2000,
        },
      ],
      totalAttempts: 2,
    }));

    // Record primary success on check-node
    tracker.recordSwitchResult(makeSwitchResult({
      stepId: 'check-node',
      success: true,
      successAlternativeId: null,
      attempts: [
        {
          command: 'node --version',
          type: 'primary',
          alternativeId: null,
          result: makeExecResult({ exitCode: 0 }),
          timestamp: 3000,
        },
      ],
      totalAttempts: 1,
    }));

    // Stats for install-pnpm should only include that step's data
    const pnpmStats = tracker.getStatsByStep('install-pnpm');
    expect(pnpmStats).toHaveLength(2); // primary + install-pnpm-brew

    // Stats for check-node should only include that step's data
    const nodeStats = tracker.getStatsByStep('check-node');
    expect(nodeStats).toHaveLength(1); // primary only
    expect(nodeStats[0].solutionId).toBe('primary');
    expect(nodeStats[0].successRate).toBe(1.0);
  });
});
