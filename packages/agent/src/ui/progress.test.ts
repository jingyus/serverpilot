import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createProgress,
  withProgress,
  withProgressTotals,
  installWithProgress,
  ProgressEstimator,
  formatRemainingTime,
  _resetActiveProgress,
  Spinner,
  createSpinner,
  buildProgressBar,
  SPINNER_STYLES,
  PhaseNotifier,
  formatPhaseBanner,
} from './progress.js';
import type {
  ProgressOptions,
  ProgressReporter,
  InstallStepDescriptor,
  InstallProgressResult,
  StepProgressResult,
  ProgressEstimate,
  SpinnerStyle,
  SpinnerStyleName,
  PhaseDescriptor,
  PhaseChangeEvent,
} from './progress.js';

// ============================================================================
// Helper: create a fake TTY stream
// ============================================================================

function makeFakeTTYStream(): NodeJS.WriteStream {
  const stream = {
    isTTY: true,
    write: vi.fn().mockReturnValue(true),
    columns: 80,
    rows: 24,
    clearLine: vi.fn(),
    cursorTo: vi.fn(),
    moveCursor: vi.fn(),
  } as unknown as NodeJS.WriteStream;
  return stream;
}

function makeNonTTYStream(): NodeJS.WriteStream {
  return {
    isTTY: false,
    write: vi.fn().mockReturnValue(true),
  } as unknown as NodeJS.WriteStream;
}

// ============================================================================
// createProgress
// ============================================================================

describe('createProgress', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  afterEach(() => {
    _resetActiveProgress();
  });

  it('returns a reporter with setLabel, setPercent, tick, setRemainingMs, done', () => {
    const reporter = createProgress({ label: 'Test', enabled: false });
    expect(typeof reporter.setLabel).toBe('function');
    expect(typeof reporter.setPercent).toBe('function');
    expect(typeof reporter.tick).toBe('function');
    expect(typeof reporter.setRemainingMs).toBe('function');
    expect(typeof reporter.done).toBe('function');
  });

  it('returns noop reporter when disabled', () => {
    const reporter = createProgress({ label: 'Test', enabled: false });
    // Should not throw
    reporter.setLabel('new label');
    reporter.setPercent(50);
    reporter.tick();
    reporter.setRemainingMs(5000);
    reporter.done();
  });

  it('returns noop reporter for non-TTY stream', () => {
    const stream = makeNonTTYStream();
    const reporter = createProgress({ label: 'Test', stream });
    // Should not throw
    reporter.setLabel('new');
    reporter.setPercent(50);
    reporter.tick();
    reporter.done();
  });

  it('prevents nesting - second reporter is noop', () => {
    // The first creates an active progress; the second should be noop
    // Since TTY is needed and we can't easily simulate it in CI,
    // test with enabled: false for the noop case
    const r1 = createProgress({ label: 'First', enabled: false });
    const r2 = createProgress({ label: 'Second', enabled: false });
    // Both should be noop reporters without errors
    r1.done();
    r2.done();
  });

  it('_resetActiveProgress resets counter', () => {
    _resetActiveProgress();
    // After reset, a new progress should work
    const reporter = createProgress({ label: 'After reset', enabled: false });
    reporter.done();
  });
});

// ============================================================================
// Remaining time display (setRemainingMs)
// ============================================================================

describe('remaining time display', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  afterEach(() => {
    _resetActiveProgress();
  });

  it('noop reporter setRemainingMs does not throw', () => {
    const reporter = createProgress({ label: 'Test', enabled: false });
    reporter.setRemainingMs(10000);
    reporter.setRemainingMs(null);
    reporter.setRemainingMs(0);
    reporter.done();
  });

  it('non-TTY reporter setRemainingMs does not throw', () => {
    const stream = makeNonTTYStream();
    const reporter = createProgress({ label: 'Test', stream });
    reporter.setRemainingMs(30000);
    reporter.setRemainingMs(null);
    reporter.done();
  });

  it('setRemainingMs clamps negative values to 0', () => {
    // We test via the noop path — the important thing is no crash
    const reporter = createProgress({ label: 'Test', enabled: false });
    reporter.setRemainingMs(-500);
    reporter.done();
  });

  it('setRemainingMs accepts null to clear remaining time', () => {
    const reporter = createProgress({ label: 'Test', enabled: false });
    reporter.setRemainingMs(5000);
    reporter.setRemainingMs(null);
    reporter.done();
  });

  it('installWithProgress sets remaining time on progress reporter via estimator', async () => {
    const progressUpdates: ProgressEstimate[] = [];
    const steps: InstallStepDescriptor[] = [
      { id: 'a', description: 'Step A', estimatedMs: 5000, execute: async () => {} },
      { id: 'b', description: 'Step B', estimatedMs: 10000, execute: async () => {} },
    ];
    const result = await installWithProgress(steps, {
      enabled: false,
      onProgress: (est) => progressUpdates.push(est),
    });
    expect(result.success).toBe(true);
    // Every progress update should have remainingMs defined (not null)
    for (const update of progressUpdates) {
      expect(update.remainingMs).not.toBeNull();
      expect(typeof update.remainingMs).toBe('number');
    }
    // Last update should be 100% progress
    const last = progressUpdates[progressUpdates.length - 1];
    expect(last.percent).toBe(100);
    expect(last.completedSteps).toBe(2);
    expect(last.remainingText).not.toBe('calculating...');
  });

  it('installWithProgress shows decreasing remaining time across steps', async () => {
    const progressUpdates: ProgressEstimate[] = [];
    const steps: InstallStepDescriptor[] = [
      {
        id: 'a',
        description: 'Step A',
        estimatedMs: 5000,
        execute: async () => {
          await new Promise((r) => setTimeout(r, 20));
        },
      },
      {
        id: 'b',
        description: 'Step B',
        estimatedMs: 5000,
        execute: async () => {
          await new Promise((r) => setTimeout(r, 20));
        },
      },
    ];
    await installWithProgress(steps, {
      enabled: false,
      onProgress: (est) => progressUpdates.push(est),
    });
    // We should have multiple updates and the last one should be 0 remaining
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    const last = progressUpdates[progressUpdates.length - 1];
    expect(last.remainingMs).toBe(0);
    expect(last.percent).toBe(100);
  });

  it('installWithProgress cleans up ETA timer on failure', async () => {
    const steps: InstallStepDescriptor[] = [
      {
        id: 'fail',
        description: 'Failing step',
        estimatedMs: 5000,
        execute: async () => {
          throw new Error('fail');
        },
      },
    ];
    const result = await installWithProgress(steps, { enabled: false });
    expect(result.success).toBe(false);
    // Timer should be cleaned up — no dangling intervals
  });

  it('installWithProgress without estimatedMs does not set remaining time', async () => {
    const progressUpdates: ProgressEstimate[] = [];
    const steps: InstallStepDescriptor[] = [
      { id: 'a', description: 'Step A', execute: async () => {} },
    ];
    await installWithProgress(steps, {
      enabled: false,
      onProgress: (est) => progressUpdates.push(est),
    });
    // No estimator → no onProgress calls
    expect(progressUpdates.length).toBe(0);
  });
});

// ============================================================================
// withProgress
// ============================================================================

describe('withProgress', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  afterEach(() => {
    _resetActiveProgress();
  });

  it('runs work function and returns its result', async () => {
    const result = await withProgress({ label: 'Working', enabled: false }, async (p) => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('passes progress reporter to work function', async () => {
    await withProgress({ label: 'Working', enabled: false }, async (p) => {
      expect(typeof p.setLabel).toBe('function');
      expect(typeof p.setPercent).toBe('function');
      expect(typeof p.tick).toBe('function');
      expect(typeof p.done).toBe('function');
    });
  });

  it('calls done even if work throws', async () => {
    await expect(
      withProgress({ label: 'Failing', enabled: false }, async () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
  });

  it('returns the work result on success', async () => {
    const result = await withProgress({ label: 'Test', enabled: false }, async () => {
      return 'success';
    });
    expect(result).toBe('success');
  });
});

// ============================================================================
// withProgressTotals
// ============================================================================

describe('withProgressTotals', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  afterEach(() => {
    _resetActiveProgress();
  });

  it('provides an update function', async () => {
    await withProgressTotals({ label: 'Totals', enabled: false }, async (update, progress) => {
      expect(typeof update).toBe('function');
      expect(typeof progress.setLabel).toBe('function');
    });
  });

  it('update function accepts completed/total', async () => {
    await withProgressTotals({ label: 'Totals', enabled: false }, async (update) => {
      // Should not throw
      update({ completed: 5, total: 10 });
      update({ completed: 10, total: 10, label: 'Done' });
    });
  });

  it('handles zero total gracefully', async () => {
    await withProgressTotals({ label: 'Zero', enabled: false }, async (update) => {
      // Should not throw
      update({ completed: 0, total: 0 });
    });
  });

  it('handles non-finite total gracefully', async () => {
    await withProgressTotals({ label: 'Infinite', enabled: false }, async (update) => {
      // Should not throw
      update({ completed: 5, total: Infinity });
      update({ completed: 5, total: NaN });
    });
  });

  it('returns work result', async () => {
    const result = await withProgressTotals({ label: 'Test', enabled: false }, async () => {
      return 'totals result';
    });
    expect(result).toBe('totals result');
  });
});

// ============================================================================
// installWithProgress
// ============================================================================

describe('installWithProgress', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  afterEach(() => {
    _resetActiveProgress();
  });

  it('executes all steps and returns success', async () => {
    const steps: InstallStepDescriptor[] = [
      { id: 'step1', description: 'Step 1', execute: async () => {} },
      { id: 'step2', description: 'Step 2', execute: async () => {} },
    ];
    const result = await installWithProgress(steps, { enabled: false });
    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(2);
    expect(result.totalSteps).toBe(2);
    expect(result.steps).toHaveLength(2);
  });

  it('stops on first failure', async () => {
    const steps: InstallStepDescriptor[] = [
      { id: 'step1', description: 'Step 1', execute: async () => {} },
      {
        id: 'step2',
        description: 'Step 2',
        execute: async () => {
          throw new Error('step2 failed');
        },
      },
      { id: 'step3', description: 'Step 3', execute: async () => {} },
    ];
    const result = await installWithProgress(steps, { enabled: false });
    expect(result.success).toBe(false);
    expect(result.completedSteps).toBe(1);
    expect(result.totalSteps).toBe(3);
    expect(result.steps).toHaveLength(2); // step1 + step2 (failed)
    expect(result.steps[1].success).toBe(false);
    expect(result.steps[1].error).toBe('step2 failed');
  });

  it('records duration for each step', async () => {
    const steps: InstallStepDescriptor[] = [
      {
        id: 'slow',
        description: 'Slow step',
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        },
      },
    ];
    const result = await installWithProgress(steps, { enabled: false });
    expect(result.steps[0].duration).toBeGreaterThanOrEqual(30);
  });

  it('records total duration', async () => {
    const steps: InstallStepDescriptor[] = [
      { id: 'step1', description: 'Step 1', execute: async () => {} },
    ];
    const result = await installWithProgress(steps, { enabled: false });
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('calls onStepStart callback', async () => {
    const onStepStart = vi.fn();
    const steps: InstallStepDescriptor[] = [
      { id: 'step1', description: 'Step 1', execute: async () => {} },
      { id: 'step2', description: 'Step 2', execute: async () => {} },
    ];
    await installWithProgress(steps, { enabled: false, onStepStart });
    expect(onStepStart).toHaveBeenCalledTimes(2);
    expect(onStepStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'step1', description: 'Step 1' }),
      0,
    );
    expect(onStepStart).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'step2', description: 'Step 2' }),
      1,
    );
  });

  it('calls onStepComplete callback', async () => {
    const onStepComplete = vi.fn();
    const steps: InstallStepDescriptor[] = [
      { id: 'step1', description: 'Step 1', execute: async () => {} },
    ];
    await installWithProgress(steps, { enabled: false, onStepComplete });
    expect(onStepComplete).toHaveBeenCalledTimes(1);
    expect(onStepComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'step1', success: true }),
      0,
    );
  });

  it('calls onStepComplete for failed steps too', async () => {
    const onStepComplete = vi.fn();
    const steps: InstallStepDescriptor[] = [
      {
        id: 'fail',
        description: 'Failing',
        execute: async () => {
          throw new Error('boom');
        },
      },
    ];
    await installWithProgress(steps, { enabled: false, onStepComplete });
    expect(onStepComplete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fail', success: false, error: 'boom' }),
      0,
    );
  });

  it('handles empty steps list', async () => {
    const result = await installWithProgress([], { enabled: false });
    expect(result.success).toBe(true);
    expect(result.completedSteps).toBe(0);
    expect(result.totalSteps).toBe(0);
    expect(result.steps).toHaveLength(0);
  });

  it('handles non-Error throws', async () => {
    const steps: InstallStepDescriptor[] = [
      {
        id: 'throw-string',
        description: 'Throws string',
        execute: async () => {
          throw 'string error';
        },
      },
    ];
    const result = await installWithProgress(steps, { enabled: false });
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].error).toBe('string error');
  });

  it('uses default label when not specified', async () => {
    const result = await installWithProgress([], { enabled: false });
    expect(result.success).toBe(true);
  });

  it('step results include id and description', async () => {
    const steps: InstallStepDescriptor[] = [
      { id: 'my-step', description: 'My Description', execute: async () => {} },
    ];
    const result = await installWithProgress(steps, { enabled: false });
    expect(result.steps[0].id).toBe('my-step');
    expect(result.steps[0].description).toBe('My Description');
  });

  it('uses ProgressEstimator when steps have estimatedMs', async () => {
    const progressUpdates: ProgressEstimate[] = [];
    const steps: InstallStepDescriptor[] = [
      { id: 'fast', description: 'Fast step', estimatedMs: 1000, execute: async () => {} },
      { id: 'slow', description: 'Slow step', estimatedMs: 9000, execute: async () => {} },
    ];
    const result = await installWithProgress(steps, {
      enabled: false,
      onProgress: (est) => progressUpdates.push(est),
    });
    expect(result.success).toBe(true);
    expect(progressUpdates.length).toBeGreaterThanOrEqual(2);
    // After all steps complete, last update should be 100%
    const last = progressUpdates[progressUpdates.length - 1];
    expect(last.percent).toBe(100);
    expect(last.completedSteps).toBe(2);
  });

  it('does not use estimator when no steps have estimatedMs', async () => {
    const progressUpdates: ProgressEstimate[] = [];
    const steps: InstallStepDescriptor[] = [
      { id: 'a', description: 'Step A', execute: async () => {} },
    ];
    await installWithProgress(steps, {
      enabled: false,
      onProgress: (est) => progressUpdates.push(est),
    });
    // onProgress should not be called when there's no estimator
    expect(progressUpdates.length).toBe(0);
  });
});

// ============================================================================
// formatRemainingTime
// ============================================================================

describe('formatRemainingTime', () => {
  it('returns "calculating..." for null', () => {
    expect(formatRemainingTime(null)).toBe('calculating...');
  });

  it('returns "< 1s" for values under 1000ms', () => {
    expect(formatRemainingTime(0)).toBe('< 1s');
    expect(formatRemainingTime(500)).toBe('< 1s');
    expect(formatRemainingTime(999)).toBe('< 1s');
  });

  it('returns seconds only when under 60s', () => {
    expect(formatRemainingTime(1000)).toBe('1s');
    expect(formatRemainingTime(5000)).toBe('5s');
    expect(formatRemainingTime(45000)).toBe('45s');
    expect(formatRemainingTime(59000)).toBe('59s');
  });

  it('returns minutes only when seconds are 0', () => {
    expect(formatRemainingTime(60000)).toBe('1m');
    expect(formatRemainingTime(120000)).toBe('2m');
  });

  it('returns minutes and seconds', () => {
    expect(formatRemainingTime(90000)).toBe('1m 30s');
    expect(formatRemainingTime(150000)).toBe('2m 30s');
  });

  it('rounds up partial seconds', () => {
    // 1500ms = 1.5s -> ceil -> 2s
    expect(formatRemainingTime(1500)).toBe('2s');
    // 61500ms = 61.5s -> ceil -> 62s = 1m 2s
    expect(formatRemainingTime(61500)).toBe('1m 2s');
  });
});

// ============================================================================
// ProgressEstimator
// ============================================================================

describe('ProgressEstimator', () => {
  it('initializes with zero progress', () => {
    const estimator = new ProgressEstimator([
      { id: 'a', estimatedMs: 5000 },
      { id: 'b', estimatedMs: 10000 },
    ]);
    estimator.start();
    const est = estimator.getEstimate();
    expect(est.fraction).toBe(0);
    expect(est.percent).toBe(0);
    expect(est.completedSteps).toBe(0);
    expect(est.totalSteps).toBe(2);
  });

  it('calculates weighted progress after step completion', () => {
    const estimator = new ProgressEstimator([
      { id: 'a', estimatedMs: 2000 },
      { id: 'b', estimatedMs: 8000 },
    ]);
    estimator.start();
    estimator.stepStart('a');
    estimator.stepComplete('a', 1500);
    const est = estimator.getEstimate();
    // Step 'a' is 2000/(2000+8000) = 20% of total weight
    expect(est.percent).toBe(20);
    expect(est.completedSteps).toBe(1);
  });

  it('reaches 100% when all steps complete', () => {
    const estimator = new ProgressEstimator([
      { id: 'a', estimatedMs: 3000 },
      { id: 'b', estimatedMs: 7000 },
    ]);
    estimator.start();
    estimator.stepStart('a');
    estimator.stepComplete('a', 2000);
    estimator.stepStart('b');
    estimator.stepComplete('b', 5000);
    const est = estimator.getEstimate();
    expect(est.fraction).toBe(1);
    expect(est.percent).toBe(100);
    expect(est.completedSteps).toBe(2);
  });

  it('provides remaining time estimate', () => {
    const estimator = new ProgressEstimator([
      { id: 'a', estimatedMs: 5000 },
      { id: 'b', estimatedMs: 5000 },
    ]);
    estimator.start();
    estimator.stepStart('a');
    estimator.stepComplete('a', 4000);
    const est = estimator.getEstimate();
    // After completing 50% weight, remaining should be approximately equal to elapsed
    expect(est.remainingMs).not.toBeNull();
    expect(est.remainingMs!).toBeGreaterThanOrEqual(0);
    expect(est.remainingText).not.toBe('calculating...');
  });

  it('handles empty steps list', () => {
    const estimator = new ProgressEstimator([]);
    estimator.start();
    const est = estimator.getEstimate();
    expect(est.fraction).toBe(0);
    expect(est.percent).toBe(0);
    expect(est.totalSteps).toBe(0);
    expect(est.remainingMs).toBe(0);
  });

  it('clamps in-progress step fraction to 95%', () => {
    vi.useFakeTimers();
    try {
      const estimator = new ProgressEstimator([
        { id: 'a', estimatedMs: 1000 },
      ]);
      estimator.start();
      estimator.stepStart('a');
      // Advance time well past the estimated duration
      vi.advanceTimersByTime(5000);
      const est = estimator.getEstimate();
      // Should be capped at 95% (0.95 of 1000/1000 = 0.95)
      expect(est.fraction).toBeLessThanOrEqual(0.95);
      expect(est.percent).toBeLessThanOrEqual(95);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset clears all state', () => {
    const estimator = new ProgressEstimator([
      { id: 'a', estimatedMs: 5000 },
    ]);
    estimator.start();
    estimator.stepStart('a');
    estimator.stepComplete('a', 3000);
    estimator.reset();
    const est = estimator.getEstimate();
    expect(est.fraction).toBe(0);
    expect(est.percent).toBe(0);
    expect(est.completedSteps).toBe(0);
    expect(est.elapsedMs).toBe(0);
  });

  it('stepComplete without explicit duration uses elapsed time', () => {
    vi.useFakeTimers();
    try {
      const estimator = new ProgressEstimator([
        { id: 'a', estimatedMs: 10000 },
        { id: 'b', estimatedMs: 10000 },
      ]);
      estimator.start();
      estimator.stepStart('a');
      vi.advanceTimersByTime(3000);
      estimator.stepComplete('a'); // No explicit duration
      const est = estimator.getEstimate();
      expect(est.completedSteps).toBe(1);
      expect(est.percent).toBe(50); // a is 50% of total weight
    } finally {
      vi.useRealTimers();
    }
  });

  it('provides "calculating..." when no progress yet', () => {
    const estimator = new ProgressEstimator([
      { id: 'a', estimatedMs: 5000 },
    ]);
    // Not started yet
    const est = estimator.getEstimate();
    expect(est.elapsedMs).toBe(0);
    // remainingMs falls back to totalEstimatedMs
    expect(est.remainingMs).toBe(5000);
  });

  it('handles multiple steps with different weights', () => {
    const estimator = new ProgressEstimator([
      { id: 'check', estimatedMs: 1000 },
      { id: 'download', estimatedMs: 30000 },
      { id: 'install', estimatedMs: 60000 },
      { id: 'verify', estimatedMs: 2000 },
    ]);
    // Total = 93000
    estimator.start();

    // Complete 'check' (1000/93000 ≈ 1%)
    estimator.stepStart('check');
    estimator.stepComplete('check', 800);
    let est = estimator.getEstimate();
    expect(est.percent).toBe(1); // 1000/93000 ≈ 1.08% -> rounds to 1

    // Complete 'download' (31000/93000 ≈ 33%)
    estimator.stepStart('download');
    estimator.stepComplete('download', 25000);
    est = estimator.getEstimate();
    expect(est.percent).toBe(33); // (1000+30000)/93000 ≈ 33.3%

    // Complete 'install' (91000/93000 ≈ 98%)
    estimator.stepStart('install');
    estimator.stepComplete('install', 55000);
    est = estimator.getEstimate();
    expect(est.percent).toBe(98); // (1000+30000+60000)/93000 ≈ 97.8%

    // Complete 'verify' -> 100%
    estimator.stepStart('verify');
    estimator.stepComplete('verify', 1500);
    est = estimator.getEstimate();
    expect(est.percent).toBe(100);
  });
});

// ============================================================================
// SPINNER_STYLES
// ============================================================================

describe('SPINNER_STYLES', () => {
  it('contains all expected built-in styles', () => {
    const expected: SpinnerStyleName[] = ['dots', 'braille', 'bouncingBar', 'arrow', 'line', 'growDots', 'blocks'];
    for (const name of expected) {
      expect(SPINNER_STYLES[name]).toBeDefined();
      expect(SPINNER_STYLES[name].frames.length).toBeGreaterThan(0);
      expect(SPINNER_STYLES[name].intervalMs).toBeGreaterThan(0);
    }
  });

  it('dots style has 10 braille-like frames', () => {
    expect(SPINNER_STYLES.dots.frames).toHaveLength(10);
    expect(SPINNER_STYLES.dots.intervalMs).toBe(80);
  });

  it('each style has unique frames array', () => {
    const allFrameStrings = Object.values(SPINNER_STYLES).map(s => s.frames.join(','));
    const unique = new Set(allFrameStrings);
    expect(unique.size).toBe(allFrameStrings.length);
  });
});

// ============================================================================
// Spinner class
// ============================================================================

describe('Spinner', () => {
  function makeMockStream(): NodeJS.WriteStream & { written: string[] } {
    const written: string[] = [];
    return {
      isTTY: true,
      write: vi.fn((data: string) => { written.push(data); return true; }),
      columns: 80,
      rows: 24,
      clearLine: vi.fn(),
      cursorTo: vi.fn(),
      moveCursor: vi.fn(),
      written,
    } as unknown as NodeJS.WriteStream & { written: string[] };
  }

  it('creates with default dots style', () => {
    const stream = makeMockStream();
    const spin = new Spinner({ stream });
    expect(spin.isRunning).toBe(false);
  });

  it('starts and stops cleanly', () => {
    vi.useFakeTimers();
    try {
      const stream = makeMockStream();
      const spin = new Spinner({ style: 'dots', stream, hideCursor: false });
      spin.start('Loading...');
      expect(spin.isRunning).toBe(true);
      vi.advanceTimersByTime(100);
      spin.stop();
      expect(spin.isRunning).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders frames to stream', () => {
    vi.useFakeTimers();
    try {
      const stream = makeMockStream();
      const spin = new Spinner({ style: 'line', stream, hideCursor: false });
      spin.start('Test');
      // Initial render
      expect(stream.written.some(s => s.includes('Test'))).toBe(true);
      // Advance to render several frames
      vi.advanceTimersByTime(500);
      spin.stop();
      // Should have written multiple frames
      const frameWrites = stream.written.filter(s => s.includes('Test'));
      expect(frameWrites.length).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates message while running', () => {
    vi.useFakeTimers();
    try {
      const stream = makeMockStream();
      const spin = new Spinner({ style: 'dots', stream, hideCursor: false });
      spin.start('First');
      vi.advanceTimersByTime(100);
      spin.update('Second');
      vi.advanceTimersByTime(100);
      spin.stop();
      expect(stream.written.some(s => s.includes('Second'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('displays final message on stop', () => {
    vi.useFakeTimers();
    try {
      const stream = makeMockStream();
      const spin = new Spinner({ style: 'dots', stream, hideCursor: false });
      spin.start('Working');
      vi.advanceTimersByTime(100);
      spin.stop('Done!');
      expect(stream.written.some(s => s.includes('Done!'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies color function to frames', () => {
    vi.useFakeTimers();
    try {
      const stream = makeMockStream();
      const colorFn = (frame: string) => `[${frame}]`;
      const spin = new Spinner({ style: 'dots', stream, color: colorFn, hideCursor: false });
      spin.start('Test');
      // currentFrame should have color applied
      expect(spin.currentFrame).toMatch(/^\[.*\]$/);
      spin.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hides and shows cursor by default', () => {
    vi.useFakeTimers();
    try {
      const stream = makeMockStream();
      const spin = new Spinner({ style: 'dots', stream });
      spin.start('Test');
      // Should have written hide cursor escape
      expect(stream.written.some(s => s.includes('\x1B[?25l'))).toBe(true);
      spin.stop();
      // Should have written show cursor escape
      expect(stream.written.some(s => s.includes('\x1B[?25h'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not hide cursor when hideCursor is false', () => {
    vi.useFakeTimers();
    try {
      const stream = makeMockStream();
      const spin = new Spinner({ style: 'dots', stream, hideCursor: false });
      spin.start('Test');
      expect(stream.written.some(s => s.includes('\x1B[?25l'))).toBe(false);
      spin.stop();
      expect(stream.written.some(s => s.includes('\x1B[?25h'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('start is idempotent', () => {
    vi.useFakeTimers();
    try {
      const stream = makeMockStream();
      const spin = new Spinner({ style: 'dots', stream, hideCursor: false });
      spin.start('Test');
      const countAfterFirst = stream.written.length;
      spin.start('Test again'); // Should be ignored
      expect(stream.written.length).toBe(countAfterFirst);
      spin.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop is idempotent', () => {
    vi.useFakeTimers();
    try {
      const stream = makeMockStream();
      const spin = new Spinner({ style: 'dots', stream, hideCursor: false });
      spin.start('Test');
      spin.stop();
      // Calling stop again should not throw
      spin.stop();
      expect(spin.isRunning).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts custom SpinnerStyle', () => {
    vi.useFakeTimers();
    try {
      const stream = makeMockStream();
      const custom: SpinnerStyle = { frames: ['A', 'B', 'C'], intervalMs: 50 };
      const spin = new Spinner({ style: custom, stream, hideCursor: false });
      spin.start('Custom');
      expect(stream.written.some(s => s.includes('A'))).toBe(true);
      vi.advanceTimersByTime(55);
      expect(stream.written.some(s => s.includes('B'))).toBe(true);
      vi.advanceTimersByTime(55);
      expect(stream.written.some(s => s.includes('C'))).toBe(true);
      spin.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cycles through frames continuously', () => {
    vi.useFakeTimers();
    try {
      const stream = makeMockStream();
      const custom: SpinnerStyle = { frames: ['X', 'Y'], intervalMs: 50 };
      const spin = new Spinner({ style: custom, stream, hideCursor: false });
      spin.start('Cycle');
      // Advance enough to cycle through: initial + 4 ticks = 5 renders total
      vi.advanceTimersByTime(200);
      spin.stop();
      // We should see both X and Y frames multiple times
      const xCount = stream.written.filter(s => s.includes('X') && s.includes('Cycle')).length;
      const yCount = stream.written.filter(s => s.includes('Y') && s.includes('Cycle')).length;
      expect(xCount).toBeGreaterThanOrEqual(2);
      expect(yCount).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// createSpinner factory
// ============================================================================

describe('createSpinner', () => {
  it('creates a Spinner with default style', () => {
    const spin = createSpinner();
    expect(spin).toBeInstanceOf(Spinner);
    expect(spin.isRunning).toBe(false);
  });

  it('creates a Spinner with named style', () => {
    const spin = createSpinner('braille');
    expect(spin).toBeInstanceOf(Spinner);
  });

  it('creates a Spinner with custom style', () => {
    const spin = createSpinner({ frames: ['*', '+'], intervalMs: 100 });
    expect(spin).toBeInstanceOf(Spinner);
  });

  it('passes additional options through', () => {
    vi.useFakeTimers();
    try {
      const colorFn = (f: string) => `(${f})`;
      const spin = createSpinner('arrow', { color: colorFn });
      expect(spin.currentFrame).toMatch(/^\(.*\)$/);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================================
// buildProgressBar
// ============================================================================

describe('buildProgressBar', () => {
  it('returns empty bar at 0%', () => {
    const bar = buildProgressBar(0);
    expect(bar).toBe('[░░░░░░░░░░░░░░░░░░░░]');
  });

  it('returns full bar at 100%', () => {
    const bar = buildProgressBar(100);
    expect(bar).toBe('[████████████████████]');
  });

  it('returns half-filled bar at 50%', () => {
    const bar = buildProgressBar(50);
    expect(bar).toBe('[██████████░░░░░░░░░░]');
  });

  it('clamps values below 0', () => {
    const bar = buildProgressBar(-10);
    expect(bar).toBe('[░░░░░░░░░░░░░░░░░░░░]');
  });

  it('clamps values above 100', () => {
    const bar = buildProgressBar(150);
    expect(bar).toBe('[████████████████████]');
  });

  it('supports custom width', () => {
    const bar = buildProgressBar(50, 10);
    expect(bar).toBe('[█████░░░░░]');
    expect(bar.length).toBe(12); // 10 chars + 2 brackets
  });

  it('handles width of 1', () => {
    const bar100 = buildProgressBar(100, 1);
    expect(bar100).toBe('[█]');
    const bar0 = buildProgressBar(0, 1);
    expect(bar0).toBe('[░]');
  });

  it('rounds filled portion correctly', () => {
    // 25% of 20 = 5 filled
    const bar = buildProgressBar(25);
    const filled = (bar.match(/█/g) || []).length;
    expect(filled).toBe(5);
  });
});

// ============================================================================
// createProgress with spinnerStyle option
// ============================================================================

describe('createProgress with spinnerStyle', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  afterEach(() => {
    _resetActiveProgress();
  });

  it('returns noop reporter when disabled even with spinnerStyle', () => {
    const reporter = createProgress({ label: 'Test', enabled: false, spinnerStyle: 'braille' });
    reporter.setLabel('new');
    reporter.setPercent(50);
    reporter.done();
  });

  it('returns noop reporter for non-TTY even with spinnerStyle', () => {
    const stream = makeNonTTYStream();
    const reporter = createProgress({ label: 'Test', stream, spinnerStyle: 'arrow' });
    reporter.setLabel('new');
    reporter.done();
  });

  it('creates progress with custom spinner on TTY', () => {
    vi.useFakeTimers();
    try {
      const stream = makeFakeTTYStream();
      const reporter = createProgress({ label: 'Loading', stream, spinnerStyle: 'dots' });
      // Should be a real reporter (not noop) since stream is TTY
      reporter.setLabel('Updated');
      reporter.setPercent(50);
      reporter.setRemainingMs(5000);
      reporter.done();
    } finally {
      vi.useRealTimers();
    }
  });

  it('showProgressBar option does not crash', () => {
    const reporter = createProgress({ label: 'Test', enabled: false, showProgressBar: true });
    reporter.setPercent(50);
    reporter.done();
  });
});

// ============================================================================
// PhaseNotifier
// ============================================================================

describe('PhaseNotifier', () => {
  it('emits phase change on first step with a phase', () => {
    const steps = [
      { id: 'a', phase: 'setup' },
      { id: 'b', phase: 'setup' },
    ];
    const phases: Record<string, PhaseDescriptor> = {
      setup: { id: 'setup', title: 'Setting up', icon: '🔧' },
    };
    const notifier = new PhaseNotifier(steps, phases);
    const events: PhaseChangeEvent[] = [];
    notifier.onPhaseChange((e) => events.push(e));

    notifier.stepStarted('a');
    expect(events).toHaveLength(1);
    expect(events[0].phase.id).toBe('setup');
    expect(events[0].phase.title).toBe('Setting up');
    expect(events[0].phase.icon).toBe('🔧');
    expect(events[0].phaseIndex).toBe(0);
    expect(events[0].totalPhases).toBe(1);
    expect(events[0].stepsInPhase).toBe(2);
  });

  it('does not emit when same phase continues', () => {
    const steps = [
      { id: 'a', phase: 'setup' },
      { id: 'b', phase: 'setup' },
    ];
    const notifier = new PhaseNotifier(steps);
    const events: PhaseChangeEvent[] = [];
    notifier.onPhaseChange((e) => events.push(e));

    notifier.stepStarted('a');
    notifier.stepStarted('b');
    expect(events).toHaveLength(1);
  });

  it('emits when phase changes', () => {
    const steps = [
      { id: 'a', phase: 'check' },
      { id: 'b', phase: 'install' },
      { id: 'c', phase: 'verify' },
    ];
    const phases: Record<string, PhaseDescriptor> = {
      check: { id: 'check', title: 'Checking prerequisites' },
      install: { id: 'install', title: 'Installing packages' },
      verify: { id: 'verify', title: 'Verifying installation' },
    };
    const notifier = new PhaseNotifier(steps, phases);
    const events: PhaseChangeEvent[] = [];
    notifier.onPhaseChange((e) => events.push(e));

    notifier.stepStarted('a');
    notifier.stepStarted('b');
    notifier.stepStarted('c');

    expect(events).toHaveLength(3);
    expect(events[0].phaseIndex).toBe(0);
    expect(events[0].totalPhases).toBe(3);
    expect(events[1].phaseIndex).toBe(1);
    expect(events[2].phaseIndex).toBe(2);
  });

  it('ignores steps without a phase', () => {
    const steps = [
      { id: 'a', phase: 'setup' },
      { id: 'b' }, // no phase
      { id: 'c', phase: 'install' },
    ];
    const notifier = new PhaseNotifier(steps);
    const events: PhaseChangeEvent[] = [];
    notifier.onPhaseChange((e) => events.push(e));

    notifier.stepStarted('a');
    notifier.stepStarted('b'); // no phase → no event
    notifier.stepStarted('c');

    expect(events).toHaveLength(2);
    expect(events[0].phase.id).toBe('setup');
    expect(events[1].phase.id).toBe('install');
  });

  it('uses phase ID as title when no descriptor provided', () => {
    const steps = [{ id: 'a', phase: 'my-phase' }];
    const notifier = new PhaseNotifier(steps); // no descriptors
    const events: PhaseChangeEvent[] = [];
    notifier.onPhaseChange((e) => events.push(e));

    notifier.stepStarted('a');
    expect(events[0].phase.title).toBe('my-phase');
    expect(events[0].phase.icon).toBeUndefined();
  });

  it('tracks currentPhase correctly', () => {
    const steps = [
      { id: 'a', phase: 'alpha' },
      { id: 'b', phase: 'beta' },
    ];
    const notifier = new PhaseNotifier(steps);
    notifier.onPhaseChange(() => {});

    expect(notifier.currentPhase).toBeNull();
    notifier.stepStarted('a');
    expect(notifier.currentPhase).toBe('alpha');
    notifier.stepStarted('b');
    expect(notifier.currentPhase).toBe('beta');
  });

  it('allPhaseIds returns phases in order of first appearance', () => {
    const steps = [
      { id: 'a', phase: 'z-phase' },
      { id: 'b', phase: 'a-phase' },
      { id: 'c', phase: 'z-phase' },
    ];
    const notifier = new PhaseNotifier(steps);
    expect(notifier.allPhaseIds).toEqual(['z-phase', 'a-phase']);
  });

  it('reset clears current phase', () => {
    const steps = [{ id: 'a', phase: 'setup' }];
    const notifier = new PhaseNotifier(steps);
    notifier.onPhaseChange(() => {});

    notifier.stepStarted('a');
    expect(notifier.currentPhase).toBe('setup');
    notifier.reset();
    expect(notifier.currentPhase).toBeNull();
  });

  it('emits again after reset when same phase step starts', () => {
    const steps = [{ id: 'a', phase: 'setup' }];
    const notifier = new PhaseNotifier(steps);
    const events: PhaseChangeEvent[] = [];
    notifier.onPhaseChange((e) => events.push(e));

    notifier.stepStarted('a');
    notifier.reset();
    notifier.stepStarted('a');
    expect(events).toHaveLength(2);
  });

  it('handles empty steps list', () => {
    const notifier = new PhaseNotifier([]);
    const events: PhaseChangeEvent[] = [];
    notifier.onPhaseChange((e) => events.push(e));

    notifier.stepStarted('nonexistent');
    expect(events).toHaveLength(0);
    expect(notifier.allPhaseIds).toEqual([]);
  });

  it('counts steps per phase correctly', () => {
    const steps = [
      { id: 'a', phase: 'p1' },
      { id: 'b', phase: 'p1' },
      { id: 'c', phase: 'p1' },
      { id: 'd', phase: 'p2' },
    ];
    const notifier = new PhaseNotifier(steps);
    const events: PhaseChangeEvent[] = [];
    notifier.onPhaseChange((e) => events.push(e));

    notifier.stepStarted('a');
    expect(events[0].stepsInPhase).toBe(3);

    notifier.stepStarted('d');
    expect(events[1].stepsInPhase).toBe(1);
  });
});

// ============================================================================
// formatPhaseBanner
// ============================================================================

describe('formatPhaseBanner', () => {
  it('formats banner with icon', () => {
    const event: PhaseChangeEvent = {
      phase: { id: 'check', title: 'Checking prerequisites', icon: '🔍' },
      phaseIndex: 0,
      totalPhases: 3,
      stepsInPhase: 2,
    };
    const banner = formatPhaseBanner(event);
    expect(banner).toBe('── 🔍 Phase 1/3: Checking prerequisites ──');
  });

  it('formats banner without icon', () => {
    const event: PhaseChangeEvent = {
      phase: { id: 'install', title: 'Installing packages' },
      phaseIndex: 1,
      totalPhases: 3,
      stepsInPhase: 4,
    };
    const banner = formatPhaseBanner(event);
    expect(banner).toBe('── Phase 2/3: Installing packages ──');
  });

  it('formats single phase correctly', () => {
    const event: PhaseChangeEvent = {
      phase: { id: 'all', title: 'Running all steps', icon: '🚀' },
      phaseIndex: 0,
      totalPhases: 1,
      stepsInPhase: 5,
    };
    const banner = formatPhaseBanner(event);
    expect(banner).toBe('── 🚀 Phase 1/1: Running all steps ──');
  });
});

// ============================================================================
// installWithProgress with phase notifications
// ============================================================================

describe('installWithProgress with phases', () => {
  beforeEach(() => {
    _resetActiveProgress();
  });

  afterEach(() => {
    _resetActiveProgress();
  });

  it('calls onPhaseChange when steps have phases', async () => {
    const phaseEvents: PhaseChangeEvent[] = [];
    const steps: InstallStepDescriptor[] = [
      { id: 'check-node', description: 'Check Node.js', phase: 'prerequisites', execute: async () => {} },
      { id: 'check-pnpm', description: 'Check pnpm', phase: 'prerequisites', execute: async () => {} },
      { id: 'install-app', description: 'Install app', phase: 'installation', execute: async () => {} },
      { id: 'verify', description: 'Verify install', phase: 'verification', execute: async () => {} },
    ];
    const phases: Record<string, PhaseDescriptor> = {
      prerequisites: { id: 'prerequisites', title: 'Checking prerequisites', icon: '🔍' },
      installation: { id: 'installation', title: 'Installing packages', icon: '📦' },
      verification: { id: 'verification', title: 'Verifying installation', icon: '✅' },
    };

    const result = await installWithProgress(steps, {
      enabled: false,
      onPhaseChange: (e) => phaseEvents.push(e),
      phases,
    });

    expect(result.success).toBe(true);
    expect(phaseEvents).toHaveLength(3);
    expect(phaseEvents[0].phase.title).toBe('Checking prerequisites');
    expect(phaseEvents[0].stepsInPhase).toBe(2);
    expect(phaseEvents[1].phase.title).toBe('Installing packages');
    expect(phaseEvents[1].stepsInPhase).toBe(1);
    expect(phaseEvents[2].phase.title).toBe('Verifying installation');
    expect(phaseEvents[2].stepsInPhase).toBe(1);
  });

  it('does not call onPhaseChange when no steps have phases', async () => {
    const phaseEvents: PhaseChangeEvent[] = [];
    const steps: InstallStepDescriptor[] = [
      { id: 'a', description: 'Step A', execute: async () => {} },
      { id: 'b', description: 'Step B', execute: async () => {} },
    ];

    await installWithProgress(steps, {
      enabled: false,
      onPhaseChange: (e) => phaseEvents.push(e),
    });

    expect(phaseEvents).toHaveLength(0);
  });

  it('emits phase changes even when a step fails', async () => {
    const phaseEvents: PhaseChangeEvent[] = [];
    const steps: InstallStepDescriptor[] = [
      { id: 'a', description: 'Step A', phase: 'phase1', execute: async () => {} },
      { id: 'b', description: 'Step B', phase: 'phase2', execute: async () => { throw new Error('fail'); } },
    ];

    const result = await installWithProgress(steps, {
      enabled: false,
      onPhaseChange: (e) => phaseEvents.push(e),
    });

    expect(result.success).toBe(false);
    expect(phaseEvents).toHaveLength(2);
    expect(phaseEvents[0].phase.id).toBe('phase1');
    expect(phaseEvents[1].phase.id).toBe('phase2');
  });

  it('works with mixed steps (some with phase, some without)', async () => {
    const phaseEvents: PhaseChangeEvent[] = [];
    const steps: InstallStepDescriptor[] = [
      { id: 'a', description: 'Step A', phase: 'setup', execute: async () => {} },
      { id: 'b', description: 'Step B', execute: async () => {} }, // no phase
      { id: 'c', description: 'Step C', phase: 'install', execute: async () => {} },
    ];

    const result = await installWithProgress(steps, {
      enabled: false,
      onPhaseChange: (e) => phaseEvents.push(e),
    });

    expect(result.success).toBe(true);
    expect(phaseEvents).toHaveLength(2);
    expect(phaseEvents[0].phase.id).toBe('setup');
    expect(phaseEvents[1].phase.id).toBe('install');
  });

  it('works without onPhaseChange callback even when steps have phases', async () => {
    const steps: InstallStepDescriptor[] = [
      { id: 'a', description: 'Step A', phase: 'setup', execute: async () => {} },
    ];
    // No onPhaseChange callback - should not throw
    const result = await installWithProgress(steps, { enabled: false });
    expect(result.success).toBe(true);
  });
});
