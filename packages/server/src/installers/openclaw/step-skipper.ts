/**
 * Step skip logic for OpenClaw installation.
 *
 * Evaluates each installation step against the current environment to
 * determine whether it can be safely skipped (e.g. the component is
 * already installed and meets the version requirement).
 *
 * Returns annotated skip decisions with human-readable reasons, so the
 * UI can inform the user why a step was omitted.
 *
 * @module installers/openclaw/step-skipper
 */

import type { EnvironmentInfo, InstallStep } from '@aiinstaller/shared';

import type { DetectResult } from './detect.js';

// ============================================================================
// Types
// ============================================================================

/** Decision about whether a single step should be skipped. */
export interface SkipDecision {
  /** The step id this decision applies to */
  stepId: string;
  /** Whether the step should be skipped */
  skip: boolean;
  /** Human-readable reason for the decision */
  reason: string;
}

/** Result of evaluating all steps for skipping. */
export interface SkipEvaluation {
  /** Per-step skip decisions */
  decisions: SkipDecision[];
  /** Steps that remain after removing skipped ones */
  remainingSteps: InstallStep[];
  /** Steps that were skipped */
  skippedSteps: InstallStep[];
  /** Summary message */
  summary: string;
}

// ============================================================================
// Individual skip evaluators
// ============================================================================

/**
 * Evaluate whether the check-node step can be skipped.
 *
 * The check-node step is skipped when Node.js is already detected at the
 * required version. Even when skipped, the plan still validates Node at
 * runtime through subsequent steps that depend on it.
 *
 * @param detectResult - Environment detection result
 * @returns Skip decision for check-node
 */
export function evaluateCheckNode(detectResult: DetectResult): SkipDecision {
  if (detectResult.checks.nodeVersion.passed) {
    return {
      stepId: 'check-node',
      skip: true,
      reason: `Node.js already meets the requirement: ${detectResult.checks.nodeVersion.message}`,
    };
  }

  return {
    stepId: 'check-node',
    skip: false,
    reason: `Node.js check needed: ${detectResult.checks.nodeVersion.message}`,
  };
}

/**
 * Evaluate whether the install-pnpm step can be skipped.
 *
 * @param detectResult - Environment detection result
 * @returns Skip decision for install-pnpm
 */
export function evaluateInstallPnpm(detectResult: DetectResult): SkipDecision {
  if (detectResult.checks.pnpm.passed) {
    return {
      stepId: 'install-pnpm',
      skip: true,
      reason: `pnpm already installed: ${detectResult.checks.pnpm.message}`,
    };
  }

  return {
    stepId: 'install-pnpm',
    skip: false,
    reason: `pnpm needs to be installed: ${detectResult.checks.pnpm.message}`,
  };
}

/**
 * Evaluate whether the install-openclaw step can be skipped.
 *
 * OpenClaw installation is skipped only when the environment already has
 * OpenClaw installed (detected via the `openclaw` key in packageManagers
 * or a dedicated detection field).
 *
 * @param _detectResult - Environment detection result
 * @param env - Raw environment info
 * @returns Skip decision for install-openclaw
 */
export function evaluateInstallOpenClaw(
  _detectResult: DetectResult,
  env: EnvironmentInfo,
): SkipDecision {
  const openclawVersion = (env.packageManagers as Record<string, string | undefined>).openclaw;

  if (openclawVersion) {
    return {
      stepId: 'install-openclaw',
      skip: true,
      reason: `OpenClaw already installed: version ${openclawVersion}`,
    };
  }

  return {
    stepId: 'install-openclaw',
    skip: false,
    reason: 'OpenClaw is not installed and needs to be installed',
  };
}

/**
 * Evaluate whether the configure-openclaw step can be skipped.
 *
 * Configuration is skipped when OpenClaw is already installed AND
 * configured (i.e. the user has already logged in). We infer this from
 * the same OpenClaw presence check — if already installed, we assume
 * configuration was done previously.
 *
 * @param _detectResult - Environment detection result
 * @param env - Raw environment info
 * @returns Skip decision for configure-openclaw
 */
export function evaluateConfigureOpenClaw(
  _detectResult: DetectResult,
  env: EnvironmentInfo,
): SkipDecision {
  const openclawVersion = (env.packageManagers as Record<string, string | undefined>).openclaw;

  if (openclawVersion) {
    return {
      stepId: 'configure-openclaw',
      skip: true,
      reason: `OpenClaw ${openclawVersion} is already installed and configured`,
    };
  }

  return {
    stepId: 'configure-openclaw',
    skip: false,
    reason: 'OpenClaw configuration is required after installation',
  };
}

/**
 * Evaluate whether the verify-installation step can be skipped.
 *
 * Verification is never skipped — it is the final safety net that
 * confirms everything is working, even when all other steps were skipped.
 *
 * @returns Skip decision for verify-installation (always not skipped)
 */
export function evaluateVerifyInstallation(): SkipDecision {
  return {
    stepId: 'verify-installation',
    skip: false,
    reason: 'Verification step is always required',
  };
}

// ============================================================================
// Step evaluator registry
// ============================================================================

/** Map of step id to evaluator function. */
const EVALUATORS: Record<
  string,
  (detectResult: DetectResult, env: EnvironmentInfo) => SkipDecision
> = {
  'check-node': (detectResult) => evaluateCheckNode(detectResult),
  'install-pnpm': (detectResult) => evaluateInstallPnpm(detectResult),
  'install-openclaw': (detectResult, env) => evaluateInstallOpenClaw(detectResult, env),
  'configure-openclaw': (detectResult, env) => evaluateConfigureOpenClaw(detectResult, env),
  'verify-installation': () => evaluateVerifyInstallation(),
};

// ============================================================================
// Main evaluation
// ============================================================================

/**
 * Evaluate a single step for skipping.
 *
 * If the step id has no registered evaluator, the step is kept by default.
 *
 * @param step - The install step to evaluate
 * @param detectResult - Environment detection result
 * @param env - Raw environment info
 * @returns Skip decision for the step
 */
export function evaluateStep(
  step: InstallStep,
  detectResult: DetectResult,
  env: EnvironmentInfo,
): SkipDecision {
  const evaluator = EVALUATORS[step.id];

  if (!evaluator) {
    return {
      stepId: step.id,
      skip: false,
      reason: `No skip evaluator registered for step "${step.id}"`,
    };
  }

  return evaluator(detectResult, env);
}

/**
 * Evaluate all steps and produce a complete skip evaluation.
 *
 * This is the main entry point. It takes the full list of steps and
 * returns which ones should be kept and which should be skipped, along
 * with reasons for each decision.
 *
 * @param steps - Ordered list of install steps to evaluate
 * @param detectResult - Environment detection result
 * @param env - Raw environment info
 * @returns Complete skip evaluation with decisions and filtered steps
 */
export function evaluateSteps(
  steps: readonly InstallStep[],
  detectResult: DetectResult,
  env: EnvironmentInfo,
): SkipEvaluation {
  const decisions: SkipDecision[] = [];
  const remainingSteps: InstallStep[] = [];
  const skippedSteps: InstallStep[] = [];

  for (const step of steps) {
    const decision = evaluateStep(step, detectResult, env);
    decisions.push(decision);

    if (decision.skip) {
      skippedSteps.push(step);
    } else {
      remainingSteps.push(step);
    }
  }

  const skippedCount = skippedSteps.length;
  const totalCount = steps.length;
  let summary: string;

  if (skippedCount === 0) {
    summary = `All ${totalCount} steps are required — no components detected as already installed`;
  } else {
    const skippedIds = skippedSteps.map((s) => s.id).join(', ');
    summary = `Skipped ${skippedCount} of ${totalCount} steps (already installed: ${skippedIds})`;
  }

  return {
    decisions,
    remainingSteps,
    skippedSteps,
    summary,
  };
}

/**
 * Apply step-skip logic to an existing install plan's steps.
 *
 * Convenience wrapper that takes the full step list (e.g. from ALL_STEPS)
 * and returns only the steps that should be executed.
 *
 * @param steps - Ordered list of install steps
 * @param detectResult - Environment detection result
 * @param env - Raw environment info
 * @returns Filtered array of steps that should be executed
 */
export function filterSkippedSteps(
  steps: readonly InstallStep[],
  detectResult: DetectResult,
  env: EnvironmentInfo,
): InstallStep[] {
  const evaluation = evaluateSteps(steps, detectResult, env);
  return evaluation.remainingSteps;
}
