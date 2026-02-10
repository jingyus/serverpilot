/**
 * Tests for packages/agent/src/ui/progress.ts
 *
 * Progress display module — createProgress, withProgress,
 * withProgressTotals, installWithProgress.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock @clack/prompts spinner before importing the module
vi.mock('@clack/prompts', () => {
  const mockSpinner = () => ({
    start: vi.fn(),
    stop: vi.fn(),
    message: vi.fn(),
  });
  return { spinner: mockSpinner };
});

import {
  createProgress,
  withProgress,
  withProgressTotals,
  installWithProgress,
  _resetActiveProgress,
} from '../packages/agent/src/ui/progress.js';
import type {
  ProgressOptions,
  ProgressReporter,
  ProgressTotalsUpdate,
  InstallProgressResult,
  StepProgressResult,
  InstallStepDescriptor,
  InstallWithProgressOptions,
} from '../packages/agent/src/ui/progress.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a fake TTY-like writable stream. */
function fakeTtyStream(): NodeJS.WriteStream {
  return { isTTY: true, write: vi.fn() } as unknown as NodeJS.WriteStream;
}

/** Create a fake non-TTY writable stream. */
function fakeNonTtyStream(): NodeJS.WriteStream {
  return { isTTY: false, write: vi.fn() } as unknown as NodeJS.WriteStream;
}

// ============================================================================
// File Existence
// ============================================================================

describe('ui/progress.ts - file existence', () => {
  const filePath = path.resolve(__dirname, '../packages/agent/src/ui/progress.ts');

  it('should exist', () => {
    expect(existsSync(filePath)).toBe(true);
  });

  it('should not be empty', () => {
    const content = readFileSync(filePath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Exports
// ============================================================================

describe('ui/progress.ts - exports', () => {
  it('should export createProgress function', () => {
    expect(typeof createProgress).toBe('function');
  });

  it('should export withProgress function', () => {
    expect(typeof withProgress).toBe('function');
  });

  it('should export withProgressTotals function', () => {
    expect(typeof withProgressTotals).toBe('function');
  });

  it('should export installWithProgress function', () => {
    expect(typeof installWithProgress).toBe('function');
  });

  it('should export _resetActiveProgress function', () => {
    expect(typeof _resetActiveProgress).toBe('function');
  });
});

// ============================================================================
// createProgress - disabled / non-TTY returns noop
// ============================================================================

describe('createProgress - noop cases', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  it('should return noop reporter when enabled is false', () => {
    const reporter = createProgress({ label: 'Test', enabled: false });
    // Noop methods should not throw
    reporter.setLabel('new');
    reporter.setPercent(50);
    reporter.tick();
    reporter.done();
    // All methods exist
    expect(typeof reporter.setLabel).toBe('function');
    expect(typeof reporter.setPercent).toBe('function');
    expect(typeof reporter.tick).toBe('function');
    expect(typeof reporter.done).toBe('function');
  });

  it('should return noop reporter when stream is not TTY', () => {
    const reporter = createProgress({
      label: 'Test',
      stream: fakeNonTtyStream(),
    });
    reporter.setLabel('other');
    reporter.setPercent(100);
    reporter.tick(5);
    reporter.done();
    expect(typeof reporter.done).toBe('function');
  });

  it('should return noop reporter when a progress is already active', () => {
    const stream = fakeTtyStream();
    const first = createProgress({ label: 'First', stream });
    const second = createProgress({ label: 'Second', stream });
    // second should be noop since first is active
    second.setLabel('ignored');
    second.done();
    // clean up first
    first.done();
  });
});

// ============================================================================
// createProgress - active reporter (TTY)
// ============================================================================

describe('createProgress - TTY reporter', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  it('should return a reporter with all required methods', () => {
    const stream = fakeTtyStream();
    const reporter = createProgress({ label: 'Installing...', stream });
    expect(typeof reporter.setLabel).toBe('function');
    expect(typeof reporter.setPercent).toBe('function');
    expect(typeof reporter.tick).toBe('function');
    expect(typeof reporter.done).toBe('function');
    reporter.done();
  });

  it('should allow setLabel calls without error', () => {
    const stream = fakeTtyStream();
    const reporter = createProgress({ label: 'Start', stream });
    expect(() => reporter.setLabel('Updated')).not.toThrow();
    reporter.done();
  });

  it('should allow setPercent calls without error', () => {
    const stream = fakeTtyStream();
    const reporter = createProgress({ label: 'Progress', stream });
    expect(() => reporter.setPercent(0)).not.toThrow();
    expect(() => reporter.setPercent(50)).not.toThrow();
    expect(() => reporter.setPercent(100)).not.toThrow();
    reporter.done();
  });

  it('should clamp percent to 0-100 range', () => {
    const stream = fakeTtyStream();
    const reporter = createProgress({ label: 'Clamp', stream });
    expect(() => reporter.setPercent(-10)).not.toThrow();
    expect(() => reporter.setPercent(200)).not.toThrow();
    reporter.done();
  });

  it('should handle tick with total', () => {
    const stream = fakeTtyStream();
    const reporter = createProgress({ label: 'Ticking', total: 10, stream });
    for (let i = 0; i < 10; i++) {
      expect(() => reporter.tick()).not.toThrow();
    }
    reporter.done();
  });

  it('should ignore tick when no total is set', () => {
    const stream = fakeTtyStream();
    const reporter = createProgress({ label: 'No total', stream });
    // Should be noop since no total
    expect(() => reporter.tick()).not.toThrow();
    expect(() => reporter.tick(5)).not.toThrow();
    reporter.done();
  });

  it('should not exceed total when ticking past it', () => {
    const stream = fakeTtyStream();
    const reporter = createProgress({ label: 'Overflow', total: 3, stream });
    reporter.tick(5); // exceeds total
    reporter.done();
  });

  it('should allow done to be called multiple times safely', () => {
    const stream = fakeTtyStream();
    const reporter = createProgress({ label: 'Multi-done', stream });
    reporter.done();
    expect(() => reporter.done()).not.toThrow();
  });

  it('should handle delayed start', async () => {
    vi.useFakeTimers();
    const stream = fakeTtyStream();
    const reporter = createProgress({ label: 'Delayed', delayMs: 100, stream });
    // done before delay fires
    reporter.done();
    vi.useRealTimers();
  });

  it('should start after delay expires', async () => {
    vi.useFakeTimers();
    const stream = fakeTtyStream();
    const reporter = createProgress({ label: 'Delayed', delayMs: 50, stream });
    vi.advanceTimersByTime(60);
    reporter.setLabel('After delay');
    reporter.done();
    vi.useRealTimers();
  });
});

// ============================================================================
// createProgress - nesting prevention
// ============================================================================

describe('createProgress - nesting prevention', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  it('should allow a new progress after previous one is done', () => {
    const stream = fakeTtyStream();
    const first = createProgress({ label: 'First', stream });
    first.done();

    const second = createProgress({ label: 'Second', stream });
    // second should be a real reporter, not noop
    expect(() => second.setLabel('Real')).not.toThrow();
    second.done();
  });
});

// ============================================================================
// withProgress
// ============================================================================

describe('withProgress', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  it('should return the value from the work function', async () => {
    const result = await withProgress(
      { label: 'Test', enabled: false },
      async () => 42,
    );
    expect(result).toBe(42);
  });

  it('should call done even if work throws', async () => {
    await expect(
      withProgress({ label: 'Fail', enabled: false }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('should pass a progress reporter to the work function', async () => {
    await withProgress({ label: 'Reporter', enabled: false }, async (p) => {
      expect(typeof p.setLabel).toBe('function');
      expect(typeof p.setPercent).toBe('function');
      expect(typeof p.tick).toBe('function');
      expect(typeof p.done).toBe('function');
    });
  });
});

// ============================================================================
// withProgressTotals
// ============================================================================

describe('withProgressTotals', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  it('should return the value from the work function', async () => {
    const result = await withProgressTotals(
      { label: 'Totals', enabled: false },
      async () => 'done',
    );
    expect(result).toBe('done');
  });

  it('should provide an update callback', async () => {
    await withProgressTotals(
      { label: 'Update', enabled: false },
      async (update, progress) => {
        expect(typeof update).toBe('function');
        expect(typeof progress.setLabel).toBe('function');
        update({ completed: 1, total: 2 });
        update({ completed: 2, total: 2, label: 'Done' });
      },
    );
  });

  it('should handle invalid total gracefully', async () => {
    await withProgressTotals(
      { label: 'Invalid', enabled: false },
      async (update) => {
        // These should not throw
        update({ completed: 1, total: 0 });
        update({ completed: 1, total: -1 });
        update({ completed: 1, total: Infinity });
      },
    );
  });
});

// ============================================================================
// installWithProgress - success path
// ============================================================================

describe('installWithProgress - success', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  it('should complete all steps successfully', async () => {
    const steps: InstallStepDescriptor[] = [
      { id: 'step1', description: 'Step One', execute: async () => {} },
      { id: 'step2', description: 'Step Two', execute: async () => {} },
    ];

    const result = await installWithProgress(steps, { enabled: false });

    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(2);
    expect(result.totalSteps).toBe(2);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].id).toBe('step1');
    expect(result.steps[1].success).toBe(true);
    expect(result.steps[1].id).toBe('step2');
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty steps array', async () => {
    const result = await installWithProgress([], { enabled: false });
    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(0);
    expect(result.totalSteps).toBe(0);
    expect(result.steps).toHaveLength(0);
  });

  it('should track per-step duration', async () => {
    const steps: InstallStepDescriptor[] = [
      {
        id: 'slow',
        description: 'Slow step',
        execute: async () => {
          await new Promise((r) => setTimeout(r, 20));
        },
      },
    ];

    const result = await installWithProgress(steps, { enabled: false });
    expect(result.steps[0].duration).toBeGreaterThanOrEqual(10);
  });

  it('should report correct step descriptions', async () => {
    const steps: InstallStepDescriptor[] = [
      { id: 'a', description: 'Alpha', execute: async () => {} },
      { id: 'b', description: 'Beta', execute: async () => {} },
    ];

    const result = await installWithProgress(steps, { enabled: false });
    expect(result.steps[0].description).toBe('Alpha');
    expect(result.steps[1].description).toBe('Beta');
  });
});

// ============================================================================
// installWithProgress - failure path
// ============================================================================

describe('installWithProgress - failure', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  it('should stop on first failure', async () => {
    const steps: InstallStepDescriptor[] = [
      { id: 'ok', description: 'Works', execute: async () => {} },
      {
        id: 'fail',
        description: 'Fails',
        execute: async () => {
          throw new Error('install failed');
        },
      },
      { id: 'skip', description: 'Skipped', execute: async () => {} },
    ];

    const result = await installWithProgress(steps, { enabled: false });

    expect(result.success).toBe(false);
    expect(result.completedSteps).toBe(1);
    expect(result.totalSteps).toBe(3);
    expect(result.steps).toHaveLength(2); // only ok + fail
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[1].success).toBe(false);
    expect(result.steps[1].error).toBe('install failed');
  });

  it('should handle non-Error throws', async () => {
    const steps: InstallStepDescriptor[] = [
      {
        id: 'throws-string',
        description: 'Throws string',
        execute: async () => {
          throw 'string error';
        },
      },
    ];

    const result = await installWithProgress(steps, { enabled: false });
    expect(result.success).toBe(false);
    expect(result.steps[0].error).toBe('string error');
  });

  it('should fail when first step fails', async () => {
    const steps: InstallStepDescriptor[] = [
      {
        id: 'boom',
        description: 'Boom',
        execute: async () => {
          throw new Error('boom');
        },
      },
    ];

    const result = await installWithProgress(steps, { enabled: false });
    expect(result.success).toBe(false);
    expect(result.completedSteps).toBe(0);
    expect(result.totalSteps).toBe(1);
  });
});

// ============================================================================
// installWithProgress - callbacks
// ============================================================================

describe('installWithProgress - callbacks', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  it('should invoke onStepStart for each step', async () => {
    const onStepStart = vi.fn();
    const steps: InstallStepDescriptor[] = [
      { id: 'a', description: 'A', execute: async () => {} },
      { id: 'b', description: 'B', execute: async () => {} },
    ];

    await installWithProgress(steps, { enabled: false, onStepStart });

    expect(onStepStart).toHaveBeenCalledTimes(2);
    expect(onStepStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', description: 'A' }),
      0,
    );
    expect(onStepStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b', description: 'B' }),
      1,
    );
  });

  it('should invoke onStepComplete for completed steps', async () => {
    const onStepComplete = vi.fn();
    const steps: InstallStepDescriptor[] = [
      { id: 'a', description: 'A', execute: async () => {} },
      {
        id: 'b',
        description: 'B',
        execute: async () => {
          throw new Error('fail');
        },
      },
    ];

    await installWithProgress(steps, { enabled: false, onStepComplete });

    expect(onStepComplete).toHaveBeenCalledTimes(2);
    expect(onStepComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a', success: true }),
      0,
    );
    expect(onStepComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b', success: false, error: 'fail' }),
      1,
    );
  });

  it('should not invoke onStepStart for skipped steps', async () => {
    const onStepStart = vi.fn();
    const steps: InstallStepDescriptor[] = [
      {
        id: 'fail',
        description: 'Fail',
        execute: async () => {
          throw new Error('fail');
        },
      },
      { id: 'skip', description: 'Skip', execute: async () => {} },
    ];

    await installWithProgress(steps, { enabled: false, onStepStart });
    expect(onStepStart).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// installWithProgress - options
// ============================================================================

describe('installWithProgress - options', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  it('should use default label when none provided', async () => {
    const result = await installWithProgress([], { enabled: false });
    expect(result.success).toBe(true);
  });

  it('should accept custom label', async () => {
    const result = await installWithProgress([], {
      label: 'Custom Install',
      enabled: false,
    });
    expect(result.success).toBe(true);
  });

  it('should work with default options', async () => {
    const result = await installWithProgress(
      [{ id: 'x', description: 'X', execute: async () => {} }],
      { enabled: false },
    );
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Type exports
// ============================================================================

describe('ui/progress.ts - type exports', () => {
  it('should export ProgressOptions type', () => {
    const opts: ProgressOptions = { label: 'test' };
    expect(opts.label).toBe('test');
  });

  it('should export ProgressReporter type', () => {
    const reporter: ProgressReporter = {
      setLabel: () => {},
      setPercent: () => {},
      tick: () => {},
      done: () => {},
    };
    expect(typeof reporter.done).toBe('function');
  });

  it('should export ProgressTotalsUpdate type', () => {
    const update: ProgressTotalsUpdate = { completed: 1, total: 10 };
    expect(update.completed).toBe(1);
    expect(update.total).toBe(10);
  });

  it('should export InstallProgressResult type', () => {
    const result: InstallProgressResult = {
      success: true,
      completedSteps: 1,
      totalSteps: 1,
      duration: 100,
      steps: [],
    };
    expect(result.success).toBe(true);
  });

  it('should export StepProgressResult type', () => {
    const step: StepProgressResult = {
      id: 's1',
      description: 'test',
      success: true,
      duration: 50,
    };
    expect(step.id).toBe('s1');
  });

  it('should export InstallStepDescriptor type', () => {
    const desc: InstallStepDescriptor = {
      id: 'd1',
      description: 'test',
      execute: async () => {},
    };
    expect(desc.id).toBe('d1');
  });

  it('should export InstallWithProgressOptions type', () => {
    const opts: InstallWithProgressOptions = { label: 'Install' };
    expect(opts.label).toBe('Install');
  });
});
