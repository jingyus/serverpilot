/**
 * Tests for installation step auto-retry module.
 *
 * @module installers/openclaw/step-retry.test
 */

import { describe, it, expect, vi } from 'vitest';
import type { ExecResult, InstallStep } from '@aiinstaller/shared';
import {
  selectRetryStrategy,
  calculateRetryDelay,
  shouldRetry,
  isStepSuccess,
  executeWithRetry,
  summarizeRetryResult,
  getRetryErrors,
  DEFAULT_STEP_RETRY_OPTIONS,
  type StepRetryOptions,
  type StepRetryResult,
  type SleepFn,
} from './step-retry.js';

// ============================================================================
// Helpers
// ============================================================================

function makeStep(overrides: Partial<InstallStep> = {}): InstallStep {
  return {
    id: 'test-step',
    description: 'Test step',
    command: 'echo hello',
    timeout: 30000,
    canRollback: false,
    onError: 'retry',
    ...overrides,
  };
}

function makeResult(overrides: Partial<ExecResult> = {}): ExecResult {
  return {
    command: 'echo hello',
    exitCode: 0,
    stdout: 'hello\n',
    stderr: '',
    duration: 100,
    timedOut: false,
    ...overrides,
  };
}

/** A no-op sleep function for testing (no actual delays). */
const noopSleep: SleepFn = async () => {};

// ============================================================================
// selectRetryStrategy
// ============================================================================

describe('selectRetryStrategy', () => {
  it('should return "none" for steps with onError "abort"', () => {
    const step = makeStep({ onError: 'abort' });
    expect(selectRetryStrategy(step)).toBe('none');
  });

  it('should return "none" for steps with onError "skip"', () => {
    const step = makeStep({ onError: 'skip' });
    expect(selectRetryStrategy(step)).toBe('none');
  });

  it('should return "exponential" for steps with onError "retry"', () => {
    const step = makeStep({ onError: 'retry' });
    expect(selectRetryStrategy(step)).toBe('exponential');
  });

  it('should return "fixed" for steps with onError "fallback"', () => {
    const step = makeStep({ onError: 'fallback' });
    expect(selectRetryStrategy(step)).toBe('fixed');
  });

  it('should use override strategy when provided and not default', () => {
    const step = makeStep({ onError: 'retry' });
    expect(selectRetryStrategy(step, 'immediate')).toBe('immediate');
  });

  it('should use override strategy "fixed" for retry steps', () => {
    const step = makeStep({ onError: 'retry' });
    expect(selectRetryStrategy(step, 'fixed')).toBe('fixed');
  });

  it('should use override strategy "none" for retry steps', () => {
    const step = makeStep({ onError: 'retry' });
    expect(selectRetryStrategy(step, 'none')).toBe('none');
  });

  it('should still return "none" for abort steps even with exponential override', () => {
    const step = makeStep({ onError: 'abort' });
    // exponential is the "default" so it doesn't count as an explicit override
    expect(selectRetryStrategy(step, 'exponential')).toBe('none');
  });

  it('should use override for abort steps when override is non-default', () => {
    const step = makeStep({ onError: 'abort' });
    expect(selectRetryStrategy(step, 'immediate')).toBe('immediate');
  });
});

// ============================================================================
// calculateRetryDelay
// ============================================================================

describe('calculateRetryDelay', () => {
  const baseOptions: StepRetryOptions = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    strategy: 'exponential',
    jitterFactor: 0.25,
  };

  describe('strategy: none', () => {
    it('should return 0', () => {
      const opts = { ...baseOptions, strategy: 'none' as const };
      expect(calculateRetryDelay(0, opts)).toBe(0);
      expect(calculateRetryDelay(5, opts)).toBe(0);
    });
  });

  describe('strategy: immediate', () => {
    it('should return 0', () => {
      const opts = { ...baseOptions, strategy: 'immediate' as const };
      expect(calculateRetryDelay(0, opts)).toBe(0);
      expect(calculateRetryDelay(5, opts)).toBe(0);
    });
  });

  describe('strategy: fixed', () => {
    it('should return initialDelayMs with no jitter when random=0.5', () => {
      const opts = { ...baseOptions, strategy: 'fixed' as const };
      const delay = calculateRetryDelay(0, opts, 0.5);
      expect(delay).toBe(1000);
    });

    it('should apply jitter to fixed delay', () => {
      const opts = { ...baseOptions, strategy: 'fixed' as const };
      const delayMin = calculateRetryDelay(0, opts, 0);
      const delayMax = calculateRetryDelay(0, opts, 1);
      // jitter range: ±25% of 1000 → [750, 1250]
      expect(delayMin).toBe(750);
      expect(delayMax).toBe(1250);
    });

    it('should cap at maxDelayMs', () => {
      const opts = { ...baseOptions, strategy: 'fixed' as const, maxDelayMs: 500 };
      const delay = calculateRetryDelay(0, opts, 1);
      expect(delay).toBeLessThanOrEqual(500);
    });

    it('should return same delay regardless of attempt number', () => {
      const opts = { ...baseOptions, strategy: 'fixed' as const };
      const delay0 = calculateRetryDelay(0, opts, 0.5);
      const delay5 = calculateRetryDelay(5, opts, 0.5);
      expect(delay0).toBe(delay5);
    });
  });

  describe('strategy: exponential', () => {
    it('should return initialDelayMs for attempt 0 with no jitter', () => {
      const delay = calculateRetryDelay(0, baseOptions, 0.5);
      // 1000 * 2^0 = 1000, jitter = 0
      expect(delay).toBe(1000);
    });

    it('should apply exponential backoff', () => {
      const delay0 = calculateRetryDelay(0, baseOptions, 0.5);
      const delay1 = calculateRetryDelay(1, baseOptions, 0.5);
      const delay2 = calculateRetryDelay(2, baseOptions, 0.5);
      expect(delay0).toBe(1000);
      expect(delay1).toBe(2000);
      expect(delay2).toBe(4000);
    });

    it('should apply jitter with exponential backoff', () => {
      const delayMin = calculateRetryDelay(0, baseOptions, 0);
      const delayMax = calculateRetryDelay(0, baseOptions, 1);
      // base = 1000, jitter = ±250
      expect(delayMin).toBe(750);
      expect(delayMax).toBe(1250);
    });

    it('should cap delay at maxDelayMs', () => {
      const opts = { ...baseOptions, maxDelayMs: 3000 };
      const delay = calculateRetryDelay(10, opts, 0.5);
      expect(delay).toBeLessThanOrEqual(3000);
    });

    it('should never return negative delay', () => {
      const opts = { ...baseOptions, initialDelayMs: 1, jitterFactor: 0.5 };
      const delay = calculateRetryDelay(0, opts, 0);
      expect(delay).toBeGreaterThanOrEqual(0);
    });
  });
});

// ============================================================================
// shouldRetry
// ============================================================================

describe('shouldRetry', () => {
  it('should return false when command succeeded', () => {
    const step = makeStep({ onError: 'retry' });
    const result = makeResult({ exitCode: 0 });
    expect(shouldRetry(step, result)).toBe(false);
  });

  it('should return true when command failed and onError is "retry"', () => {
    const step = makeStep({ onError: 'retry' });
    const result = makeResult({ exitCode: 1 });
    expect(shouldRetry(step, result)).toBe(true);
  });

  it('should return true when command timed out and onError is "retry"', () => {
    const step = makeStep({ onError: 'retry' });
    const result = makeResult({ exitCode: 0, timedOut: true });
    expect(shouldRetry(step, result)).toBe(true);
  });

  it('should return true when command failed and onError is "fallback"', () => {
    const step = makeStep({ onError: 'fallback' });
    const result = makeResult({ exitCode: 1 });
    expect(shouldRetry(step, result)).toBe(true);
  });

  it('should return false when command failed and onError is "abort"', () => {
    const step = makeStep({ onError: 'abort' });
    const result = makeResult({ exitCode: 1 });
    expect(shouldRetry(step, result)).toBe(false);
  });

  it('should return false when command failed and onError is "skip"', () => {
    const step = makeStep({ onError: 'skip' });
    const result = makeResult({ exitCode: 1 });
    expect(shouldRetry(step, result)).toBe(false);
  });

  it('should return true when expectedOutput does not match even if exit code is 0', () => {
    const step = makeStep({ onError: 'retry', expectedOutput: 'v22' });
    const result = makeResult({ exitCode: 0, stdout: 'v18.0.0' });
    expect(shouldRetry(step, result)).toBe(true);
  });

  it('should return false when expectedOutput matches', () => {
    const step = makeStep({ onError: 'retry', expectedOutput: 'v22' });
    const result = makeResult({ exitCode: 0, stdout: 'v22.1.0' });
    expect(shouldRetry(step, result)).toBe(false);
  });
});

// ============================================================================
// isStepSuccess
// ============================================================================

describe('isStepSuccess', () => {
  it('should return true for exit code 0 with no expected output', () => {
    const step = makeStep();
    const result = makeResult({ exitCode: 0 });
    expect(isStepSuccess(result, step)).toBe(true);
  });

  it('should return false for non-zero exit code', () => {
    const step = makeStep();
    const result = makeResult({ exitCode: 1 });
    expect(isStepSuccess(result, step)).toBe(false);
  });

  it('should return false when timed out', () => {
    const step = makeStep();
    const result = makeResult({ exitCode: 0, timedOut: true });
    expect(isStepSuccess(result, step)).toBe(false);
  });

  it('should return false when expectedOutput does not match', () => {
    const step = makeStep({ expectedOutput: 'v22' });
    const result = makeResult({ exitCode: 0, stdout: 'v18.0.0' });
    expect(isStepSuccess(result, step)).toBe(false);
  });

  it('should return true when expectedOutput matches', () => {
    const step = makeStep({ expectedOutput: 'v22' });
    const result = makeResult({ exitCode: 0, stdout: 'v22.1.0' });
    expect(isStepSuccess(result, step)).toBe(true);
  });
});

// ============================================================================
// executeWithRetry
// ============================================================================

describe('executeWithRetry', () => {
  it('should succeed on first attempt', async () => {
    const step = makeStep({ onError: 'retry' });
    const runner = vi.fn().mockResolvedValue(makeResult({ exitCode: 0 }));

    const result = await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(1);
    expect(result.attempts).toHaveLength(1);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const step = makeStep({ onError: 'retry' });
    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult({ exitCode: 1, stderr: 'error' }))
      .mockResolvedValueOnce(makeResult({ exitCode: 1, stderr: 'error' }))
      .mockResolvedValueOnce(makeResult({ exitCode: 0 }));

    const result = await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(3);
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it('should fail after exhausting all retries', async () => {
    const step = makeStep({ onError: 'retry' });
    const runner = vi.fn().mockResolvedValue(makeResult({ exitCode: 1, stderr: 'persistent error' }));

    const result = await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(result.success).toBe(false);
    expect(result.totalAttempts).toBe(4); // 1 initial + 3 retries
    expect(runner).toHaveBeenCalledTimes(4);
  });

  it('should not retry when strategy is "none"', async () => {
    const step = makeStep({ onError: 'abort' });
    const runner = vi.fn().mockResolvedValue(makeResult({ exitCode: 1 }));

    const result = await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(result.success).toBe(false);
    expect(result.totalAttempts).toBe(1);
    expect(runner).toHaveBeenCalledTimes(1);
    expect(result.strategyUsed).toBe('none');
  });

  it('should use exponential strategy for retry steps by default', async () => {
    const step = makeStep({ onError: 'retry' });
    const runner = vi.fn().mockResolvedValue(makeResult({ exitCode: 0 }));

    const result = await executeWithRetry(step, runner, {}, noopSleep);

    expect(result.strategyUsed).toBe('exponential');
  });

  it('should use fixed strategy for fallback steps by default', async () => {
    const step = makeStep({ onError: 'fallback' });
    const runner = vi.fn().mockResolvedValue(makeResult({ exitCode: 0 }));

    const result = await executeWithRetry(step, runner, {}, noopSleep);

    expect(result.strategyUsed).toBe('fixed');
  });

  it('should call sleep with appropriate delays between retries', async () => {
    const step = makeStep({ onError: 'retry' });
    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult({ exitCode: 1 }))
      .mockResolvedValueOnce(makeResult({ exitCode: 0 }));

    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await executeWithRetry(
      step,
      runner,
      { maxRetries: 3, initialDelayMs: 1000, strategy: 'exponential' },
      sleepFn,
    );

    // Sleep should be called once (before the second attempt)
    expect(sleepFn).toHaveBeenCalledTimes(1);
    const delay = sleepFn.mock.calls[0][0];
    // Delay should be around 1000ms (±25% jitter)
    expect(delay).toBeGreaterThanOrEqual(750);
    expect(delay).toBeLessThanOrEqual(1250);
  });

  it('should not call sleep before the first attempt', async () => {
    const step = makeStep({ onError: 'retry' });
    const runner = vi.fn().mockResolvedValue(makeResult({ exitCode: 0 }));

    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await executeWithRetry(step, runner, { maxRetries: 3 }, sleepFn);

    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('should not sleep with immediate strategy', async () => {
    const step = makeStep({ onError: 'retry' });
    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult({ exitCode: 1 }))
      .mockResolvedValueOnce(makeResult({ exitCode: 0 }));

    const sleepFn = vi.fn().mockResolvedValue(undefined);

    await executeWithRetry(
      step,
      runner,
      { maxRetries: 3, strategy: 'immediate' },
      sleepFn,
    );

    // Sleep should not be called (delay is 0 for immediate strategy)
    expect(sleepFn).not.toHaveBeenCalled();
  });

  it('should record all attempt details', async () => {
    const step = makeStep({ id: 'test-step', onError: 'retry' });
    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult({ exitCode: 1, stderr: 'err1' }))
      .mockResolvedValueOnce(makeResult({ exitCode: 0, stdout: 'ok' }));

    const result = await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].attemptNumber).toBe(0);
    expect(result.attempts[0].result.exitCode).toBe(1);
    expect(result.attempts[0].delayMs).toBe(0); // First attempt has no delay
    expect(result.attempts[1].attemptNumber).toBe(1);
    expect(result.attempts[1].result.exitCode).toBe(0);
    expect(result.attempts[1].delayMs).toBeGreaterThan(0); // Retry has delay
  });

  it('should handle timeout as a failure and retry', async () => {
    const step = makeStep({ onError: 'retry' });
    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult({ exitCode: 0, timedOut: true }))
      .mockResolvedValueOnce(makeResult({ exitCode: 0 }));

    const result = await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(2);
  });

  it('should handle expectedOutput mismatch as failure and retry', async () => {
    const step = makeStep({ onError: 'retry', expectedOutput: 'v22' });
    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult({ exitCode: 0, stdout: 'v18.0.0' }))
      .mockResolvedValueOnce(makeResult({ exitCode: 0, stdout: 'v22.1.0' }));

    const result = await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(2);
  });

  it('should respect maxRetries=0 (no retries)', async () => {
    const step = makeStep({ onError: 'retry' });
    const runner = vi.fn().mockResolvedValue(makeResult({ exitCode: 1 }));

    const result = await executeWithRetry(step, runner, { maxRetries: 0 }, noopSleep);

    expect(result.success).toBe(false);
    expect(result.totalAttempts).toBe(1);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('should track elapsed time', async () => {
    const step = makeStep({ onError: 'retry' });
    const runner = vi.fn().mockResolvedValue(makeResult({ exitCode: 0 }));

    const result = await executeWithRetry(step, runner, {}, noopSleep);

    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('should return the correct stepId in result', async () => {
    const step = makeStep({ id: 'install-pnpm', onError: 'retry' });
    const runner = vi.fn().mockResolvedValue(makeResult({ exitCode: 0 }));

    const result = await executeWithRetry(step, runner, {}, noopSleep);

    expect(result.stepId).toBe('install-pnpm');
  });

  it('should set finalResult to the last attempt result', async () => {
    const step = makeStep({ onError: 'retry' });
    const finalExecResult = makeResult({ exitCode: 1, stderr: 'final error' });
    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult({ exitCode: 1, stderr: 'first error' }))
      .mockResolvedValueOnce(finalExecResult);

    const result = await executeWithRetry(step, runner, { maxRetries: 1 }, noopSleep);

    expect(result.finalResult.stderr).toBe('final error');
  });

  it('should use default options when none provided', async () => {
    const step = makeStep({ onError: 'retry' });
    const runner = vi.fn().mockResolvedValue(makeResult({ exitCode: 0 }));

    const result = await executeWithRetry(step, runner, undefined, noopSleep);

    expect(result.success).toBe(true);
    expect(result.strategyUsed).toBe('exponential');
  });

  it('should run the same command on each retry', async () => {
    const step = makeStep({ command: 'npm install -g pnpm', onError: 'retry' });
    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult({ exitCode: 1 }))
      .mockResolvedValueOnce(makeResult({ exitCode: 0 }));

    await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner).toHaveBeenNthCalledWith(1, 'npm install -g pnpm');
    expect(runner).toHaveBeenNthCalledWith(2, 'npm install -g pnpm');
  });
});

// ============================================================================
// summarizeRetryResult
// ============================================================================

describe('summarizeRetryResult', () => {
  it('should summarize first-attempt success', () => {
    const result: StepRetryResult = {
      stepId: 'check-node',
      success: true,
      totalAttempts: 1,
      attempts: [],
      elapsedMs: 50,
      finalResult: makeResult(),
      strategyUsed: 'exponential',
    };

    const summary = summarizeRetryResult(result);
    expect(summary).toContain('check-node');
    expect(summary).toContain('first attempt');
  });

  it('should summarize retry success with details', () => {
    const result: StepRetryResult = {
      stepId: 'install-pnpm',
      success: true,
      totalAttempts: 3,
      attempts: [],
      elapsedMs: 5000,
      finalResult: makeResult(),
      strategyUsed: 'exponential',
    };

    const summary = summarizeRetryResult(result);
    expect(summary).toContain('install-pnpm');
    expect(summary).toContain('3 attempt(s)');
    expect(summary).toContain('exponential');
    expect(summary).toContain('5000ms');
  });

  it('should summarize failure with error info', () => {
    const result: StepRetryResult = {
      stepId: 'install-openclaw',
      success: false,
      totalAttempts: 4,
      attempts: [],
      elapsedMs: 10000,
      finalResult: makeResult({ exitCode: 1, stderr: 'EACCES permission denied' }),
      strategyUsed: 'exponential',
    };

    const summary = summarizeRetryResult(result);
    expect(summary).toContain('install-openclaw');
    expect(summary).toContain('failed');
    expect(summary).toContain('4 attempt(s)');
    expect(summary).toContain('exit code 1');
    expect(summary).toContain('EACCES permission denied');
  });

  it('should truncate long stderr in summary', () => {
    const longStderr = 'x'.repeat(300);
    const result: StepRetryResult = {
      stepId: 'test',
      success: false,
      totalAttempts: 1,
      attempts: [],
      elapsedMs: 100,
      finalResult: makeResult({ exitCode: 1, stderr: longStderr }),
      strategyUsed: 'none',
    };

    const summary = summarizeRetryResult(result);
    // stderr is truncated to 200 chars
    expect(summary.length).toBeLessThan(longStderr.length + 200);
  });

  it('should show "(empty)" for empty stderr', () => {
    const result: StepRetryResult = {
      stepId: 'test',
      success: false,
      totalAttempts: 1,
      attempts: [],
      elapsedMs: 100,
      finalResult: makeResult({ exitCode: 1, stderr: '' }),
      strategyUsed: 'none',
    };

    const summary = summarizeRetryResult(result);
    expect(summary).toContain('(empty)');
  });
});

// ============================================================================
// getRetryErrors
// ============================================================================

describe('getRetryErrors', () => {
  it('should return empty array when all attempts succeeded', () => {
    const result: StepRetryResult = {
      stepId: 'test',
      success: true,
      totalAttempts: 1,
      attempts: [
        {
          attemptNumber: 0,
          command: 'echo ok',
          result: makeResult({ exitCode: 0 }),
          delayMs: 0,
          timestamp: Date.now(),
        },
      ],
      elapsedMs: 50,
      finalResult: makeResult(),
      strategyUsed: 'exponential',
    };

    expect(getRetryErrors(result)).toEqual([]);
  });

  it('should extract error details from failed attempts', () => {
    const result: StepRetryResult = {
      stepId: 'test',
      success: true,
      totalAttempts: 3,
      attempts: [
        {
          attemptNumber: 0,
          command: 'cmd',
          result: makeResult({ exitCode: 1, stderr: 'err1' }),
          delayMs: 0,
          timestamp: Date.now(),
        },
        {
          attemptNumber: 1,
          command: 'cmd',
          result: makeResult({ exitCode: 1, stderr: 'err2' }),
          delayMs: 1000,
          timestamp: Date.now(),
        },
        {
          attemptNumber: 2,
          command: 'cmd',
          result: makeResult({ exitCode: 0 }),
          delayMs: 2000,
          timestamp: Date.now(),
        },
      ],
      elapsedMs: 5000,
      finalResult: makeResult(),
      strategyUsed: 'exponential',
    };

    const errors = getRetryErrors(result);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual({
      attemptNumber: 0,
      exitCode: 1,
      stderr: 'err1',
      timedOut: false,
    });
    expect(errors[1]).toEqual({
      attemptNumber: 1,
      exitCode: 1,
      stderr: 'err2',
      timedOut: false,
    });
  });

  it('should include timed out attempts', () => {
    const result: StepRetryResult = {
      stepId: 'test',
      success: false,
      totalAttempts: 1,
      attempts: [
        {
          attemptNumber: 0,
          command: 'cmd',
          result: makeResult({ exitCode: 0, timedOut: true }),
          delayMs: 0,
          timestamp: Date.now(),
        },
      ],
      elapsedMs: 30000,
      finalResult: makeResult({ exitCode: 0, timedOut: true }),
      strategyUsed: 'exponential',
    };

    const errors = getRetryErrors(result);
    expect(errors).toHaveLength(1);
    expect(errors[0].timedOut).toBe(true);
  });
});

// ============================================================================
// DEFAULT_STEP_RETRY_OPTIONS
// ============================================================================

describe('DEFAULT_STEP_RETRY_OPTIONS', () => {
  it('should have sensible defaults', () => {
    expect(DEFAULT_STEP_RETRY_OPTIONS.maxRetries).toBe(3);
    expect(DEFAULT_STEP_RETRY_OPTIONS.initialDelayMs).toBe(1000);
    expect(DEFAULT_STEP_RETRY_OPTIONS.maxDelayMs).toBe(30000);
    expect(DEFAULT_STEP_RETRY_OPTIONS.backoffMultiplier).toBe(2);
    expect(DEFAULT_STEP_RETRY_OPTIONS.strategy).toBe('exponential');
    expect(DEFAULT_STEP_RETRY_OPTIONS.jitterFactor).toBe(0.25);
  });
});

// ============================================================================
// Integration scenarios
// ============================================================================

describe('Integration scenarios', () => {
  it('should handle install-pnpm step with retry and eventual success', async () => {
    const step = makeStep({
      id: 'install-pnpm',
      command: 'npm install -g pnpm',
      onError: 'retry',
      timeout: 60000,
    });

    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult({
        command: 'npm install -g pnpm',
        exitCode: 1,
        stderr: 'ECONNRESET network error',
      }))
      .mockResolvedValueOnce(makeResult({
        command: 'npm install -g pnpm',
        exitCode: 0,
        stdout: 'added 1 package',
      }));

    const result = await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(2);
    expect(result.stepId).toBe('install-pnpm');
    expect(result.strategyUsed).toBe('exponential');
  });

  it('should handle verify-installation step without retry (abort strategy)', async () => {
    const step = makeStep({
      id: 'verify-installation',
      command: 'openclaw --version',
      expectedOutput: 'openclaw',
      onError: 'abort',
      timeout: 30000,
    });

    const runner = vi.fn().mockResolvedValue(makeResult({
      command: 'openclaw --version',
      exitCode: 1,
      stderr: 'command not found: openclaw',
    }));

    const result = await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(result.success).toBe(false);
    expect(result.totalAttempts).toBe(1);
    expect(result.strategyUsed).toBe('none');
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('should handle check-node step with fallback strategy', async () => {
    const step = makeStep({
      id: 'check-node',
      command: 'node --version',
      expectedOutput: 'v22',
      onError: 'fallback',
      timeout: 30000,
    });

    const runner = vi.fn()
      .mockResolvedValueOnce(makeResult({
        command: 'node --version',
        exitCode: 0,
        stdout: 'v18.0.0',
      }))
      .mockResolvedValueOnce(makeResult({
        command: 'node --version',
        exitCode: 0,
        stdout: 'v22.1.0',
      }));

    const result = await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(2);
    expect(result.strategyUsed).toBe('fixed');
  });

  it('should handle maximum retry scenario with all failures', async () => {
    const step = makeStep({
      id: 'install-openclaw',
      command: 'pnpm install -g openclaw',
      onError: 'retry',
      timeout: 120000,
    });

    const runner = vi.fn().mockResolvedValue(makeResult({
      command: 'pnpm install -g openclaw',
      exitCode: 1,
      stderr: 'EACCES: permission denied',
    }));

    const result = await executeWithRetry(step, runner, { maxRetries: 3 }, noopSleep);

    expect(result.success).toBe(false);
    expect(result.totalAttempts).toBe(4);
    expect(result.strategyUsed).toBe('exponential');

    const errors = getRetryErrors(result);
    expect(errors).toHaveLength(4);
    errors.forEach((err) => {
      expect(err.stderr).toContain('EACCES');
    });

    const summary = summarizeRetryResult(result);
    expect(summary).toContain('failed');
    expect(summary).toContain('4 attempt(s)');
  });
});
