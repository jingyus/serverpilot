// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Dynamic step timeout adjustment module.
 *
 * Adjusts step timeouts based on historical execution data, environment
 * factors, and error patterns.  When no history exists, falls back to
 * the static timeout defined in the step.
 *
 * @module installers/openclaw/timeout-adjuster
 */

import type { InstallStep, EnvironmentInfo, StepResult } from '@aiinstaller/shared';

import { QUICK_TIMEOUT, INSTALL_TIMEOUT, HEAVY_INSTALL_TIMEOUT } from './steps.js';

// ============================================================================
// Types
// ============================================================================

/** A single recorded execution for a step. */
export interface ExecutionRecord {
  /** Step id this record belongs to. */
  stepId: string;
  /** Actual duration in ms. */
  duration: number;
  /** Whether the execution succeeded. */
  success: boolean;
  /** Whether the execution timed out. */
  timedOut: boolean;
  /** Timestamp when the execution happened. */
  timestamp: number;
}

/** Configuration for the timeout adjuster. */
export interface TimeoutAdjusterConfig {
  /** Minimum timeout in ms (never go below this). Default: 10_000 */
  minTimeout: number;
  /** Maximum timeout in ms (never exceed this). Default: 600_000 */
  maxTimeout: number;
  /** Multiplier applied when a previous execution timed out. Default: 2.0 */
  timeoutMultiplier: number;
  /** Number of standard deviations above mean for the safety margin. Default: 2 */
  safetyMarginStdDevs: number;
  /** Minimum safety margin ratio over mean duration. Default: 1.5 */
  minSafetyRatio: number;
  /** Factor applied to timeout for slow network environments. Default: 1.5 */
  slowNetworkFactor: number;
  /** Maximum number of history records to keep per step. Default: 20 */
  maxHistoryPerStep: number;
  /** Weight decay factor for older records (0-1). 1 = no decay. Default: 0.8 */
  decayFactor: number;
}

/** Result of a timeout adjustment decision. */
export interface TimeoutAdjustment {
  /** The step id. */
  stepId: string;
  /** The original (static) timeout. */
  originalTimeout: number;
  /** The adjusted timeout. */
  adjustedTimeout: number;
  /** Reason for the adjustment. */
  reason: string;
  /** Confidence in the adjustment (0-1). Higher = more data. */
  confidence: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default configuration values. */
export const DEFAULT_CONFIG: TimeoutAdjusterConfig = {
  minTimeout: 10_000,
  maxTimeout: 600_000,
  timeoutMultiplier: 2.0,
  safetyMarginStdDevs: 2,
  minSafetyRatio: 1.5,
  slowNetworkFactor: 1.5,
  maxHistoryPerStep: 20,
  decayFactor: 0.8,
};

/** Step categories for determining base timeout behavior. */
export type StepCategory = 'quick' | 'install' | 'heavy';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Categorize a step based on its original timeout.
 */
export function categorizeStep(step: InstallStep): StepCategory {
  if (step.timeout <= QUICK_TIMEOUT) return 'quick';
  if (step.timeout <= INSTALL_TIMEOUT) return 'install';
  return 'heavy';
}

/**
 * Compute the arithmetic mean of an array of numbers.
 * Returns 0 for empty arrays.
 */
export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Compute the population standard deviation of an array of numbers.
 * Returns 0 for arrays with fewer than 2 elements.
 */
export function stddev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const sumSquares = values.reduce((sum, v) => sum + (v - avg) ** 2, 0);
  return Math.sqrt(sumSquares / values.length);
}

/**
 * Apply exponential decay weights to values (most recent = highest weight).
 * Records are assumed to be sorted oldest-first.
 */
export function weightedMean(values: readonly number[], decayFactor: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0]!;

  let weightSum = 0;
  let weightedSum = 0;
  for (let i = 0; i < values.length; i++) {
    const weight = Math.pow(decayFactor, values.length - 1 - i);
    weightedSum += values[i]! * weight;
    weightSum += weight;
  }
  return weightedSum / weightSum;
}

/**
 * Determine an environment-based adjustment factor.
 *
 * - Slow or unavailable network → increase timeouts for install steps.
 * - Windows platform → slight increase.
 */
export function environmentFactor(env: EnvironmentInfo | undefined, step: InstallStep): number {
  if (!env) return 1.0;

  let factor = 1.0;
  const category = categorizeStep(step);

  // Network issues affect install/heavy steps
  if (category !== 'quick') {
    if (!env.network.canAccessNpm) {
      factor *= 2.0; // npm unreachable → likely very slow
    } else if (!env.network.canAccessGithub) {
      factor *= 1.3; // partial network issues
    }
  }

  // Windows generally slower for CLI operations
  if (env.os.platform === 'win32') {
    factor *= 1.2;
  }

  return factor;
}

// ============================================================================
// TimeoutAdjuster class
// ============================================================================

/**
 * Manages dynamic step timeout adjustment based on execution history
 * and environment context.
 *
 * @example
 * ```ts
 * const adjuster = new TimeoutAdjuster();
 * adjuster.recordExecution({ stepId: 'install-pnpm', duration: 8000, success: true, timedOut: false, timestamp: Date.now() });
 * const adjusted = adjuster.adjustTimeout(step, env);
 * // adjusted.adjustedTimeout is based on historical data
 * ```
 */
export class TimeoutAdjuster {
  private readonly config: TimeoutAdjusterConfig;
  private readonly history: Map<string, ExecutionRecord[]>;

  constructor(config: Partial<TimeoutAdjusterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.history = new Map();
  }

  /**
   * Record an execution result for future timeout adjustments.
   */
  recordExecution(record: ExecutionRecord): void {
    const records = this.history.get(record.stepId) ?? [];
    records.push(record);

    // Trim to maxHistoryPerStep (keep most recent)
    if (records.length > this.config.maxHistoryPerStep) {
      records.splice(0, records.length - this.config.maxHistoryPerStep);
    }

    this.history.set(record.stepId, records);
  }

  /**
   * Record a step result (convenience wrapper around recordExecution).
   */
  recordStepResult(result: StepResult, timedOut: boolean = false): void {
    this.recordExecution({
      stepId: result.stepId,
      duration: result.duration,
      success: result.success,
      timedOut,
      timestamp: Date.now(),
    });
  }

  /**
   * Get history records for a step.
   */
  getHistory(stepId: string): readonly ExecutionRecord[] {
    return this.history.get(stepId) ?? [];
  }

  /**
   * Clear all history records.
   */
  clearHistory(): void {
    this.history.clear();
  }

  /**
   * Adjust the timeout for a single step based on history and environment.
   */
  adjustTimeout(step: InstallStep, env?: EnvironmentInfo): TimeoutAdjustment {
    const records = this.history.get(step.id) ?? [];

    // No history → use environment-based adjustment only
    if (records.length === 0) {
      return this.adjustWithoutHistory(step, env);
    }

    return this.adjustWithHistory(step, records, env);
  }

  /**
   * Adjust timeouts for all steps in a plan.
   */
  adjustAllTimeouts(
    steps: readonly InstallStep[],
    env?: EnvironmentInfo,
  ): { steps: InstallStep[]; adjustments: TimeoutAdjustment[] } {
    const adjustments: TimeoutAdjustment[] = [];
    const adjustedSteps: InstallStep[] = [];

    for (const step of steps) {
      const adjustment = this.adjustTimeout(step, env);
      adjustments.push(adjustment);
      adjustedSteps.push({
        ...step,
        timeout: adjustment.adjustedTimeout,
      });
    }

    return { steps: adjustedSteps, adjustments };
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private adjustWithoutHistory(step: InstallStep, env?: EnvironmentInfo): TimeoutAdjustment {
    const envFactor = environmentFactor(env, step);
    const clamped = this.clamp(Math.round(step.timeout * envFactor));

    if (envFactor === 1.0) {
      return {
        stepId: step.id,
        originalTimeout: step.timeout,
        adjustedTimeout: clamped,
        reason: 'no history, using default timeout',
        confidence: 0,
      };
    }

    return {
      stepId: step.id,
      originalTimeout: step.timeout,
      adjustedTimeout: clamped,
      reason: `no history, environment factor ${envFactor.toFixed(2)}x applied`,
      confidence: 0.2,
    };
  }

  private adjustWithHistory(
    step: InstallStep,
    records: readonly ExecutionRecord[],
    env?: EnvironmentInfo,
  ): TimeoutAdjustment {
    // Check for recent timeouts → aggressively increase
    const recentTimeouts = records.filter((r) => r.timedOut);
    if (recentTimeouts.length > 0) {
      return this.adjustForTimeout(step, records, env);
    }

    // Use successful durations for statistical adjustment
    const successDurations = records.filter((r) => r.success && !r.timedOut).map((r) => r.duration);

    if (successDurations.length === 0) {
      // All failures, no timeouts → keep original with possible env adjustment
      return this.adjustWithoutHistory(step, env);
    }

    const wMean = weightedMean(successDurations, this.config.decayFactor);
    const sd = stddev(successDurations);
    const envFactor = environmentFactor(env, step);

    // Base adjusted timeout: weighted mean + safety margin
    let adjustedBase = wMean + this.config.safetyMarginStdDevs * sd;

    // Ensure at least minSafetyRatio × mean
    adjustedBase = Math.max(adjustedBase, wMean * this.config.minSafetyRatio);

    // Apply environment factor
    adjustedBase *= envFactor;

    const adjusted = this.clamp(Math.round(adjustedBase));

    // Confidence increases with more data points
    const confidence = Math.min(successDurations.length / 10, 1.0);

    const parts = [`based on ${successDurations.length} execution(s)`];
    parts.push(`mean=${Math.round(wMean)}ms`);
    if (sd > 0) parts.push(`stddev=${Math.round(sd)}ms`);
    if (envFactor !== 1.0) parts.push(`env=${envFactor.toFixed(2)}x`);

    return {
      stepId: step.id,
      originalTimeout: step.timeout,
      adjustedTimeout: adjusted,
      reason: parts.join(', '),
      confidence,
    };
  }

  private adjustForTimeout(
    step: InstallStep,
    records: readonly ExecutionRecord[],
    env?: EnvironmentInfo,
  ): TimeoutAdjustment {
    // Find the highest timeout that was hit
    const maxTimedOutDuration = Math.max(...records.filter((r) => r.timedOut).map((r) => r.duration));
    const envFactor = environmentFactor(env, step);

    // Use timeoutMultiplier on the highest recorded timeout
    const adjustedBase = maxTimedOutDuration * this.config.timeoutMultiplier * envFactor;
    const adjusted = this.clamp(Math.round(adjustedBase));

    const timeoutCount = records.filter((r) => r.timedOut).length;

    return {
      stepId: step.id,
      originalTimeout: step.timeout,
      adjustedTimeout: adjusted,
      reason: `${timeoutCount} timeout(s) detected, multiplied by ${this.config.timeoutMultiplier}x`,
      confidence: 0.8,
    };
  }

  private clamp(value: number): number {
    return Math.max(this.config.minTimeout, Math.min(value, this.config.maxTimeout));
  }
}

// ============================================================================
// Convenience functions
// ============================================================================

/**
 * Create a TimeoutAdjuster, seed it with execution records, and adjust
 * all steps in one call.
 *
 * @param steps - Steps to adjust
 * @param history - Historical execution records
 * @param env - Optional environment info
 * @param config - Optional adjuster configuration
 * @returns Adjusted steps and adjustment details
 */
export function adjustStepTimeouts(
  steps: readonly InstallStep[],
  history: readonly ExecutionRecord[],
  env?: EnvironmentInfo,
  config?: Partial<TimeoutAdjusterConfig>,
): { steps: InstallStep[]; adjustments: TimeoutAdjustment[] } {
  const adjuster = new TimeoutAdjuster(config);
  for (const record of history) {
    adjuster.recordExecution(record);
  }
  return adjuster.adjustAllTimeouts(steps, env);
}
