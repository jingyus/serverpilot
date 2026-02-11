// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Automatic alternative command switching module.
 *
 * When a step's primary command fails, this module orchestrates trying
 * alternative commands in order of confidence. It tracks attempt history
 * and produces a final result indicating success/failure and which
 * command was used.
 *
 * Works with:
 * - alternative-commands.ts: provides the ordered alternatives
 * - common-errors.ts: identifies known errors to inform switching
 *
 * @module installers/openclaw/auto-switch
 */

import type { EnvironmentInfo, InstallStep } from '@aiinstaller/shared';
import type { ExecResult } from '@aiinstaller/shared';

import {
  generateAlternatives,
  type AlternativeCommand,
  type StepAlternatives,
} from './alternative-commands.js';
import { matchCommonErrorsForStep } from './common-errors.js';

// ============================================================================
// Types
// ============================================================================

/** A single execution attempt record. */
export interface SwitchAttempt {
  /** The command that was executed */
  command: string;
  /** Whether this was the primary command or an alternative */
  type: 'primary' | 'alternative';
  /** Alternative ID (null for primary command) */
  alternativeId: string | null;
  /** Execution result */
  result: ExecResult;
  /** Timestamp when the attempt started */
  timestamp: number;
}

/** Final result of the auto-switch process for a single step. */
export interface SwitchResult {
  /** The step ID */
  stepId: string;
  /** Whether any command succeeded */
  success: boolean;
  /** The command that ultimately succeeded (null if all failed) */
  successCommand: string | null;
  /** The successful alternative ID (null if primary succeeded or all failed) */
  successAlternativeId: string | null;
  /** All attempts made, in order */
  attempts: SwitchAttempt[];
  /** Total number of attempts */
  totalAttempts: number;
}

/** Configuration options for auto-switching behavior. */
export interface AutoSwitchOptions {
  /** Maximum number of alternatives to try (default: 3) */
  maxAlternatives?: number;
  /** Minimum confidence threshold for alternatives (default: 0.3) */
  minConfidence?: number;
  /** Whether to skip alternatives that require sudo (default: false) */
  skipSudo?: boolean;
  /** Custom function to check if a result counts as success */
  isSuccess?: (result: ExecResult, step: InstallStep) => boolean;
}

/**
 * Function signature for executing a command.
 * Allows injecting the executor for testability.
 */
export type CommandRunner = (command: string) => Promise<ExecResult>;

// ============================================================================
// Default success checker
// ============================================================================

/**
 * Default logic to determine whether a command execution was successful.
 *
 * A command is considered successful if:
 * 1. Exit code is 0
 * 2. It didn't time out
 * 3. If the step has expectedOutput, stdout must contain it
 */
export function defaultIsSuccess(result: ExecResult, step: InstallStep): boolean {
  if (result.timedOut) return false;
  if (result.exitCode !== 0) return false;
  if (step.expectedOutput && !result.stdout.includes(step.expectedOutput)) {
    return false;
  }
  return true;
}

// ============================================================================
// Core: selectNextAlternative
// ============================================================================

/**
 * Select the next alternative to try based on attempt history.
 *
 * Filters out already-tried alternatives and returns the best remaining
 * one (highest confidence above the minimum threshold).
 *
 * @param stepAlternatives - Available alternatives for the step
 * @param attemptedIds - Set of alternative IDs already attempted
 * @param options - Auto-switch configuration
 * @returns The next alternative to try, or null if none remain
 */
export function selectNextAlternative(
  stepAlternatives: StepAlternatives,
  attemptedIds: Set<string>,
  options: AutoSwitchOptions = {},
): AlternativeCommand | null {
  const { minConfidence = 0.3, skipSudo = false } = options;

  for (const alt of stepAlternatives.alternatives) {
    if (attemptedIds.has(alt.id)) continue;
    if (alt.confidence < minConfidence) continue;
    if (skipSudo && alt.requiresSudo) continue;
    return alt;
  }

  return null;
}

// ============================================================================
// Core: executeWithAutoSwitch
// ============================================================================

/**
 * Execute a step with automatic switching to alternatives on failure.
 *
 * 1. Runs the primary command
 * 2. If it fails, generates alternatives for the step
 * 3. Tries alternatives in confidence order until one succeeds or
 *    the maximum number of attempts is reached
 *
 * @param step - The install step to execute
 * @param env - Target environment info
 * @param runner - Function that executes a command string
 * @param options - Auto-switch configuration
 * @returns The switch result with all attempt details
 */
export async function executeWithAutoSwitch(
  step: InstallStep,
  env: EnvironmentInfo,
  runner: CommandRunner,
  options: AutoSwitchOptions = {},
): Promise<SwitchResult> {
  const {
    maxAlternatives = 3,
    isSuccess = defaultIsSuccess,
  } = options;

  const attempts: SwitchAttempt[] = [];
  const attemptedIds = new Set<string>();

  // --- Try primary command ---
  const primaryResult = await runner(step.command);
  attempts.push({
    command: step.command,
    type: 'primary',
    alternativeId: null,
    result: primaryResult,
    timestamp: Date.now(),
  });

  if (isSuccess(primaryResult, step)) {
    return buildResult(step.id, true, step.command, null, attempts);
  }

  // --- Primary failed, check onError strategy ---
  if (step.onError === 'abort') {
    return buildResult(step.id, false, null, null, attempts);
  }
  if (step.onError === 'skip') {
    return buildResult(step.id, false, null, null, attempts);
  }

  // --- Generate alternatives ---
  const stepAlternatives = generateAlternatives(step, env);
  let alternativesTried = 0;

  // --- Try alternatives in order ---
  while (alternativesTried < maxAlternatives) {
    const next = selectNextAlternative(stepAlternatives, attemptedIds, options);
    if (!next) break;

    attemptedIds.add(next.id);
    alternativesTried++;

    const altResult = await runner(next.command);
    attempts.push({
      command: next.command,
      type: 'alternative',
      alternativeId: next.id,
      result: altResult,
      timestamp: Date.now(),
    });

    if (isSuccess(altResult, step)) {
      return buildResult(step.id, true, next.command, next.id, attempts);
    }
  }

  // --- All attempts failed ---
  return buildResult(step.id, false, null, null, attempts);
}

// ============================================================================
// Core: shouldSwitch
// ============================================================================

/**
 * Determine whether the auto-switch mechanism should activate for a step
 * based on its error handling strategy and the execution result.
 *
 * Auto-switch activates when:
 * - The step's onError is 'retry' or 'fallback'
 * - The command failed (non-zero exit code or timeout)
 *
 * @param step - The install step
 * @param result - The execution result of the primary command
 * @returns Whether auto-switch should activate
 */
export function shouldSwitch(step: InstallStep, result: ExecResult): boolean {
  if (result.exitCode === 0 && !result.timedOut) return false;
  return step.onError === 'retry' || step.onError === 'fallback';
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a SwitchResult from the given parameters.
 */
function buildResult(
  stepId: string,
  success: boolean,
  successCommand: string | null,
  successAlternativeId: string | null,
  attempts: SwitchAttempt[],
): SwitchResult {
  return {
    stepId,
    success,
    successCommand,
    successAlternativeId,
    attempts,
    totalAttempts: attempts.length,
  };
}

// ============================================================================
// Utility: summarizeSwitchResult
// ============================================================================

/**
 * Produce a human-readable summary of a switch result.
 *
 * Useful for logging and user-facing messages.
 *
 * @param result - The switch result to summarize
 * @returns A summary string
 */
export function summarizeSwitchResult(result: SwitchResult): string {
  if (result.success) {
    if (result.successAlternativeId) {
      return (
        `Step "${result.stepId}": primary command failed, ` +
        `switched to alternative "${result.successAlternativeId}" ` +
        `(command: ${result.successCommand}) after ${result.totalAttempts} attempt(s).`
      );
    }
    return `Step "${result.stepId}": primary command succeeded on first attempt.`;
  }

  return (
    `Step "${result.stepId}": all ${result.totalAttempts} attempt(s) failed. ` +
    `No working command found.`
  );
}

// ============================================================================
// Utility: getFailedAttemptErrors
// ============================================================================

/**
 * Extract error information from all failed attempts in a switch result.
 *
 * Useful for error reporting and diagnostics.
 *
 * @param result - The switch result
 * @returns Array of { command, stderr, exitCode } for each failed attempt
 */
export function getFailedAttemptErrors(
  result: SwitchResult,
): Array<{ command: string; stderr: string; exitCode: number }> {
  return result.attempts
    .filter((a) => a.result.exitCode !== 0 || a.result.timedOut)
    .map((a) => ({
      command: a.command,
      stderr: a.result.stderr,
      exitCode: a.result.exitCode,
    }));
}
