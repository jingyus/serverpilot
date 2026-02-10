/**
 * Step merging optimization for OpenClaw installation.
 *
 * Analyzes a list of installation steps and merges consecutive steps
 * that can safely be combined into a single step. This reduces the
 * number of round-trips between server and client, improving installation
 * speed while maintaining safety guarantees.
 *
 * Merge rules:
 * - Only steps with compatible error handling strategies can merge.
 * - Steps requiring user input are never merged.
 * - Steps with `expectedOutput` validation are never merged (they need
 *   individual result inspection).
 * - Merged steps combine commands with `&&` (fail-fast chaining).
 * - The merged step's timeout is the sum of individual timeouts.
 * - A merged step can roll back only if ALL original steps can roll back.
 *
 * @module installers/openclaw/step-merger
 */

import type { InstallStep } from '@aiinstaller/shared';

// ============================================================================
// Types
// ============================================================================

/** Describes a single merge that was performed. */
export interface MergeDecision {
  /** IDs of the original steps that were merged */
  mergedStepIds: string[];
  /** The resulting merged step */
  mergedStep: InstallStep;
  /** Human-readable reason for the merge */
  reason: string;
}

/** Result of the merge evaluation process. */
export interface MergeEvaluation {
  /** Per-merge decisions (one per group of merged steps) */
  decisions: MergeDecision[];
  /** The optimized step list after merging */
  optimizedSteps: InstallStep[];
  /** Steps that were left unchanged (not part of any merge) */
  unchangedSteps: InstallStep[];
  /** Summary message */
  summary: string;
}

// ============================================================================
// Merge eligibility
// ============================================================================

/** Step IDs that require user interaction and must never be merged. */
const INTERACTIVE_STEP_IDS = new Set([
  'configure-openclaw',
]);

/**
 * Determine whether a step is eligible for merging with adjacent steps.
 *
 * A step is ineligible if:
 * - It has `expectedOutput` (needs individual result validation)
 * - It is interactive (requires user input)
 * - Its error strategy is 'abort' (too critical to combine)
 *
 * @param step - The install step to evaluate
 * @returns `true` if the step can participate in a merge
 */
export function isMergeable(step: InstallStep): boolean {
  // Steps with expected output need individual validation
  if (step.expectedOutput) {
    return false;
  }

  // Interactive steps must run individually
  if (INTERACTIVE_STEP_IDS.has(step.id)) {
    return false;
  }

  // Abort-on-error steps are too critical to merge
  if (step.onError === 'abort') {
    return false;
  }

  return true;
}

/**
 * Determine whether two adjacent steps can be merged together.
 *
 * Both steps must be individually mergeable, and they must share
 * a compatible error handling strategy.
 *
 * @param a - First (earlier) step
 * @param b - Second (later) step
 * @returns `true` if a and b can be merged into one step
 */
export function canMerge(a: InstallStep, b: InstallStep): boolean {
  if (!isMergeable(a) || !isMergeable(b)) {
    return false;
  }

  // Both steps must have the same error strategy for predictable behavior
  if (a.onError !== b.onError) {
    return false;
  }

  return true;
}

// ============================================================================
// Merge execution
// ============================================================================

/**
 * Merge a group of consecutive steps into a single step.
 *
 * Commands are chained with `&&` for fail-fast semantics. The merged
 * step's properties are derived from the group:
 * - `id`: joined ids separated by `+`
 * - `description`: joined descriptions separated by ` → `
 * - `timeout`: sum of individual timeouts
 * - `canRollback`: true only if ALL steps can roll back
 * - `onError`: taken from the first step (all must match, per canMerge)
 *
 * @param steps - Array of 2+ consecutive steps to merge
 * @returns The merged step
 */
export function mergeSteps(steps: InstallStep[]): InstallStep {
  if (steps.length === 0) {
    throw new Error('Cannot merge an empty list of steps');
  }

  if (steps.length === 1) {
    return { ...steps[0] };
  }

  return {
    id: steps.map((s) => s.id).join('+'),
    description: steps.map((s) => s.description).join(' → '),
    command: steps.map((s) => s.command).join(' && '),
    timeout: steps.reduce((sum, s) => sum + s.timeout, 0),
    canRollback: steps.every((s) => s.canRollback),
    onError: steps[0].onError,
  };
}

// ============================================================================
// Group detection
// ============================================================================

/**
 * Identify groups of consecutive mergeable steps.
 *
 * Walks through the step list and accumulates runs of steps that
 * can be merged (per `canMerge`). Single-step runs are kept as-is.
 *
 * @param steps - Ordered list of install steps
 * @returns Array of step groups (each group is an array of steps)
 */
export function identifyMergeGroups(steps: readonly InstallStep[]): InstallStep[][] {
  if (steps.length === 0) {
    return [];
  }

  const groups: InstallStep[][] = [];
  let currentGroup: InstallStep[] = [steps[0]];

  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const curr = steps[i];

    if (canMerge(prev, curr)) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }

  // Push the final group
  groups.push(currentGroup);

  return groups;
}

// ============================================================================
// Main evaluation
// ============================================================================

/**
 * Evaluate a list of steps and produce a complete merge evaluation.
 *
 * This is the main entry point. It identifies groups of mergeable steps,
 * merges them, and returns an evaluation containing the optimized step
 * list, merge decisions, and a summary.
 *
 * @param steps - Ordered list of install steps to optimize
 * @returns Complete merge evaluation
 */
export function evaluateMerges(steps: readonly InstallStep[]): MergeEvaluation {
  const groups = identifyMergeGroups(steps);

  const decisions: MergeDecision[] = [];
  const optimizedSteps: InstallStep[] = [];
  const unchangedSteps: InstallStep[] = [];

  for (const group of groups) {
    if (group.length > 1) {
      // This group can be merged
      const merged = mergeSteps(group);
      decisions.push({
        mergedStepIds: group.map((s) => s.id),
        mergedStep: merged,
        reason: `Steps share compatible error strategy "${group[0].onError}" and have no output validation or interactivity`,
      });
      optimizedSteps.push(merged);
    } else {
      // Single step — keep as-is
      optimizedSteps.push(group[0]);
      unchangedSteps.push(group[0]);
    }
  }

  const originalCount = steps.length;
  const optimizedCount = optimizedSteps.length;
  const mergedCount = decisions.length;
  let summary: string;

  if (mergedCount === 0) {
    summary = `No steps were merged — all ${originalCount} steps must execute individually`;
  } else {
    const savedSteps = originalCount - optimizedCount;
    summary = `Merged ${savedSteps} steps into ${mergedCount} combined step(s), reducing ${originalCount} steps to ${optimizedCount}`;
  }

  return {
    decisions,
    optimizedSteps,
    unchangedSteps,
    summary,
  };
}

/**
 * Apply step merging optimization to a list of steps.
 *
 * Convenience wrapper that returns only the optimized step list.
 *
 * @param steps - Ordered list of install steps
 * @returns Optimized array of steps with eligible steps merged
 */
export function optimizeSteps(steps: readonly InstallStep[]): InstallStep[] {
  const evaluation = evaluateMerges(steps);
  return evaluation.optimizedSteps;
}
