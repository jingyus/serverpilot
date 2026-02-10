/**
 * OpenClaw installation steps module (server-side).
 *
 * Defines the ordered sequence of InstallStep objects required to install
 * OpenClaw on a target machine.  Steps are generated dynamically based on
 * the environment detection result so that already-satisfied prerequisites
 * can be skipped.
 *
 * @module installers/openclaw/steps
 */

import type { InstallStep, EnvironmentInfo } from '@aiinstaller/shared';

import type { DetectResult } from './detect.js';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for quick validation commands (ms) */
export const QUICK_TIMEOUT = 30_000;

/** Default timeout for package install commands (ms) */
export const INSTALL_TIMEOUT = 60_000;

/** Default timeout for heavy install commands (ms) */
export const HEAVY_INSTALL_TIMEOUT = 120_000;

// ============================================================================
// Step definitions
// ============================================================================

/**
 * Step 1 – Check Node.js version.
 *
 * Runs `node --version` and expects output containing "v22".
 * On error the plan should attempt to install Node.
 */
export function createCheckNodeStep(): InstallStep {
  return {
    id: 'check-node',
    description: '检查 Node.js 版本',
    command: 'node --version',
    expectedOutput: 'v22',
    timeout: QUICK_TIMEOUT,
    canRollback: false,
    onError: 'fallback',
  };
}

/**
 * Step 2 – Install pnpm package manager.
 *
 * Uses `npm install -g pnpm` to install pnpm globally.
 */
export function createInstallPnpmStep(): InstallStep {
  return {
    id: 'install-pnpm',
    description: '安装 pnpm 包管理器',
    command: 'npm install -g pnpm',
    timeout: INSTALL_TIMEOUT,
    canRollback: true,
    onError: 'retry',
  };
}

/**
 * Step 3 – Install OpenClaw globally via pnpm.
 */
export function createInstallOpenClawStep(): InstallStep {
  return {
    id: 'install-openclaw',
    description: '全局安装 OpenClaw',
    command: 'pnpm install -g openclaw',
    timeout: HEAVY_INSTALL_TIMEOUT,
    canRollback: true,
    onError: 'retry',
  };
}

/**
 * Step 4 – Configure OpenClaw authentication.
 *
 * Runs `openclaw login` which requires interactive user input.
 */
export function createConfigureOpenClawStep(): InstallStep {
  return {
    id: 'configure-openclaw',
    description: '配置 OpenClaw 认证',
    command: 'openclaw login',
    timeout: HEAVY_INSTALL_TIMEOUT,
    canRollback: false,
    onError: 'retry',
  };
}

/**
 * Step 5 – Verify the installation by printing the version.
 */
export function createVerifyInstallationStep(): InstallStep {
  return {
    id: 'verify-installation',
    description: '验证 OpenClaw 安装',
    command: 'openclaw --version',
    expectedOutput: 'openclaw',
    timeout: QUICK_TIMEOUT,
    canRollback: false,
    onError: 'abort',
  };
}

// ============================================================================
// All steps (static, ordered list)
// ============================================================================

/** The full ordered list of all OpenClaw installation steps. */
export const ALL_STEPS: readonly InstallStep[] = [
  createCheckNodeStep(),
  createInstallPnpmStep(),
  createInstallOpenClawStep(),
  createConfigureOpenClawStep(),
  createVerifyInstallationStep(),
];

// ============================================================================
// Dynamic step generation
// ============================================================================

/**
 * Generate a tailored list of installation steps based on environment
 * detection results.
 *
 * Steps whose prerequisites are already satisfied will be skipped:
 * - If Node.js >= 22 is detected, the check-node step is kept (quick
 *   validation) but its onError strategy is set to 'abort' because
 *   we do not expect it to fail.
 * - If pnpm is already installed, the install-pnpm step is omitted.
 *
 * @param detectResult - Result from {@link detectOpenClawReadiness}
 * @param _env - The raw environment info (reserved for future per-OS tweaks)
 * @returns Ordered array of InstallStep objects to execute
 */
export function generateSteps(detectResult: DetectResult, _env?: EnvironmentInfo): InstallStep[] {
  const steps: InstallStep[] = [];

  // Step 1: check-node — always include, but adjust error strategy
  const checkNode = createCheckNodeStep();
  if (detectResult.checks.nodeVersion.passed) {
    // Node is known-good; if the check somehow fails at runtime, abort.
    checkNode.onError = 'abort';
  }
  steps.push(checkNode);

  // Step 2: install-pnpm — skip if pnpm is already present
  if (!detectResult.checks.pnpm.passed) {
    steps.push(createInstallPnpmStep());
  }

  // Step 3: install-openclaw — always required
  steps.push(createInstallOpenClawStep());

  // Step 4: configure-openclaw — always required
  steps.push(createConfigureOpenClawStep());

  // Step 5: verify-installation — always required
  steps.push(createVerifyInstallationStep());

  return steps;
}
