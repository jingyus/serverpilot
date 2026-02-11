// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for OpenClaw step-merger module.
 */

import { describe, it, expect } from 'vitest';
import type { InstallStep } from '@aiinstaller/shared';
import {
  isMergeable,
  canMerge,
  mergeSteps,
  identifyMergeGroups,
  evaluateMerges,
  optimizeSteps,
} from './step-merger.js';
import {
  ALL_STEPS,
  createCheckNodeStep,
  createInstallPnpmStep,
  createInstallOpenClawStep,
  createConfigureOpenClawStep,
  createVerifyInstallationStep,
  QUICK_TIMEOUT,
  INSTALL_TIMEOUT,
  HEAVY_INSTALL_TIMEOUT,
} from './steps.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a simple mergeable step with given properties. */
function createMergeableStep(overrides: Partial<InstallStep> = {}): InstallStep {
  return {
    id: 'step-a',
    description: 'Step A',
    command: 'echo a',
    timeout: 30_000,
    canRollback: true,
    onError: 'retry',
    ...overrides,
  };
}

// ============================================================================
// isMergeable
// ============================================================================

describe('isMergeable', () => {
  it('should return true for a basic step without expectedOutput or abort strategy', () => {
    const step = createMergeableStep();
    expect(isMergeable(step)).toBe(true);
  });

  it('should return false for steps with expectedOutput', () => {
    const step = createMergeableStep({ expectedOutput: 'v22' });
    expect(isMergeable(step)).toBe(false);
  });

  it('should return false for interactive steps (configure-openclaw)', () => {
    const step = createConfigureOpenClawStep();
    expect(isMergeable(step)).toBe(false);
  });

  it('should return false for steps with abort error strategy', () => {
    const step = createMergeableStep({ onError: 'abort' });
    expect(isMergeable(step)).toBe(false);
  });

  it('should return true for steps with retry error strategy', () => {
    const step = createMergeableStep({ onError: 'retry' });
    expect(isMergeable(step)).toBe(true);
  });

  it('should return true for steps with skip error strategy', () => {
    const step = createMergeableStep({ onError: 'skip' });
    expect(isMergeable(step)).toBe(true);
  });

  it('should return true for steps with fallback error strategy', () => {
    const step = createMergeableStep({ onError: 'fallback' });
    expect(isMergeable(step)).toBe(true);
  });

  // Real OpenClaw steps
  it('should return false for check-node step (has expectedOutput)', () => {
    expect(isMergeable(createCheckNodeStep())).toBe(false);
  });

  it('should return true for install-pnpm step', () => {
    expect(isMergeable(createInstallPnpmStep())).toBe(true);
  });

  it('should return true for install-openclaw step', () => {
    expect(isMergeable(createInstallOpenClawStep())).toBe(true);
  });

  it('should return false for configure-openclaw step (interactive)', () => {
    expect(isMergeable(createConfigureOpenClawStep())).toBe(false);
  });

  it('should return false for verify-installation step (has expectedOutput)', () => {
    expect(isMergeable(createVerifyInstallationStep())).toBe(false);
  });
});

// ============================================================================
// canMerge
// ============================================================================

describe('canMerge', () => {
  it('should return true for two mergeable steps with same error strategy', () => {
    const a = createMergeableStep({ id: 'a', onError: 'retry' });
    const b = createMergeableStep({ id: 'b', onError: 'retry' });
    expect(canMerge(a, b)).toBe(true);
  });

  it('should return false if first step is not mergeable', () => {
    const a = createMergeableStep({ id: 'a', expectedOutput: 'v22' });
    const b = createMergeableStep({ id: 'b' });
    expect(canMerge(a, b)).toBe(false);
  });

  it('should return false if second step is not mergeable', () => {
    const a = createMergeableStep({ id: 'a' });
    const b = createMergeableStep({ id: 'b', onError: 'abort' });
    expect(canMerge(a, b)).toBe(false);
  });

  it('should return false if error strategies differ', () => {
    const a = createMergeableStep({ id: 'a', onError: 'retry' });
    const b = createMergeableStep({ id: 'b', onError: 'skip' });
    expect(canMerge(a, b)).toBe(false);
  });

  it('should return false for install-pnpm and configure-openclaw', () => {
    expect(canMerge(createInstallPnpmStep(), createConfigureOpenClawStep())).toBe(false);
  });

  it('should return true for install-pnpm and install-openclaw', () => {
    expect(canMerge(createInstallPnpmStep(), createInstallOpenClawStep())).toBe(true);
  });
});

// ============================================================================
// mergeSteps
// ============================================================================

describe('mergeSteps', () => {
  it('should throw for empty array', () => {
    expect(() => mergeSteps([])).toThrow('Cannot merge an empty list of steps');
  });

  it('should return a copy for single step', () => {
    const step = createMergeableStep();
    const result = mergeSteps([step]);
    expect(result).toEqual(step);
    // Should be a new object (copy)
    expect(result).not.toBe(step);
  });

  it('should merge two steps with && chaining', () => {
    const a = createMergeableStep({ id: 'a', command: 'echo a', timeout: 30_000, canRollback: true });
    const b = createMergeableStep({ id: 'b', command: 'echo b', timeout: 60_000, canRollback: true });
    const result = mergeSteps([a, b]);

    expect(result.id).toBe('a+b');
    expect(result.command).toBe('echo a && echo b');
    expect(result.timeout).toBe(90_000);
    expect(result.canRollback).toBe(true);
    expect(result.onError).toBe('retry');
  });

  it('should join descriptions with arrow separator', () => {
    const a = createMergeableStep({ id: 'a', description: 'Install A' });
    const b = createMergeableStep({ id: 'b', description: 'Install B' });
    const result = mergeSteps([a, b]);
    expect(result.description).toBe('Install A → Install B');
  });

  it('should set canRollback to false if any step cannot rollback', () => {
    const a = createMergeableStep({ id: 'a', canRollback: true });
    const b = createMergeableStep({ id: 'b', canRollback: false });
    const result = mergeSteps([a, b]);
    expect(result.canRollback).toBe(false);
  });

  it('should sum timeouts from all steps', () => {
    const a = createMergeableStep({ id: 'a', timeout: 10_000 });
    const b = createMergeableStep({ id: 'b', timeout: 20_000 });
    const c = createMergeableStep({ id: 'c', timeout: 30_000 });
    const result = mergeSteps([a, b, c]);
    expect(result.timeout).toBe(60_000);
  });

  it('should use onError from the first step', () => {
    const a = createMergeableStep({ id: 'a', onError: 'skip' });
    const b = createMergeableStep({ id: 'b', onError: 'skip' });
    const result = mergeSteps([a, b]);
    expect(result.onError).toBe('skip');
  });

  it('should merge three steps correctly', () => {
    const steps = [
      createMergeableStep({ id: 'x', command: 'cmd1', timeout: 10_000 }),
      createMergeableStep({ id: 'y', command: 'cmd2', timeout: 20_000 }),
      createMergeableStep({ id: 'z', command: 'cmd3', timeout: 30_000 }),
    ];
    const result = mergeSteps(steps);
    expect(result.id).toBe('x+y+z');
    expect(result.command).toBe('cmd1 && cmd2 && cmd3');
    expect(result.timeout).toBe(60_000);
  });

  it('should not include expectedOutput on merged step', () => {
    const a = createMergeableStep({ id: 'a' });
    const b = createMergeableStep({ id: 'b' });
    const result = mergeSteps([a, b]);
    expect(result.expectedOutput).toBeUndefined();
  });

  it('should merge install-pnpm and install-openclaw steps', () => {
    const pnpm = createInstallPnpmStep();
    const openclaw = createInstallOpenClawStep();
    const result = mergeSteps([pnpm, openclaw]);

    expect(result.id).toBe('install-pnpm+install-openclaw');
    expect(result.command).toBe('npm install -g pnpm && pnpm install -g openclaw');
    expect(result.timeout).toBe(INSTALL_TIMEOUT + HEAVY_INSTALL_TIMEOUT);
    expect(result.canRollback).toBe(true);
    expect(result.onError).toBe('retry');
  });
});

// ============================================================================
// identifyMergeGroups
// ============================================================================

describe('identifyMergeGroups', () => {
  it('should return empty array for empty input', () => {
    expect(identifyMergeGroups([])).toEqual([]);
  });

  it('should return single group for single step', () => {
    const step = createMergeableStep();
    const groups = identifyMergeGroups([step]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual([step]);
  });

  it('should group two mergeable consecutive steps', () => {
    const a = createMergeableStep({ id: 'a' });
    const b = createMergeableStep({ id: 'b' });
    const groups = identifyMergeGroups([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual([a, b]);
  });

  it('should separate non-mergeable steps', () => {
    const a = createMergeableStep({ id: 'a', onError: 'retry' });
    const b = createMergeableStep({ id: 'b', onError: 'abort' }); // not mergeable
    const c = createMergeableStep({ id: 'c', onError: 'retry' });
    const groups = identifyMergeGroups([a, b, c]);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual([a]);
    expect(groups[1]).toEqual([b]);
    expect(groups[2]).toEqual([c]);
  });

  it('should handle mixed groups correctly', () => {
    const a = createMergeableStep({ id: 'a', onError: 'retry' });
    const b = createMergeableStep({ id: 'b', onError: 'retry' });
    const c = createMergeableStep({ id: 'c', expectedOutput: 'ok' }); // not mergeable
    const d = createMergeableStep({ id: 'd', onError: 'skip' });
    const e = createMergeableStep({ id: 'e', onError: 'skip' });
    const groups = identifyMergeGroups([a, b, c, d, e]);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toEqual([a, b]);
    expect(groups[1]).toEqual([c]);
    expect(groups[2]).toEqual([d, e]);
  });

  it('should group ALL_STEPS correctly', () => {
    // ALL_STEPS: check-node (expectedOutput), install-pnpm (retry),
    // install-openclaw (retry), configure-openclaw (interactive),
    // verify-installation (expectedOutput + abort)
    const groups = identifyMergeGroups(ALL_STEPS);

    // check-node: not mergeable (has expectedOutput) -> group of 1
    // install-pnpm + install-openclaw: both retry, no constraints -> group of 2
    // configure-openclaw: not mergeable (interactive) -> group of 1
    // verify-installation: not mergeable (has expectedOutput, abort) -> group of 1
    expect(groups).toHaveLength(4);
    expect(groups[0].map((s) => s.id)).toEqual(['check-node']);
    expect(groups[1].map((s) => s.id)).toEqual(['install-pnpm', 'install-openclaw']);
    expect(groups[2].map((s) => s.id)).toEqual(['configure-openclaw']);
    expect(groups[3].map((s) => s.id)).toEqual(['verify-installation']);
  });

  it('should not merge steps with different error strategies', () => {
    const a = createMergeableStep({ id: 'a', onError: 'retry' });
    const b = createMergeableStep({ id: 'b', onError: 'fallback' });
    const groups = identifyMergeGroups([a, b]);
    expect(groups).toHaveLength(2);
  });
});

// ============================================================================
// evaluateMerges
// ============================================================================

describe('evaluateMerges', () => {
  it('should handle empty step list', () => {
    const result = evaluateMerges([]);
    expect(result.optimizedSteps).toEqual([]);
    expect(result.decisions).toEqual([]);
    expect(result.unchangedSteps).toEqual([]);
    expect(result.summary).toContain('No steps were merged');
  });

  it('should return single step unchanged', () => {
    const step = createMergeableStep();
    const result = evaluateMerges([step]);
    expect(result.optimizedSteps).toHaveLength(1);
    expect(result.optimizedSteps[0]).toBe(step);
    expect(result.decisions).toHaveLength(0);
    expect(result.unchangedSteps).toHaveLength(1);
  });

  it('should merge two eligible steps', () => {
    const a = createMergeableStep({ id: 'a', command: 'cmd-a', timeout: 10_000 });
    const b = createMergeableStep({ id: 'b', command: 'cmd-b', timeout: 20_000 });
    const result = evaluateMerges([a, b]);

    expect(result.optimizedSteps).toHaveLength(1);
    expect(result.optimizedSteps[0].id).toBe('a+b');
    expect(result.optimizedSteps[0].command).toBe('cmd-a && cmd-b');
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].mergedStepIds).toEqual(['a', 'b']);
    expect(result.unchangedSteps).toHaveLength(0);
    expect(result.summary).toContain('Merged');
  });

  it('should not merge non-eligible steps', () => {
    const a = createMergeableStep({ id: 'a', expectedOutput: 'v22' });
    const b = createMergeableStep({ id: 'b', onError: 'abort' });
    const result = evaluateMerges([a, b]);

    expect(result.optimizedSteps).toHaveLength(2);
    expect(result.decisions).toHaveLength(0);
    expect(result.unchangedSteps).toHaveLength(2);
    expect(result.summary).toContain('No steps were merged');
  });

  it('should handle mixed mergeable and non-mergeable steps', () => {
    const steps: InstallStep[] = [
      createMergeableStep({ id: 'check', expectedOutput: 'ok', onError: 'abort' }),
      createMergeableStep({ id: 'install-a', onError: 'retry' }),
      createMergeableStep({ id: 'install-b', onError: 'retry' }),
      createMergeableStep({ id: 'verify', expectedOutput: 'done', onError: 'abort' }),
    ];
    const result = evaluateMerges(steps);

    expect(result.optimizedSteps).toHaveLength(3);
    expect(result.optimizedSteps[0].id).toBe('check');
    expect(result.optimizedSteps[1].id).toBe('install-a+install-b');
    expect(result.optimizedSteps[2].id).toBe('verify');
    expect(result.decisions).toHaveLength(1);
    expect(result.unchangedSteps).toHaveLength(2);
  });

  it('should produce correct summary for merges', () => {
    const a = createMergeableStep({ id: 'a' });
    const b = createMergeableStep({ id: 'b' });
    const c = createMergeableStep({ id: 'c' });
    const result = evaluateMerges([a, b, c]);
    // 3 steps -> 1 merged step
    expect(result.summary).toBe(
      'Merged 2 steps into 1 combined step(s), reducing 3 steps to 1',
    );
  });

  it('should evaluate ALL_STEPS and merge install-pnpm + install-openclaw', () => {
    const result = evaluateMerges(ALL_STEPS);

    // Original: 5 steps -> Optimized: 4 steps (pnpm + openclaw merged)
    expect(result.optimizedSteps).toHaveLength(4);
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].mergedStepIds).toEqual(['install-pnpm', 'install-openclaw']);

    // Verify the merged step
    const mergedStep = result.optimizedSteps[1];
    expect(mergedStep.id).toBe('install-pnpm+install-openclaw');
    expect(mergedStep.command).toBe('npm install -g pnpm && pnpm install -g openclaw');
    expect(mergedStep.timeout).toBe(INSTALL_TIMEOUT + HEAVY_INSTALL_TIMEOUT);

    // Other steps should be unchanged
    expect(result.optimizedSteps[0].id).toBe('check-node');
    expect(result.optimizedSteps[2].id).toBe('configure-openclaw');
    expect(result.optimizedSteps[3].id).toBe('verify-installation');
  });

  it('should include reason in merge decisions', () => {
    const a = createMergeableStep({ id: 'a', onError: 'retry' });
    const b = createMergeableStep({ id: 'b', onError: 'retry' });
    const result = evaluateMerges([a, b]);
    expect(result.decisions[0].reason).toContain('retry');
  });
});

// ============================================================================
// optimizeSteps
// ============================================================================

describe('optimizeSteps', () => {
  it('should return empty array for empty input', () => {
    expect(optimizeSteps([])).toEqual([]);
  });

  it('should return optimized steps', () => {
    const a = createMergeableStep({ id: 'a', command: 'echo a' });
    const b = createMergeableStep({ id: 'b', command: 'echo b' });
    const result = optimizeSteps([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe('echo a && echo b');
  });

  it('should not alter steps that cannot be merged', () => {
    const steps = [
      createMergeableStep({ id: 'x', expectedOutput: 'v22', onError: 'abort' }),
      createMergeableStep({ id: 'y', expectedOutput: 'ok', onError: 'abort' }),
    ];
    const result = optimizeSteps(steps);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('x');
    expect(result[1].id).toBe('y');
  });

  it('should work on ALL_STEPS', () => {
    const result = optimizeSteps(ALL_STEPS);
    // 5 -> 4 (install-pnpm + install-openclaw merged)
    expect(result).toHaveLength(4);
    expect(result[1].id).toBe('install-pnpm+install-openclaw');
  });
});

// ============================================================================
// Integration: step pipeline (skip → merge)
// ============================================================================

describe('integration: skip then merge pipeline', () => {
  it('should handle already-skipped steps list (pnpm present)', () => {
    // Simulate: pnpm is already installed, so install-pnpm was skipped
    // Remaining: check-node, install-openclaw, configure-openclaw, verify-installation
    const steps: InstallStep[] = [
      createCheckNodeStep(),
      createInstallOpenClawStep(),
      createConfigureOpenClawStep(),
      createVerifyInstallationStep(),
    ];
    const result = evaluateMerges(steps);

    // check-node has expectedOutput -> not mergeable
    // install-openclaw is retry -> mergeable but alone between two non-mergeables
    // configure-openclaw is interactive -> not mergeable
    // verify-installation has expectedOutput -> not mergeable
    // So no merges should happen
    expect(result.optimizedSteps).toHaveLength(4);
    expect(result.decisions).toHaveLength(0);
  });

  it('should handle all prerequisites met (only verify remains from skip)', () => {
    // Simulate: everything already installed, only verification remains
    const steps: InstallStep[] = [createVerifyInstallationStep()];
    const result = evaluateMerges(steps);
    expect(result.optimizedSteps).toHaveLength(1);
    expect(result.decisions).toHaveLength(0);
  });

  it('should handle fresh install (no skips, full merge potential)', () => {
    const result = evaluateMerges(ALL_STEPS);
    // install-pnpm + install-openclaw should merge
    expect(result.optimizedSteps).toHaveLength(4);
    expect(result.decisions).toHaveLength(1);
  });

  it('should handle custom steps with multiple merge groups', () => {
    const steps: InstallStep[] = [
      createMergeableStep({ id: 'prep-a', onError: 'skip' }),
      createMergeableStep({ id: 'prep-b', onError: 'skip' }),
      createMergeableStep({ id: 'check', expectedOutput: 'ok', onError: 'abort' }),
      createMergeableStep({ id: 'install-a', onError: 'retry' }),
      createMergeableStep({ id: 'install-b', onError: 'retry' }),
      createMergeableStep({ id: 'install-c', onError: 'retry' }),
      createMergeableStep({ id: 'verify', expectedOutput: 'done', onError: 'abort' }),
    ];
    const result = evaluateMerges(steps);

    // Group 1: prep-a + prep-b (skip) -> merged
    // Group 2: check -> individual
    // Group 3: install-a + install-b + install-c (retry) -> merged
    // Group 4: verify -> individual
    expect(result.optimizedSteps).toHaveLength(4);
    expect(result.decisions).toHaveLength(2);

    expect(result.optimizedSteps[0].id).toBe('prep-a+prep-b');
    expect(result.optimizedSteps[1].id).toBe('check');
    expect(result.optimizedSteps[2].id).toBe('install-a+install-b+install-c');
    expect(result.optimizedSteps[3].id).toBe('verify');
  });
});
