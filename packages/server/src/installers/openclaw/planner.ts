// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * OpenClaw installation plan generator (server-side).
 *
 * Takes the environment detection result and the raw EnvironmentInfo to
 * produce a complete InstallPlan — including dynamically generated steps,
 * estimated time, and risk assessment.
 *
 * @module installers/openclaw/planner
 */

import type { EnvironmentInfo, InstallPlan, InstallStep } from '@aiinstaller/shared';

import type { DetectResult } from './detect.js';
import {
  generateSteps,
  QUICK_TIMEOUT,
  INSTALL_TIMEOUT,
  HEAVY_INSTALL_TIMEOUT,
} from './steps.js';

// ============================================================================
// Types
// ============================================================================

/** Risk level for an installation plan. */
export type RiskLevel = 'low' | 'medium' | 'high';

/** A single risk entry in the plan. */
export interface Risk {
  level: RiskLevel;
  description: string;
}

// ============================================================================
// Time estimation
// ============================================================================

/** Overhead factor applied to step timeouts to compute realistic estimates. */
const ESTIMATE_FACTOR = 0.3;

/**
 * Estimate the total installation time based on the steps.
 *
 * Uses a fraction of each step's timeout as a rough realistic estimate,
 * since timeouts represent upper bounds.
 *
 * @param steps - Ordered list of install steps
 * @returns Estimated total time in milliseconds
 */
export function estimateTime(steps: readonly InstallStep[]): number {
  return steps.reduce((total, step) => total + step.timeout * ESTIMATE_FACTOR, 0);
}

// ============================================================================
// Risk assessment
// ============================================================================

/**
 * Assess risks based on the environment detection result and environment info.
 *
 * @param detectResult - Aggregated detection checks
 * @param env - Raw environment information
 * @returns Array of identified risks
 */
export function assessRisks(detectResult: DetectResult, env: EnvironmentInfo): Risk[] {
  const risks: Risk[] = [];

  // Network issues
  if (!detectResult.checks.network.passed) {
    risks.push({
      level: 'high',
      description: 'npm registry is unreachable. Package installation will likely fail.',
    });
  }

  // Permission issues
  if (!detectResult.checks.permissions.passed) {
    risks.push({
      level: 'high',
      description: 'Insufficient permissions for global installs. Steps may fail without sudo.',
    });
  }

  // Node.js missing or too old
  if (!detectResult.checks.nodeVersion.passed) {
    risks.push({
      level: 'medium',
      description: 'Node.js is missing or below the required version (>= 22.0.0). Manual installation may be needed.',
    });
  }

  // Proxy configured — possible interference
  if (env.network.canAccessNpm && env.network.canAccessGithub === false) {
    risks.push({
      level: 'medium',
      description: 'GitHub is unreachable while npm works. A proxy or firewall may interfere with some steps.',
    });
  }

  // Windows / WSL considerations
  if (env.os.platform === 'win32') {
    risks.push({
      level: 'medium',
      description: 'Running on Windows. Some commands may behave differently outside WSL.',
    });
  }

  // No risks found
  if (risks.length === 0) {
    risks.push({
      level: 'low',
      description: 'Environment looks good. No significant risks detected.',
    });
  }

  return risks;
}

// ============================================================================
// OS-specific step adjustments
// ============================================================================

/**
 * Apply operating-system-specific adjustments to the generated steps.
 *
 * - On Linux without sudo, prefix global install commands with `sudo`.
 * - On macOS, no special adjustments are currently needed.
 * - On Windows (win32), use `npx` fallback for pnpm if pnpm is not found.
 *
 * @param steps - Mutable array of install steps
 * @param env - Raw environment information
 * @returns The adjusted steps (same array reference, mutated in place)
 */
export function applyOsAdjustments(steps: InstallStep[], env: EnvironmentInfo): InstallStep[] {
  const needsSudo =
    env.os.platform === 'linux' &&
    !env.permissions.hasSudo &&
    env.permissions.canWriteTo.length === 0;

  for (const step of steps) {
    // On Linux without writable dirs and without sudo, we still try sudo
    // as the user may be prompted for their password.
    if (env.os.platform === 'linux' && !needsSudo && env.permissions.hasSudo) {
      if (step.id === 'install-pnpm' || step.id === 'install-openclaw') {
        if (!step.command.startsWith('sudo ')) {
          step.command = `sudo ${step.command}`;
        }
      }
    }

    // Windows: use npm instead of pnpm for OpenClaw install if pnpm step was skipped
    if (env.os.platform === 'win32' && step.id === 'install-openclaw') {
      step.command = step.command.replace('pnpm install -g', 'npm install -g');
    }
  }

  return steps;
}

// ============================================================================
// Proxy configuration
// ============================================================================

/**
 * If a proxy is likely needed (GitHub unreachable while npm works),
 * prepend a proxy configuration step to the list.
 *
 * @param steps - Current steps list
 * @param env - Raw environment information
 * @returns Steps with an optional proxy config step prepended
 */
export function applyProxyConfig(steps: InstallStep[], env: EnvironmentInfo): InstallStep[] {
  // Heuristic: if npm is reachable but GitHub is not, the user probably
  // has a proxy for npm but hasn't configured git / other tools.
  if (env.network.canAccessNpm && !env.network.canAccessGithub) {
    const proxyStep: InstallStep = {
      id: 'configure-proxy',
      description: '配置网络代理 (GitHub 不可达)',
      command: 'npm config get proxy',
      timeout: QUICK_TIMEOUT,
      canRollback: false,
      onError: 'skip',
    };
    steps.unshift(proxyStep);
  }

  return steps;
}

// ============================================================================
// Main planner
// ============================================================================

/**
 * Generate a complete installation plan for OpenClaw.
 *
 * The plan includes dynamically generated steps (skipping already-satisfied
 * prerequisites), OS-specific command adjustments, proxy handling, time
 * estimation, and risk assessment.
 *
 * @param detectResult - Result from `detectOpenClawReadiness`
 * @param env - Raw environment information reported by the agent
 * @returns A fully formed InstallPlan ready to send to the client
 */
export function generatePlan(detectResult: DetectResult, env: EnvironmentInfo): InstallPlan {
  // 1. Generate base steps (skips already-satisfied ones)
  let steps = generateSteps(detectResult, env);

  // 2. Apply OS-specific adjustments
  steps = applyOsAdjustments(steps, env);

  // 3. Apply proxy configuration if needed
  steps = applyProxyConfig(steps, env);

  // 4. Estimate total time
  const estimatedTime = estimateTime(steps);

  // 5. Assess risks
  const risks = assessRisks(detectResult, env);

  return {
    steps,
    estimatedTime,
    risks,
  };
}
