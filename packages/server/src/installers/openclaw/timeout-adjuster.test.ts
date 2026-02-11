// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for dynamic step timeout adjustment module.
 */

import { describe, it, expect } from 'vitest';
import type { InstallStep, EnvironmentInfo } from '@aiinstaller/shared';
import {
  TimeoutAdjuster,
  adjustStepTimeouts,
  categorizeStep,
  mean,
  stddev,
  weightedMean,
  environmentFactor,
  DEFAULT_CONFIG,
  type ExecutionRecord,
  type TimeoutAdjusterConfig,
} from './timeout-adjuster.js';
import {
  createCheckNodeStep,
  createInstallPnpmStep,
  createInstallOpenClawStep,
  createConfigureOpenClawStep,
  createVerifyInstallationStep,
  ALL_STEPS,
  QUICK_TIMEOUT,
  INSTALL_TIMEOUT,
  HEAVY_INSTALL_TIMEOUT,
} from './steps.js';

// ============================================================================
// Helpers
// ============================================================================

function createStep(overrides: Partial<InstallStep> = {}): InstallStep {
  return {
    id: 'test-step',
    description: 'Test step',
    command: 'echo test',
    timeout: 30_000,
    canRollback: false,
    onError: 'retry',
    ...overrides,
  };
}

function createRecord(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    stepId: 'test-step',
    duration: 5000,
    success: true,
    timedOut: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

function createEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '14.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.0.0' },
    packageManagers: { npm: '10.0.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    ...overrides,
  };
}

// ============================================================================
// categorizeStep
// ============================================================================

describe('categorizeStep', () => {
  it('should categorize steps with QUICK_TIMEOUT as quick', () => {
    expect(categorizeStep(createStep({ timeout: QUICK_TIMEOUT }))).toBe('quick');
  });

  it('should categorize steps with timeout below QUICK_TIMEOUT as quick', () => {
    expect(categorizeStep(createStep({ timeout: 10_000 }))).toBe('quick');
  });

  it('should categorize steps with INSTALL_TIMEOUT as install', () => {
    expect(categorizeStep(createStep({ timeout: INSTALL_TIMEOUT }))).toBe('install');
  });

  it('should categorize steps with timeout between QUICK and INSTALL as install', () => {
    expect(categorizeStep(createStep({ timeout: 45_000 }))).toBe('install');
  });

  it('should categorize steps with HEAVY_INSTALL_TIMEOUT as heavy', () => {
    expect(categorizeStep(createStep({ timeout: HEAVY_INSTALL_TIMEOUT }))).toBe('heavy');
  });

  it('should categorize steps with timeout above INSTALL as heavy', () => {
    expect(categorizeStep(createStep({ timeout: 90_000 }))).toBe('heavy');
  });

  it('should correctly categorize actual step definitions', () => {
    expect(categorizeStep(createCheckNodeStep())).toBe('quick');
    expect(categorizeStep(createInstallPnpmStep())).toBe('install');
    expect(categorizeStep(createInstallOpenClawStep())).toBe('heavy');
    expect(categorizeStep(createVerifyInstallationStep())).toBe('quick');
  });
});

// ============================================================================
// mean
// ============================================================================

describe('mean', () => {
  it('should return 0 for empty array', () => {
    expect(mean([])).toBe(0);
  });

  it('should return the single value for single-element array', () => {
    expect(mean([42])).toBe(42);
  });

  it('should compute the arithmetic mean', () => {
    expect(mean([10, 20, 30])).toBe(20);
  });

  it('should handle floating point values', () => {
    expect(mean([1.5, 2.5])).toBe(2);
  });
});

// ============================================================================
// stddev
// ============================================================================

describe('stddev', () => {
  it('should return 0 for empty array', () => {
    expect(stddev([])).toBe(0);
  });

  it('should return 0 for single-element array', () => {
    expect(stddev([42])).toBe(0);
  });

  it('should return 0 for identical values', () => {
    expect(stddev([10, 10, 10])).toBe(0);
  });

  it('should compute population standard deviation', () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, stddev=2
    const result = stddev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(result).toBeCloseTo(2, 5);
  });
});

// ============================================================================
// weightedMean
// ============================================================================

describe('weightedMean', () => {
  it('should return 0 for empty array', () => {
    expect(weightedMean([], 0.8)).toBe(0);
  });

  it('should return the single value for single-element array', () => {
    expect(weightedMean([42], 0.8)).toBe(42);
  });

  it('should weight recent values more heavily', () => {
    // With decay 0.8, last element has highest weight
    // [100, 200] → weights: [0.8, 1.0] → (100*0.8 + 200*1.0) / (0.8+1.0) = 280/1.8 ≈ 155.6
    const result = weightedMean([100, 200], 0.8);
    expect(result).toBeGreaterThan(150); // weighted toward 200
    expect(result).toBeLessThan(200);
  });

  it('should return arithmetic mean when decay factor is 1.0', () => {
    const result = weightedMean([10, 20, 30], 1.0);
    expect(result).toBe(20);
  });

  it('should heavily weight the most recent value with small decay', () => {
    const result = weightedMean([100, 200], 0.1);
    expect(result).toBeGreaterThan(180); // heavily weighted toward 200
  });
});

// ============================================================================
// environmentFactor
// ============================================================================

describe('environmentFactor', () => {
  it('should return 1.0 when no environment is provided', () => {
    const step = createInstallPnpmStep();
    expect(environmentFactor(undefined, step)).toBe(1.0);
  });

  it('should return 1.0 for healthy environment', () => {
    const env = createEnv();
    const step = createInstallPnpmStep();
    expect(environmentFactor(env, step)).toBe(1.0);
  });

  it('should return 1.0 for quick steps even with network issues', () => {
    const env = createEnv({ network: { canAccessNpm: false, canAccessGithub: false } });
    const step = createCheckNodeStep(); // quick category
    expect(environmentFactor(env, step)).toBe(1.0);
  });

  it('should return 2.0 for install steps when npm is unreachable', () => {
    const env = createEnv({ network: { canAccessNpm: false, canAccessGithub: false } });
    const step = createInstallPnpmStep();
    expect(environmentFactor(env, step)).toBe(2.0);
  });

  it('should return 1.3 for install steps when only GitHub is unreachable', () => {
    const env = createEnv({ network: { canAccessNpm: true, canAccessGithub: false } });
    const step = createInstallOpenClawStep();
    expect(environmentFactor(env, step)).toBeCloseTo(1.3);
  });

  it('should apply Windows factor for win32 platform', () => {
    const env = createEnv({ os: { platform: 'win32', version: '10', arch: 'x64' } });
    const step = createInstallPnpmStep();
    expect(environmentFactor(env, step)).toBeCloseTo(1.2);
  });

  it('should compound network and Windows factors', () => {
    const env = createEnv({
      os: { platform: 'win32', version: '10', arch: 'x64' },
      network: { canAccessNpm: false, canAccessGithub: false },
    });
    const step = createInstallOpenClawStep();
    // 2.0 (npm unreachable) * 1.2 (windows) = 2.4
    expect(environmentFactor(env, step)).toBeCloseTo(2.4);
  });
});

// ============================================================================
// TimeoutAdjuster - constructor and config
// ============================================================================

describe('TimeoutAdjuster', () => {
  describe('constructor', () => {
    it('should use default config when no config provided', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createStep();
      const result = adjuster.adjustTimeout(step);
      // With no history and no env, timeout should stay the same
      expect(result.adjustedTimeout).toBe(step.timeout);
    });

    it('should merge partial config with defaults', () => {
      const adjuster = new TimeoutAdjuster({ minTimeout: 5_000 });
      const step = createStep({ timeout: 3_000 });
      adjuster.recordExecution(createRecord({ duration: 2_000 }));
      const result = adjuster.adjustTimeout(step);
      expect(result.adjustedTimeout).toBeGreaterThanOrEqual(5_000);
    });
  });

  // ==========================================================================
  // recordExecution / getHistory
  // ==========================================================================

  describe('recordExecution', () => {
    it('should store execution records', () => {
      const adjuster = new TimeoutAdjuster();
      adjuster.recordExecution(createRecord({ stepId: 'step-1' }));
      expect(adjuster.getHistory('step-1')).toHaveLength(1);
    });

    it('should accumulate multiple records for the same step', () => {
      const adjuster = new TimeoutAdjuster();
      adjuster.recordExecution(createRecord({ stepId: 'step-1', duration: 100 }));
      adjuster.recordExecution(createRecord({ stepId: 'step-1', duration: 200 }));
      expect(adjuster.getHistory('step-1')).toHaveLength(2);
    });

    it('should keep records separate per step', () => {
      const adjuster = new TimeoutAdjuster();
      adjuster.recordExecution(createRecord({ stepId: 'step-1' }));
      adjuster.recordExecution(createRecord({ stepId: 'step-2' }));
      expect(adjuster.getHistory('step-1')).toHaveLength(1);
      expect(adjuster.getHistory('step-2')).toHaveLength(1);
    });

    it('should trim history to maxHistoryPerStep', () => {
      const adjuster = new TimeoutAdjuster({ maxHistoryPerStep: 3 });
      for (let i = 0; i < 5; i++) {
        adjuster.recordExecution(createRecord({ stepId: 'step-1', duration: i * 100 }));
      }
      const history = adjuster.getHistory('step-1');
      expect(history).toHaveLength(3);
      // Should keep the most recent 3 (durations: 200, 300, 400)
      expect(history[0]!.duration).toBe(200);
      expect(history[2]!.duration).toBe(400);
    });
  });

  describe('recordStepResult', () => {
    it('should convert StepResult to ExecutionRecord', () => {
      const adjuster = new TimeoutAdjuster();
      adjuster.recordStepResult({
        stepId: 'step-1',
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        duration: 5000,
      });
      const history = adjuster.getHistory('step-1');
      expect(history).toHaveLength(1);
      expect(history[0]!.duration).toBe(5000);
      expect(history[0]!.success).toBe(true);
      expect(history[0]!.timedOut).toBe(false);
    });

    it('should accept timedOut flag', () => {
      const adjuster = new TimeoutAdjuster();
      adjuster.recordStepResult(
        {
          stepId: 'step-1',
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: '',
          duration: 30000,
        },
        true,
      );
      expect(adjuster.getHistory('step-1')[0]!.timedOut).toBe(true);
    });
  });

  describe('clearHistory', () => {
    it('should remove all records', () => {
      const adjuster = new TimeoutAdjuster();
      adjuster.recordExecution(createRecord({ stepId: 'step-1' }));
      adjuster.recordExecution(createRecord({ stepId: 'step-2' }));
      adjuster.clearHistory();
      expect(adjuster.getHistory('step-1')).toHaveLength(0);
      expect(adjuster.getHistory('step-2')).toHaveLength(0);
    });
  });

  // ==========================================================================
  // adjustTimeout - no history
  // ==========================================================================

  describe('adjustTimeout - no history', () => {
    it('should return original timeout with no env and no history', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createStep({ timeout: 60_000 });
      const result = adjuster.adjustTimeout(step);

      expect(result.stepId).toBe('test-step');
      expect(result.originalTimeout).toBe(60_000);
      expect(result.adjustedTimeout).toBe(60_000);
      expect(result.confidence).toBe(0);
      expect(result.reason).toContain('no history');
    });

    it('should apply environment factor with no history', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createStep({ timeout: 60_000 });
      const env = createEnv({ network: { canAccessNpm: false, canAccessGithub: false } });
      const result = adjuster.adjustTimeout(step, env);

      expect(result.adjustedTimeout).toBe(120_000); // 60k * 2.0
      expect(result.confidence).toBe(0.2);
      expect(result.reason).toContain('environment factor');
    });

    it('should not apply network factor to quick steps without history', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createStep({ timeout: QUICK_TIMEOUT });
      const env = createEnv({ network: { canAccessNpm: false, canAccessGithub: false } });
      const result = adjuster.adjustTimeout(step, env);

      expect(result.adjustedTimeout).toBe(QUICK_TIMEOUT);
    });
  });

  // ==========================================================================
  // adjustTimeout - with history
  // ==========================================================================

  describe('adjustTimeout - with history', () => {
    it('should adjust based on mean + safety margin for single record', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createStep({ timeout: 60_000 });
      adjuster.recordExecution(createRecord({ duration: 10_000 }));

      const result = adjuster.adjustTimeout(step);

      // Single record: stddev=0, so adjusted = max(mean + 0, mean * 1.5) = 15000
      expect(result.adjustedTimeout).toBe(15_000);
      expect(result.confidence).toBe(0.1); // 1/10
    });

    it('should increase confidence with more data points', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createStep({ timeout: 60_000 });
      for (let i = 0; i < 10; i++) {
        adjuster.recordExecution(createRecord({ duration: 10_000 }));
      }

      const result = adjuster.adjustTimeout(step);
      expect(result.confidence).toBe(1.0); // 10/10
    });

    it('should use stddev for safety margin with varied history', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createStep({ timeout: 60_000 });

      // Add varied durations
      adjuster.recordExecution(createRecord({ duration: 8_000 }));
      adjuster.recordExecution(createRecord({ duration: 10_000 }));
      adjuster.recordExecution(createRecord({ duration: 12_000 }));
      adjuster.recordExecution(createRecord({ duration: 10_000 }));

      const result = adjuster.adjustTimeout(step);

      // Mean ≈ 10000 (weighted), stddev should be ~1.4k
      // adjusted = mean + 2*stddev, or mean * 1.5, whichever is larger
      expect(result.adjustedTimeout).toBeGreaterThan(13_000);
      expect(result.adjustedTimeout).toBeLessThan(25_000);
    });

    it('should clamp to minTimeout', () => {
      const adjuster = new TimeoutAdjuster({ minTimeout: 10_000 });
      const step = createStep({ timeout: 30_000 });
      adjuster.recordExecution(createRecord({ duration: 1_000 })); // very fast

      const result = adjuster.adjustTimeout(step);
      expect(result.adjustedTimeout).toBeGreaterThanOrEqual(10_000);
    });

    it('should clamp to maxTimeout', () => {
      const adjuster = new TimeoutAdjuster({ maxTimeout: 300_000 });
      const step = createStep({ timeout: 120_000 });
      adjuster.recordExecution(
        createRecord({ duration: 200_000, timedOut: true }),
      );

      const result = adjuster.adjustTimeout(step);
      expect(result.adjustedTimeout).toBeLessThanOrEqual(300_000);
    });

    it('should only use successful durations for statistical adjustment', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createStep({ timeout: 60_000 });

      // Add a failed record and successful records
      adjuster.recordExecution(createRecord({ duration: 50_000, success: false }));
      adjuster.recordExecution(createRecord({ duration: 10_000, success: true }));

      const result = adjuster.adjustTimeout(step);
      // Should be based on the successful 10s, not the failed 50s
      expect(result.adjustedTimeout).toBeLessThan(30_000);
    });

    it('should fall back to no-history logic if all records are failures', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createStep({ timeout: 60_000 });
      adjuster.recordExecution(createRecord({ duration: 5_000, success: false, timedOut: false }));

      const result = adjuster.adjustTimeout(step);
      // Should use no-history path → original timeout
      expect(result.adjustedTimeout).toBe(60_000);
      expect(result.reason).toContain('no history');
    });
  });

  // ==========================================================================
  // adjustTimeout - timeout recovery
  // ==========================================================================

  describe('adjustTimeout - timeout recovery', () => {
    it('should multiply by timeoutMultiplier when timeout occurred', () => {
      const adjuster = new TimeoutAdjuster({ timeoutMultiplier: 2.0 });
      const step = createStep({ timeout: 60_000 });
      adjuster.recordExecution(createRecord({ duration: 60_000, timedOut: true, success: false }));

      const result = adjuster.adjustTimeout(step);
      // 60000 * 2.0 = 120000
      expect(result.adjustedTimeout).toBe(120_000);
      expect(result.confidence).toBe(0.8);
      expect(result.reason).toContain('timeout');
    });

    it('should use the highest timed-out duration', () => {
      const adjuster = new TimeoutAdjuster({ timeoutMultiplier: 2.0 });
      const step = createStep({ timeout: 60_000 });
      adjuster.recordExecution(createRecord({ duration: 30_000, timedOut: true, success: false }));
      adjuster.recordExecution(createRecord({ duration: 60_000, timedOut: true, success: false }));

      const result = adjuster.adjustTimeout(step);
      // max(30000, 60000) * 2.0 = 120000
      expect(result.adjustedTimeout).toBe(120_000);
    });

    it('should prioritize timeout adjustment over successful history', () => {
      const adjuster = new TimeoutAdjuster({ timeoutMultiplier: 2.0 });
      const step = createStep({ timeout: 60_000 });

      // Some successful, then a timeout
      adjuster.recordExecution(createRecord({ duration: 5_000, success: true }));
      adjuster.recordExecution(createRecord({ duration: 60_000, timedOut: true, success: false }));

      const result = adjuster.adjustTimeout(step);
      // Should use timeout multiplier path, not statistical path
      expect(result.adjustedTimeout).toBe(120_000);
      expect(result.reason).toContain('timeout');
    });

    it('should apply environment factor on top of timeout multiplier', () => {
      const adjuster = new TimeoutAdjuster({ timeoutMultiplier: 2.0 });
      const step = createStep({ timeout: INSTALL_TIMEOUT });
      const env = createEnv({
        os: { platform: 'win32', version: '10', arch: 'x64' },
      });
      adjuster.recordExecution(createRecord({ stepId: step.id, duration: 60_000, timedOut: true, success: false }));

      const result = adjuster.adjustTimeout(step, env);
      // 60000 * 2.0 * 1.2 (windows) = 144000
      expect(result.adjustedTimeout).toBe(144_000);
    });
  });

  // ==========================================================================
  // adjustAllTimeouts
  // ==========================================================================

  describe('adjustAllTimeouts', () => {
    it('should adjust all steps and return both adjusted steps and adjustments', () => {
      const adjuster = new TimeoutAdjuster();
      const steps = [
        createStep({ id: 'step-1', timeout: 30_000 }),
        createStep({ id: 'step-2', timeout: 60_000 }),
      ];

      adjuster.recordExecution(createRecord({ stepId: 'step-1', duration: 5_000 }));

      const { steps: adjusted, adjustments } = adjuster.adjustAllTimeouts(steps);

      expect(adjusted).toHaveLength(2);
      expect(adjustments).toHaveLength(2);

      // step-1 has history
      expect(adjustments[0]!.stepId).toBe('step-1');
      expect(adjustments[0]!.confidence).toBeGreaterThan(0);

      // step-2 has no history
      expect(adjustments[1]!.stepId).toBe('step-2');
      expect(adjustments[1]!.adjustedTimeout).toBe(60_000);
    });

    it('should preserve step properties except timeout', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createStep({
        id: 'my-step',
        description: 'My test step',
        command: 'echo hello',
        canRollback: true,
        onError: 'retry',
        timeout: 60_000,
      });
      adjuster.recordExecution(createRecord({ stepId: 'my-step', duration: 10_000 }));

      const { steps: adjusted } = adjuster.adjustAllTimeouts([step]);

      expect(adjusted[0]!.id).toBe('my-step');
      expect(adjusted[0]!.description).toBe('My test step');
      expect(adjusted[0]!.command).toBe('echo hello');
      expect(adjusted[0]!.canRollback).toBe(true);
      expect(adjusted[0]!.onError).toBe('retry');
      expect(adjusted[0]!.timeout).not.toBe(60_000); // should be adjusted
    });

    it('should apply environment factor to all steps', () => {
      const adjuster = new TimeoutAdjuster();
      const env = createEnv({ network: { canAccessNpm: false, canAccessGithub: false } });
      const steps = [
        createStep({ id: 'quick', timeout: QUICK_TIMEOUT }),
        createStep({ id: 'install', timeout: INSTALL_TIMEOUT }),
      ];

      const { steps: adjusted } = adjuster.adjustAllTimeouts(steps, env);

      // Quick step: no network factor
      expect(adjusted[0]!.timeout).toBe(QUICK_TIMEOUT);
      // Install step: 2x factor
      expect(adjusted[1]!.timeout).toBe(INSTALL_TIMEOUT * 2);
    });
  });

  // ==========================================================================
  // Integration with actual step definitions
  // ==========================================================================

  describe('integration with actual steps', () => {
    it('should handle ALL_STEPS without errors', () => {
      const adjuster = new TimeoutAdjuster();
      const { steps, adjustments } = adjuster.adjustAllTimeouts(ALL_STEPS);

      expect(steps).toHaveLength(ALL_STEPS.length);
      expect(adjustments).toHaveLength(ALL_STEPS.length);
    });

    it('should reduce timeouts for consistently fast steps', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createCheckNodeStep(); // 30s default

      // Consistently completes in ~200ms
      for (let i = 0; i < 5; i++) {
        adjuster.recordExecution(createRecord({ stepId: 'check-node', duration: 200 }));
      }

      const result = adjuster.adjustTimeout(step);
      // Should be much less than 30s but at least minTimeout (10s)
      expect(result.adjustedTimeout).toBeLessThan(QUICK_TIMEOUT);
      expect(result.adjustedTimeout).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minTimeout);
    });

    it('should increase timeouts for slow install steps', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createInstallOpenClawStep(); // 120s default

      // Takes around 90-110s each time
      adjuster.recordExecution(createRecord({ stepId: 'install-openclaw', duration: 90_000 }));
      adjuster.recordExecution(createRecord({ stepId: 'install-openclaw', duration: 100_000 }));
      adjuster.recordExecution(createRecord({ stepId: 'install-openclaw', duration: 110_000 }));

      const result = adjuster.adjustTimeout(step);
      // Should be >= mean * 1.5 ≈ 150k
      expect(result.adjustedTimeout).toBeGreaterThan(140_000);
    });

    it('should dramatically increase timeout after a timeout event', () => {
      const adjuster = new TimeoutAdjuster();
      const step = createInstallPnpmStep(); // 60s default

      adjuster.recordExecution(
        createRecord({ stepId: 'install-pnpm', duration: 60_000, timedOut: true, success: false }),
      );

      const result = adjuster.adjustTimeout(step);
      // 60000 * 2.0 = 120000
      expect(result.adjustedTimeout).toBe(120_000);
    });
  });
});

// ============================================================================
// adjustStepTimeouts (convenience function)
// ============================================================================

describe('adjustStepTimeouts', () => {
  it('should work end-to-end with history and environment', () => {
    const steps = [
      createStep({ id: 'fast-step', timeout: 30_000 }),
      createStep({ id: 'slow-step', timeout: 120_000 }),
    ];
    const history: ExecutionRecord[] = [
      createRecord({ stepId: 'fast-step', duration: 1_000 }),
      createRecord({ stepId: 'fast-step', duration: 1_200 }),
      createRecord({ stepId: 'slow-step', duration: 80_000 }),
    ];

    const { steps: adjusted, adjustments } = adjustStepTimeouts(steps, history);

    expect(adjusted).toHaveLength(2);
    expect(adjustments).toHaveLength(2);

    // fast-step should have reduced timeout
    expect(adjusted[0]!.timeout).toBeLessThan(30_000);
    // slow-step should have adjusted based on 80s history
    expect(adjustments[1]!.adjustedTimeout).toBeGreaterThan(80_000);
  });

  it('should accept custom config', () => {
    const steps = [createStep({ timeout: 30_000 })];
    const history: ExecutionRecord[] = [
      createRecord({ duration: 500 }),
    ];

    const { steps: adjusted } = adjustStepTimeouts(steps, history, undefined, {
      minTimeout: 5_000,
    });

    expect(adjusted[0]!.timeout).toBeGreaterThanOrEqual(5_000);
  });

  it('should pass environment to adjuster', () => {
    const steps = [createStep({ id: 'install', timeout: INSTALL_TIMEOUT })];
    const history: ExecutionRecord[] = [];
    const env = createEnv({ network: { canAccessNpm: false, canAccessGithub: false } });

    const { steps: adjusted } = adjustStepTimeouts(steps, history, env);

    expect(adjusted[0]!.timeout).toBe(INSTALL_TIMEOUT * 2);
  });

  it('should return empty arrays for empty input', () => {
    const { steps, adjustments } = adjustStepTimeouts([], []);
    expect(steps).toHaveLength(0);
    expect(adjustments).toHaveLength(0);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('edge cases', () => {
  it('should handle getHistory for unknown stepId', () => {
    const adjuster = new TimeoutAdjuster();
    expect(adjuster.getHistory('nonexistent')).toHaveLength(0);
  });

  it('should handle step with 0 timeout', () => {
    const adjuster = new TimeoutAdjuster();
    const step = createStep({ timeout: 0 });
    const result = adjuster.adjustTimeout(step);
    // Should clamp to minTimeout
    expect(result.adjustedTimeout).toBeGreaterThanOrEqual(DEFAULT_CONFIG.minTimeout);
  });

  it('should handle very large durations', () => {
    const adjuster = new TimeoutAdjuster({ maxTimeout: 600_000 });
    const step = createStep({ timeout: 120_000 });
    adjuster.recordExecution(
      createRecord({ duration: 500_000, timedOut: true, success: false }),
    );

    const result = adjuster.adjustTimeout(step);
    expect(result.adjustedTimeout).toBeLessThanOrEqual(600_000);
  });

  it('should handle mixed success and failure records', () => {
    const adjuster = new TimeoutAdjuster();
    const step = createStep({ timeout: 60_000 });

    adjuster.recordExecution(createRecord({ duration: 10_000, success: true }));
    adjuster.recordExecution(createRecord({ duration: 20_000, success: false }));
    adjuster.recordExecution(createRecord({ duration: 12_000, success: true }));
    adjuster.recordExecution(createRecord({ duration: 30_000, success: false }));

    const result = adjuster.adjustTimeout(step);
    // Should only use successful durations (10k, 12k)
    expect(result.adjustedTimeout).toBeLessThan(30_000);
  });

  it('should handle clearHistory then adjustTimeout', () => {
    const adjuster = new TimeoutAdjuster();
    const step = createStep({ timeout: 60_000 });

    adjuster.recordExecution(createRecord({ duration: 5_000 }));
    adjuster.clearHistory();

    const result = adjuster.adjustTimeout(step);
    expect(result.adjustedTimeout).toBe(60_000); // back to default
    expect(result.confidence).toBe(0);
  });

  it('should handle adjustTimeout called multiple times on same step', () => {
    const adjuster = new TimeoutAdjuster();
    const step = createStep({ timeout: 60_000 });

    adjuster.recordExecution(createRecord({ duration: 10_000 }));
    const result1 = adjuster.adjustTimeout(step);

    adjuster.recordExecution(createRecord({ duration: 12_000 }));
    const result2 = adjuster.adjustTimeout(step);

    // Second call should have more data → potentially different timeout
    expect(result2.confidence).toBeGreaterThan(result1.confidence);
  });
});
