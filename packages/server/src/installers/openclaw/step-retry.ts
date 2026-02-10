/**
 * Installation step auto-retry module.
 *
 * Provides configurable retry logic for individual installation steps
 * with exponential backoff and retry strategy selection. When a step
 * command fails, it is retried up to a configurable number of times
 * (default: 3) before falling back to the auto-switch mechanism.
 *
 * Works with:
 * - auto-switch.ts: step-retry runs _before_ switching to alternatives
 * - steps.ts: uses InstallStep.onError to determine retry eligibility
 * - success-rate-tracker.ts: records retry outcomes
 *
 * @module installers/openclaw/step-retry
 */

import type { ExecResult, InstallStep } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

/** Strategy for deciding when and how to retry a failed command. */
export type RetryStrategy =
  | 'immediate'       // Retry immediately without delay
  | 'fixed'           // Retry with a fixed delay
  | 'exponential'     // Retry with exponential backoff (default)
  | 'none';           // Do not retry

/** Configuration options for step retry behavior. */
export interface StepRetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Initial delay in milliseconds before the first retry (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelayMs: number;
  /** Backoff multiplier for exponential strategy (default: 2) */
  backoffMultiplier: number;
  /** Retry strategy (default: 'exponential') */
  strategy: RetryStrategy;
  /** Jitter factor (0-1) to randomize delays and prevent thundering herd (default: 0.25) */
  jitterFactor: number;
}

/** Record of a single retry attempt. */
export interface RetryAttempt {
  /** Attempt number (0 = first try, 1 = first retry, etc.) */
  attemptNumber: number;
  /** The command that was executed */
  command: string;
  /** Execution result */
  result: ExecResult;
  /** Delay in ms that preceded this attempt (0 for the first try) */
  delayMs: number;
  /** Timestamp when the attempt started */
  timestamp: number;
}

/** Result of the step retry process. */
export interface StepRetryResult {
  /** The step ID */
  stepId: string;
  /** Whether any attempt succeeded */
  success: boolean;
  /** Total number of attempts (1 = no retries) */
  totalAttempts: number;
  /** All individual attempt records */
  attempts: RetryAttempt[];
  /** Total elapsed time in milliseconds */
  elapsedMs: number;
  /** The final ExecResult (from the last attempt) */
  finalResult: ExecResult;
  /** The retry strategy that was used */
  strategyUsed: RetryStrategy;
}

/**
 * Function signature for executing a command.
 * Allows injecting the executor for testability.
 */
export type CommandRunner = (command: string) => Promise<ExecResult>;

/**
 * Function signature for sleeping/delaying.
 * Allows injecting for testability.
 */
export type SleepFn = (ms: number) => Promise<void>;

// ============================================================================
// Constants
// ============================================================================

/** Default retry options. */
export const DEFAULT_STEP_RETRY_OPTIONS: StepRetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  strategy: 'exponential',
  jitterFactor: 0.25,
};

/** Default sleep implementation. */
export const defaultSleep: SleepFn = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// Strategy selection
// ============================================================================

/**
 * Select the appropriate retry strategy for a step based on its
 * error handling configuration and the error context.
 *
 * Strategy selection logic:
 * - Steps with onError 'abort' or 'skip' → 'none' (no retry)
 * - Steps with onError 'retry' → 'exponential' (default retry behavior)
 * - Steps with onError 'fallback' → 'fixed' (quick retries before switching)
 *
 * @param step - The install step
 * @param overrideStrategy - Explicit strategy override (takes precedence)
 * @returns The retry strategy to use
 */
export function selectRetryStrategy(
  step: InstallStep,
  overrideStrategy?: RetryStrategy,
): RetryStrategy {
  if (overrideStrategy && overrideStrategy !== 'exponential') {
    return overrideStrategy;
  }

  switch (step.onError) {
    case 'abort':
    case 'skip':
      return 'none';
    case 'retry':
      return overrideStrategy ?? 'exponential';
    case 'fallback':
      return overrideStrategy ?? 'fixed';
    default:
      return overrideStrategy ?? 'exponential';
  }
}

// ============================================================================
// Delay calculation
// ============================================================================

/**
 * Calculate the delay before the next retry attempt.
 *
 * @param attempt - The retry attempt number (0-based, where 0 is the first retry)
 * @param options - Step retry options
 * @param randomValue - Random value for jitter (0-1), defaults to Math.random()
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(
  attempt: number,
  options: StepRetryOptions,
  randomValue?: number,
): number {
  const rand = randomValue ?? Math.random();

  switch (options.strategy) {
    case 'none':
      return 0;

    case 'immediate':
      return 0;

    case 'fixed': {
      // Fixed delay with optional jitter
      const jitter = options.initialDelayMs * options.jitterFactor * (rand * 2 - 1);
      const delay = options.initialDelayMs + jitter;
      return Math.min(Math.max(delay, 0), options.maxDelayMs);
    }

    case 'exponential': {
      // Exponential backoff: initialDelay * multiplier^attempt
      const exponentialDelay =
        options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt);
      // Add jitter to prevent thundering herd
      const jitter = exponentialDelay * options.jitterFactor * (rand * 2 - 1);
      const delay = exponentialDelay + jitter;
      return Math.min(Math.max(delay, 0), options.maxDelayMs);
    }

    default:
      return 0;
  }
}

// ============================================================================
// Retry eligibility
// ============================================================================

/**
 * Determine whether a step should be retried based on its configuration
 * and the execution result.
 *
 * A step is retryable when:
 * 1. Its onError strategy is 'retry' or 'fallback'
 * 2. The command failed (non-zero exit code or timeout)
 *
 * @param step - The install step
 * @param result - The execution result
 * @returns Whether the step should be retried
 */
export function shouldRetry(step: InstallStep, result: ExecResult): boolean {
  // Command succeeded — no retry needed
  if (result.exitCode === 0 && !result.timedOut) {
    // But if expectedOutput exists, check it
    if (step.expectedOutput && !result.stdout.includes(step.expectedOutput)) {
      // Output mismatch counts as a failure
      return step.onError === 'retry' || step.onError === 'fallback';
    }
    return false;
  }

  return step.onError === 'retry' || step.onError === 'fallback';
}

/**
 * Determine whether a specific execution result is considered successful.
 *
 * @param result - The execution result
 * @param step - The install step
 * @returns Whether the result is successful
 */
export function isStepSuccess(result: ExecResult, step: InstallStep): boolean {
  if (result.timedOut) return false;
  if (result.exitCode !== 0) return false;
  if (step.expectedOutput && !result.stdout.includes(step.expectedOutput)) {
    return false;
  }
  return true;
}

// ============================================================================
// Core: executeWithRetry
// ============================================================================

/**
 * Execute an installation step with automatic retry on failure.
 *
 * The step's command is executed, and if it fails, it is retried up to
 * `maxRetries` times with delays determined by the selected retry strategy.
 * Each attempt is recorded for diagnostics.
 *
 * @param step - The install step to execute
 * @param runner - Function that executes a command string
 * @param options - Partial retry options (merged with defaults)
 * @param sleep - Sleep function (injectable for testing)
 * @returns The retry result with all attempt details
 *
 * @example
 * ```ts
 * const result = await executeWithRetry(
 *   installStep,
 *   (cmd) => executor.execute(cmd),
 *   { maxRetries: 3, strategy: 'exponential' },
 * );
 *
 * if (result.success) {
 *   console.log('Step succeeded after', result.totalAttempts, 'attempt(s)');
 * }
 * ```
 */
export async function executeWithRetry(
  step: InstallStep,
  runner: CommandRunner,
  options?: Partial<StepRetryOptions>,
  sleep: SleepFn = defaultSleep,
): Promise<StepRetryResult> {
  const opts: StepRetryOptions = { ...DEFAULT_STEP_RETRY_OPTIONS, ...options };

  // Determine effective strategy — pass only the user-provided strategy
  // (not the merged default) so selectRetryStrategy can choose based on step.onError
  const strategy = selectRetryStrategy(step, options?.strategy);
  opts.strategy = strategy;

  // If strategy is 'none', only run once
  const effectiveMaxRetries = strategy === 'none' ? 0 : opts.maxRetries;

  const attempts: RetryAttempt[] = [];
  const startTime = Date.now();

  for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
    // Calculate delay (no delay before the first attempt)
    const delayMs = attempt === 0 ? 0 : calculateRetryDelay(attempt - 1, opts);

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    const result = await runner(step.command);

    attempts.push({
      attemptNumber: attempt,
      command: step.command,
      result,
      delayMs,
      timestamp: Date.now(),
    });

    if (isStepSuccess(result, step)) {
      return {
        stepId: step.id,
        success: true,
        totalAttempts: attempt + 1,
        attempts,
        elapsedMs: Date.now() - startTime,
        finalResult: result,
        strategyUsed: strategy,
      };
    }

    // Check if more retries are possible
    if (attempt < effectiveMaxRetries && !shouldRetry(step, result)) {
      // Not eligible for retry (e.g., step.onError changed)
      break;
    }
  }

  // All attempts failed
  const lastAttempt = attempts[attempts.length - 1];
  return {
    stepId: step.id,
    success: false,
    totalAttempts: attempts.length,
    attempts,
    elapsedMs: Date.now() - startTime,
    finalResult: lastAttempt.result,
    strategyUsed: strategy,
  };
}

// ============================================================================
// Utility: summarizeRetryResult
// ============================================================================

/**
 * Generate a human-readable summary of a step retry result.
 *
 * @param result - The step retry result
 * @returns A summary string
 */
export function summarizeRetryResult(result: StepRetryResult): string {
  if (result.success) {
    if (result.totalAttempts === 1) {
      return `Step "${result.stepId}": succeeded on first attempt.`;
    }
    return (
      `Step "${result.stepId}": succeeded after ${result.totalAttempts} attempt(s) ` +
      `(strategy: ${result.strategyUsed}, elapsed: ${result.elapsedMs}ms).`
    );
  }

  return (
    `Step "${result.stepId}": failed after ${result.totalAttempts} attempt(s) ` +
    `(strategy: ${result.strategyUsed}, elapsed: ${result.elapsedMs}ms). ` +
    `Last error: exit code ${result.finalResult.exitCode}, ` +
    `stderr: ${result.finalResult.stderr.slice(0, 200) || '(empty)'}.`
  );
}

/**
 * Extract error details from all failed retry attempts.
 *
 * @param result - The step retry result
 * @returns Array of error details for each failed attempt
 */
export function getRetryErrors(
  result: StepRetryResult,
): Array<{ attemptNumber: number; exitCode: number; stderr: string; timedOut: boolean }> {
  return result.attempts
    .filter((a) => a.result.exitCode !== 0 || a.result.timedOut)
    .map((a) => ({
      attemptNumber: a.attemptNumber,
      exitCode: a.result.exitCode,
      stderr: a.result.stderr,
      timedOut: a.result.timedOut,
    }));
}
