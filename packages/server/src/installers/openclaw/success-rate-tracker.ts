/**
 * Solution success rate tracking module.
 *
 * Records the outcome (success/failure) of each solution or alternative
 * command attempt and calculates aggregate success rates. These rates can
 * be used to dynamically adjust confidence scores, improving the ordering
 * of alternatives and solution suggestions over time.
 *
 * Works with:
 * - auto-switch.ts: consumes SwitchResult to record outcomes
 * - common-errors.ts: can adjust Solution.confidence based on historical data
 * - alternative-commands.ts: can adjust AlternativeCommand.confidence
 *
 * @module installers/openclaw/success-rate-tracker
 */

import type { SwitchResult } from './auto-switch.js';

// ============================================================================
// Types
// ============================================================================

/** A single recorded outcome of applying a solution or alternative command. */
export interface SolutionOutcome {
  /** The solution or alternative command ID */
  solutionId: string;
  /** The install step where this was applied */
  stepId: string;
  /** Whether the solution succeeded */
  success: boolean;
  /** Timestamp when the outcome was recorded */
  timestamp: number;
  /** Execution duration in milliseconds (if available) */
  durationMs?: number;
  /** Error message if failed */
  errorMessage?: string;
}

/** Aggregated success rate statistics for a single solution. */
export interface SuccessRateStats {
  /** The solution or alternative command ID */
  solutionId: string;
  /** Total number of times this solution was attempted */
  totalAttempts: number;
  /** Number of successful attempts */
  successCount: number;
  /** Number of failed attempts */
  failureCount: number;
  /** Success rate as a ratio (0.0 - 1.0) */
  successRate: number;
  /** Average duration of successful attempts (ms), or null if no successes */
  avgSuccessDurationMs: number | null;
  /** Timestamp of the most recent attempt */
  lastAttemptAt: number;
}

/** Serializable snapshot of all tracked data, for persistence. */
export interface TrackerSnapshot {
  /** All recorded outcomes */
  outcomes: SolutionOutcome[];
  /** Snapshot creation timestamp */
  exportedAt: number;
}

/** Options for adjusting confidence based on historical success rates. */
export interface ConfidenceAdjustOptions {
  /** Minimum number of attempts required before adjusting (default: 3) */
  minAttempts?: number;
  /** Weight of historical data vs original confidence (0-1, default: 0.5) */
  historyWeight?: number;
}

// ============================================================================
// SuccessRateTracker class
// ============================================================================

/**
 * Tracks solution outcomes and calculates success rates.
 *
 * Maintains an in-memory log of all solution/alternative attempt outcomes.
 * Provides methods to query success rates and adjust confidence scores
 * based on historical data.
 */
export class SuccessRateTracker {
  private outcomes: SolutionOutcome[] = [];

  // --------------------------------------------------------------------------
  // Recording outcomes
  // --------------------------------------------------------------------------

  /**
   * Record a single solution outcome.
   *
   * @param outcome - The outcome to record
   */
  recordOutcome(outcome: SolutionOutcome): void {
    this.outcomes.push({ ...outcome });
  }

  /**
   * Record outcomes from a SwitchResult (auto-switch execution).
   *
   * Extracts each attempt from the switch result and records it as an
   * outcome. The primary command is recorded with solutionId "primary".
   *
   * @param switchResult - The result from executeWithAutoSwitch
   */
  recordSwitchResult(switchResult: SwitchResult): void {
    for (const attempt of switchResult.attempts) {
      const solutionId = attempt.alternativeId ?? 'primary';
      this.recordOutcome({
        solutionId,
        stepId: switchResult.stepId,
        success: attempt.type === 'primary'
          ? switchResult.success && switchResult.successAlternativeId === null
          : switchResult.successAlternativeId === attempt.alternativeId,
        timestamp: attempt.timestamp,
        durationMs: attempt.result.duration,
        errorMessage: attempt.result.exitCode !== 0 ? attempt.result.stderr : undefined,
      });
    }
  }

  // --------------------------------------------------------------------------
  // Querying
  // --------------------------------------------------------------------------

  /**
   * Get all recorded outcomes.
   *
   * @returns A copy of the outcomes array
   */
  getOutcomes(): SolutionOutcome[] {
    return [...this.outcomes];
  }

  /**
   * Get the number of recorded outcomes.
   */
  getOutcomeCount(): number {
    return this.outcomes.length;
  }

  /**
   * Get aggregated success rate statistics for a specific solution.
   *
   * @param solutionId - The solution or alternative command ID
   * @returns Statistics, or null if no outcomes exist for this solution
   */
  getStats(solutionId: string): SuccessRateStats | null {
    const relevant = this.outcomes.filter((o) => o.solutionId === solutionId);
    if (relevant.length === 0) return null;

    const successCount = relevant.filter((o) => o.success).length;
    const failureCount = relevant.length - successCount;

    const successDurations = relevant
      .filter((o) => o.success && o.durationMs !== undefined)
      .map((o) => o.durationMs!);

    const avgSuccessDurationMs = successDurations.length > 0
      ? successDurations.reduce((sum, d) => sum + d, 0) / successDurations.length
      : null;

    const lastAttemptAt = Math.max(...relevant.map((o) => o.timestamp));

    return {
      solutionId,
      totalAttempts: relevant.length,
      successCount,
      failureCount,
      successRate: successCount / relevant.length,
      avgSuccessDurationMs,
      lastAttemptAt,
    };
  }

  /**
   * Get success rate statistics for all tracked solutions.
   *
   * @returns Array of stats, sorted by success rate descending
   */
  getAllStats(): SuccessRateStats[] {
    const solutionIds = new Set(this.outcomes.map((o) => o.solutionId));
    const stats: SuccessRateStats[] = [];

    for (const id of solutionIds) {
      const s = this.getStats(id);
      if (s) stats.push(s);
    }

    return stats.sort((a, b) => b.successRate - a.successRate);
  }

  /**
   * Get success rate statistics filtered by step ID.
   *
   * @param stepId - The install step to filter by
   * @returns Array of stats for solutions used on this step
   */
  getStatsByStep(stepId: string): SuccessRateStats[] {
    const relevantOutcomes = this.outcomes.filter((o) => o.stepId === stepId);
    const solutionIds = new Set(relevantOutcomes.map((o) => o.solutionId));
    const stats: SuccessRateStats[] = [];

    for (const id of solutionIds) {
      const relevant = relevantOutcomes.filter((o) => o.solutionId === id);
      const successCount = relevant.filter((o) => o.success).length;

      const successDurations = relevant
        .filter((o) => o.success && o.durationMs !== undefined)
        .map((o) => o.durationMs!);

      const avgSuccessDurationMs = successDurations.length > 0
        ? successDurations.reduce((sum, d) => sum + d, 0) / successDurations.length
        : null;

      stats.push({
        solutionId: id,
        totalAttempts: relevant.length,
        successCount,
        failureCount: relevant.length - successCount,
        successRate: successCount / relevant.length,
        avgSuccessDurationMs,
        lastAttemptAt: Math.max(...relevant.map((o) => o.timestamp)),
      });
    }

    return stats.sort((a, b) => b.successRate - a.successRate);
  }

  // --------------------------------------------------------------------------
  // Confidence adjustment
  // --------------------------------------------------------------------------

  /**
   * Calculate an adjusted confidence score for a solution based on
   * historical success rate data.
   *
   * Uses a weighted average of the original confidence and the historical
   * success rate. If there are not enough data points (below minAttempts),
   * returns the original confidence unchanged.
   *
   * @param solutionId - The solution or alternative command ID
   * @param originalConfidence - The original (static) confidence score
   * @param options - Adjustment options
   * @returns The adjusted confidence score (0.0 - 1.0)
   */
  adjustConfidence(
    solutionId: string,
    originalConfidence: number,
    options: ConfidenceAdjustOptions = {},
  ): number {
    const { minAttempts = 3, historyWeight = 0.5 } = options;

    const stats = this.getStats(solutionId);
    if (!stats || stats.totalAttempts < minAttempts) {
      return originalConfidence;
    }

    const adjusted =
      originalConfidence * (1 - historyWeight) +
      stats.successRate * historyWeight;

    return Math.max(0, Math.min(1, adjusted));
  }

  // --------------------------------------------------------------------------
  // Persistence (snapshot export/import)
  // --------------------------------------------------------------------------

  /**
   * Export all tracked data as a serializable snapshot.
   *
   * @returns A TrackerSnapshot that can be persisted to disk
   */
  exportSnapshot(): TrackerSnapshot {
    return {
      outcomes: [...this.outcomes],
      exportedAt: Date.now(),
    };
  }

  /**
   * Import outcomes from a previously exported snapshot.
   *
   * Merges with any existing outcomes (does not clear).
   *
   * @param snapshot - The snapshot to import
   */
  importSnapshot(snapshot: TrackerSnapshot): void {
    this.outcomes.push(...snapshot.outcomes);
  }

  /**
   * Clear all recorded outcomes.
   */
  clear(): void {
    this.outcomes = [];
  }
}

// ============================================================================
// Module-level convenience functions
// ============================================================================

/**
 * Format a SuccessRateStats object as a human-readable summary string.
 *
 * @param stats - The stats to format
 * @returns Formatted summary
 */
export function formatSuccessRate(stats: SuccessRateStats): string {
  const pct = (stats.successRate * 100).toFixed(1);
  const duration = stats.avgSuccessDurationMs !== null
    ? ` (avg ${Math.round(stats.avgSuccessDurationMs)}ms)`
    : '';
  return (
    `Solution "${stats.solutionId}": ${pct}% success rate ` +
    `(${stats.successCount}/${stats.totalAttempts})${duration}`
  );
}

/**
 * Rank solution IDs by their success rate (best first).
 *
 * Solutions with no historical data are placed at the end,
 * preserving their original order.
 *
 * @param solutionIds - The solution IDs to rank
 * @param tracker - The tracker with historical data
 * @returns Sorted solution IDs (best success rate first)
 */
export function rankBySuccessRate(
  solutionIds: string[],
  tracker: SuccessRateTracker,
): string[] {
  const withStats: Array<{ id: string; rate: number; hasData: boolean }> = [];

  for (const id of solutionIds) {
    const stats = tracker.getStats(id);
    withStats.push({
      id,
      rate: stats ? stats.successRate : -1,
      hasData: stats !== null,
    });
  }

  return withStats
    .sort((a, b) => {
      // Solutions with data come first, sorted by rate descending
      if (a.hasData && !b.hasData) return -1;
      if (!a.hasData && b.hasData) return 1;
      if (a.hasData && b.hasData) return b.rate - a.rate;
      return 0; // Both no data → preserve original order
    })
    .map((s) => s.id);
}
