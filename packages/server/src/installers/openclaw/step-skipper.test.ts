// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for OpenClaw step-skipper module.
 */

import { describe, it, expect } from 'vitest';
import type { EnvironmentInfo } from '@aiinstaller/shared';
import type { DetectResult } from './detect.js';
import {
  evaluateCheckNode,
  evaluateInstallPnpm,
  evaluateInstallOpenClaw,
  evaluateConfigureOpenClaw,
  evaluateVerifyInstallation,
  evaluateStep,
  evaluateSteps,
  filterSkippedSteps,
} from './step-skipper.js';
import type { SkipDecision, SkipEvaluation } from './step-skipper.js';
import { ALL_STEPS } from './steps.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a DetectResult where all checks pass. */
function createPassingDetect(): DetectResult {
  return {
    ready: true,
    checks: {
      nodeVersion: { passed: true, message: 'Node.js 22.1.0 meets the requirement (>= 22.0.0)' },
      pnpm: { passed: true, message: 'pnpm 9.1.0 is installed' },
      network: { passed: true, message: 'npm registry is reachable' },
      permissions: { passed: true, message: 'sudo access is available' },
    },
    summary: 'Environment is ready for OpenClaw installation (4/4 checks passed)',
  };
}

/** Create a DetectResult where all checks fail. */
function createFailingDetect(): DetectResult {
  return {
    ready: false,
    checks: {
      nodeVersion: { passed: false, message: 'Node.js is not installed' },
      pnpm: { passed: false, message: 'pnpm is not installed' },
      network: { passed: false, message: 'Cannot reach npm registry' },
      permissions: { passed: false, message: 'Insufficient permissions' },
    },
    summary: 'Environment is not ready: 4 check(s) failed out of 4',
  };
}

/** Create a macOS environment without OpenClaw installed. */
function createEnvWithoutOpenClaw(): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
  };
}

/** Create a macOS environment with OpenClaw already installed. */
function createEnvWithOpenClaw(): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0', openclaw: '1.2.3' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
  };
}

/** Create a bare environment (no Node, no pnpm, no OpenClaw). */
function createBareEnv(): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '6.5.0', arch: 'x86_64' },
    shell: { type: 'bash', version: '5.2' },
    runtime: {},
    packageManagers: { npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: [] },
  };
}

// ============================================================================
// evaluateCheckNode
// ============================================================================

describe('evaluateCheckNode', () => {
  it('should skip when Node.js check passes', () => {
    const decision = evaluateCheckNode(createPassingDetect());
    expect(decision.stepId).toBe('check-node');
    expect(decision.skip).toBe(true);
    expect(decision.reason).toContain('already meets');
  });

  it('should not skip when Node.js check fails', () => {
    const decision = evaluateCheckNode(createFailingDetect());
    expect(decision.stepId).toBe('check-node');
    expect(decision.skip).toBe(false);
    expect(decision.reason).toContain('check needed');
  });

  it('should include the detection message in the reason', () => {
    const detect = createPassingDetect();
    detect.checks.nodeVersion.message = 'Node.js 22.5.0 OK';
    const decision = evaluateCheckNode(detect);
    expect(decision.reason).toContain('Node.js 22.5.0 OK');
  });
});

// ============================================================================
// evaluateInstallPnpm
// ============================================================================

describe('evaluateInstallPnpm', () => {
  it('should skip when pnpm is already installed', () => {
    const decision = evaluateInstallPnpm(createPassingDetect());
    expect(decision.stepId).toBe('install-pnpm');
    expect(decision.skip).toBe(true);
    expect(decision.reason).toContain('already installed');
  });

  it('should not skip when pnpm is not installed', () => {
    const decision = evaluateInstallPnpm(createFailingDetect());
    expect(decision.stepId).toBe('install-pnpm');
    expect(decision.skip).toBe(false);
    expect(decision.reason).toContain('needs to be installed');
  });

  it('should include the detection message in the reason', () => {
    const detect = createPassingDetect();
    detect.checks.pnpm.message = 'pnpm 9.5.0 is installed';
    const decision = evaluateInstallPnpm(detect);
    expect(decision.reason).toContain('pnpm 9.5.0 is installed');
  });
});

// ============================================================================
// evaluateInstallOpenClaw
// ============================================================================

describe('evaluateInstallOpenClaw', () => {
  it('should skip when OpenClaw is already installed', () => {
    const decision = evaluateInstallOpenClaw(createPassingDetect(), createEnvWithOpenClaw());
    expect(decision.stepId).toBe('install-openclaw');
    expect(decision.skip).toBe(true);
    expect(decision.reason).toContain('already installed');
    expect(decision.reason).toContain('1.2.3');
  });

  it('should not skip when OpenClaw is not installed', () => {
    const decision = evaluateInstallOpenClaw(createPassingDetect(), createEnvWithoutOpenClaw());
    expect(decision.stepId).toBe('install-openclaw');
    expect(decision.skip).toBe(false);
    expect(decision.reason).toContain('not installed');
  });

  it('should not skip when packageManagers does not have openclaw key', () => {
    const decision = evaluateInstallOpenClaw(createPassingDetect(), createBareEnv());
    expect(decision.skip).toBe(false);
  });
});

// ============================================================================
// evaluateConfigureOpenClaw
// ============================================================================

describe('evaluateConfigureOpenClaw', () => {
  it('should skip when OpenClaw is already installed', () => {
    const decision = evaluateConfigureOpenClaw(createPassingDetect(), createEnvWithOpenClaw());
    expect(decision.stepId).toBe('configure-openclaw');
    expect(decision.skip).toBe(true);
    expect(decision.reason).toContain('already installed and configured');
  });

  it('should not skip when OpenClaw is not installed', () => {
    const decision = evaluateConfigureOpenClaw(createPassingDetect(), createEnvWithoutOpenClaw());
    expect(decision.stepId).toBe('configure-openclaw');
    expect(decision.skip).toBe(false);
    expect(decision.reason).toContain('required');
  });

  it('should include version in the reason when skipping', () => {
    const decision = evaluateConfigureOpenClaw(createPassingDetect(), createEnvWithOpenClaw());
    expect(decision.reason).toContain('1.2.3');
  });
});

// ============================================================================
// evaluateVerifyInstallation
// ============================================================================

describe('evaluateVerifyInstallation', () => {
  it('should never skip', () => {
    const decision = evaluateVerifyInstallation();
    expect(decision.stepId).toBe('verify-installation');
    expect(decision.skip).toBe(false);
  });

  it('should explain why verification is always required', () => {
    const decision = evaluateVerifyInstallation();
    expect(decision.reason).toContain('always required');
  });
});

// ============================================================================
// evaluateStep
// ============================================================================

describe('evaluateStep', () => {
  it('should evaluate a known step (check-node)', () => {
    const step = ALL_STEPS[0]; // check-node
    const decision = evaluateStep(step, createPassingDetect(), createEnvWithoutOpenClaw());
    expect(decision.stepId).toBe('check-node');
    expect(decision.skip).toBe(true);
  });

  it('should evaluate a known step (install-pnpm)', () => {
    const step = ALL_STEPS[1]; // install-pnpm
    const decision = evaluateStep(step, createFailingDetect(), createBareEnv());
    expect(decision.stepId).toBe('install-pnpm');
    expect(decision.skip).toBe(false);
  });

  it('should evaluate install-openclaw with env info', () => {
    const step = ALL_STEPS[2]; // install-openclaw
    const decision = evaluateStep(step, createPassingDetect(), createEnvWithOpenClaw());
    expect(decision.stepId).toBe('install-openclaw');
    expect(decision.skip).toBe(true);
  });

  it('should not skip an unknown step', () => {
    const unknownStep = {
      id: 'custom-step',
      description: 'Custom step',
      command: 'echo hello',
      timeout: 30_000,
      canRollback: false,
      onError: 'abort' as const,
    };
    const decision = evaluateStep(unknownStep, createPassingDetect(), createEnvWithoutOpenClaw());
    expect(decision.stepId).toBe('custom-step');
    expect(decision.skip).toBe(false);
    expect(decision.reason).toContain('No skip evaluator');
  });
});

// ============================================================================
// evaluateSteps
// ============================================================================

describe('evaluateSteps', () => {
  it('should return decisions for all steps', () => {
    const result = evaluateSteps(ALL_STEPS, createPassingDetect(), createEnvWithoutOpenClaw());
    expect(result.decisions).toHaveLength(ALL_STEPS.length);
  });

  it('should produce matching remaining + skipped = total', () => {
    const result = evaluateSteps(ALL_STEPS, createPassingDetect(), createEnvWithoutOpenClaw());
    expect(result.remainingSteps.length + result.skippedSteps.length).toBe(ALL_STEPS.length);
  });

  it('should skip check-node and install-pnpm when both are already satisfied', () => {
    const result = evaluateSteps(ALL_STEPS, createPassingDetect(), createEnvWithoutOpenClaw());
    const skippedIds = result.skippedSteps.map((s) => s.id);
    expect(skippedIds).toContain('check-node');
    expect(skippedIds).toContain('install-pnpm');
  });

  it('should not skip any steps when all checks fail and OpenClaw is missing', () => {
    const result = evaluateSteps(ALL_STEPS, createFailingDetect(), createBareEnv());
    expect(result.skippedSteps).toHaveLength(0);
    expect(result.remainingSteps).toHaveLength(ALL_STEPS.length);
  });

  it('should skip install-openclaw and configure-openclaw when OpenClaw is installed', () => {
    const result = evaluateSteps(ALL_STEPS, createPassingDetect(), createEnvWithOpenClaw());
    const skippedIds = result.skippedSteps.map((s) => s.id);
    expect(skippedIds).toContain('install-openclaw');
    expect(skippedIds).toContain('configure-openclaw');
  });

  it('should never skip verify-installation', () => {
    // Even when everything is installed
    const result = evaluateSteps(ALL_STEPS, createPassingDetect(), createEnvWithOpenClaw());
    const remainingIds = result.remainingSteps.map((s) => s.id);
    expect(remainingIds).toContain('verify-installation');
  });

  it('should skip 4 of 5 steps when everything is already installed', () => {
    const result = evaluateSteps(ALL_STEPS, createPassingDetect(), createEnvWithOpenClaw());
    // check-node (skip), install-pnpm (skip), install-openclaw (skip),
    // configure-openclaw (skip), verify-installation (keep)
    expect(result.skippedSteps).toHaveLength(4);
    expect(result.remainingSteps).toHaveLength(1);
    expect(result.remainingSteps[0].id).toBe('verify-installation');
  });

  it('should generate a summary mentioning "no components detected" when nothing is skipped', () => {
    const result = evaluateSteps(ALL_STEPS, createFailingDetect(), createBareEnv());
    expect(result.summary).toContain('All');
    expect(result.summary).toContain('no components detected');
  });

  it('should generate a summary listing skipped step ids', () => {
    const result = evaluateSteps(ALL_STEPS, createPassingDetect(), createEnvWithOpenClaw());
    expect(result.summary).toContain('Skipped');
    expect(result.summary).toContain('check-node');
    expect(result.summary).toContain('install-openclaw');
  });

  it('should preserve step order in remainingSteps', () => {
    const detect = createPassingDetect();
    detect.checks.pnpm.passed = false; // pnpm not installed
    const result = evaluateSteps(ALL_STEPS, detect, createEnvWithoutOpenClaw());
    const ids = result.remainingSteps.map((s) => s.id);
    // check-node is skipped, install-pnpm remains, install-openclaw remains, etc.
    expect(ids.indexOf('install-pnpm')).toBeLessThan(ids.indexOf('install-openclaw'));
    expect(ids.indexOf('install-openclaw')).toBeLessThan(ids.indexOf('configure-openclaw'));
    expect(ids.indexOf('configure-openclaw')).toBeLessThan(ids.indexOf('verify-installation'));
  });

  it('should preserve step order in skippedSteps', () => {
    const result = evaluateSteps(ALL_STEPS, createPassingDetect(), createEnvWithOpenClaw());
    const ids = result.skippedSteps.map((s) => s.id);
    expect(ids.indexOf('check-node')).toBeLessThan(ids.indexOf('install-pnpm'));
    expect(ids.indexOf('install-pnpm')).toBeLessThan(ids.indexOf('install-openclaw'));
  });

  it('should handle an empty steps list', () => {
    const result = evaluateSteps([], createPassingDetect(), createEnvWithoutOpenClaw());
    expect(result.decisions).toHaveLength(0);
    expect(result.remainingSteps).toHaveLength(0);
    expect(result.skippedSteps).toHaveLength(0);
    expect(result.summary).toContain('All 0 steps');
  });

  it('should handle steps with unknown ids gracefully', () => {
    const customSteps = [
      {
        id: 'unknown-step',
        description: 'Unknown',
        command: 'echo hi',
        timeout: 10_000,
        canRollback: false,
        onError: 'abort' as const,
      },
    ];
    const result = evaluateSteps(customSteps, createPassingDetect(), createEnvWithoutOpenClaw());
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0].skip).toBe(false);
    expect(result.remainingSteps).toHaveLength(1);
    expect(result.skippedSteps).toHaveLength(0);
  });

  it('each decision should have a non-empty reason', () => {
    const result = evaluateSteps(ALL_STEPS, createPassingDetect(), createEnvWithOpenClaw());
    for (const decision of result.decisions) {
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });

  it('each decision stepId should match a step in the input', () => {
    const result = evaluateSteps(ALL_STEPS, createPassingDetect(), createEnvWithOpenClaw());
    const inputIds = ALL_STEPS.map((s) => s.id);
    for (const decision of result.decisions) {
      expect(inputIds).toContain(decision.stepId);
    }
  });
});

// ============================================================================
// filterSkippedSteps
// ============================================================================

describe('filterSkippedSteps', () => {
  it('should return only non-skipped steps', () => {
    const result = filterSkippedSteps(ALL_STEPS, createPassingDetect(), createEnvWithoutOpenClaw());
    const ids = result.map((s) => s.id);
    // check-node skipped, install-pnpm skipped
    expect(ids).not.toContain('check-node');
    expect(ids).not.toContain('install-pnpm');
    expect(ids).toContain('install-openclaw');
    expect(ids).toContain('configure-openclaw');
    expect(ids).toContain('verify-installation');
  });

  it('should return all steps when nothing can be skipped', () => {
    const result = filterSkippedSteps(ALL_STEPS, createFailingDetect(), createBareEnv());
    expect(result).toHaveLength(ALL_STEPS.length);
  });

  it('should return only verify-installation when everything is installed', () => {
    const result = filterSkippedSteps(ALL_STEPS, createPassingDetect(), createEnvWithOpenClaw());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('verify-installation');
  });

  it('should return a new array (not reference to input)', () => {
    const input = [...ALL_STEPS];
    const result = filterSkippedSteps(input, createPassingDetect(), createEnvWithoutOpenClaw());
    expect(result).not.toBe(input);
  });

  it('should handle mixed skip/keep scenario', () => {
    const detect = createPassingDetect();
    detect.checks.pnpm.passed = false; // pnpm not installed
    const result = filterSkippedSteps(ALL_STEPS, detect, createEnvWithoutOpenClaw());
    const ids = result.map((s) => s.id);
    // check-node skipped (node OK), install-pnpm kept (not installed)
    expect(ids).not.toContain('check-node');
    expect(ids).toContain('install-pnpm');
    expect(ids).toContain('install-openclaw');
    expect(ids).toContain('configure-openclaw');
    expect(ids).toContain('verify-installation');
    expect(result).toHaveLength(4);
  });
});

// ============================================================================
// Integration: evaluateSteps with various environment combinations
// ============================================================================

describe('integration: environment combinations', () => {
  it('fresh machine: Node missing, pnpm missing, OpenClaw missing → no skips', () => {
    const detect = createFailingDetect();
    const env = createBareEnv();
    const result = evaluateSteps(ALL_STEPS, detect, env);
    expect(result.skippedSteps).toHaveLength(0);
    expect(result.remainingSteps).toHaveLength(5);
  });

  it('Node installed, pnpm missing, OpenClaw missing → skip check-node only', () => {
    const detect = createPassingDetect();
    detect.checks.pnpm.passed = false;
    detect.checks.pnpm.message = 'pnpm is not installed';
    const env = createEnvWithoutOpenClaw();
    delete (env.packageManagers as Record<string, string | undefined>).pnpm;
    const result = evaluateSteps(ALL_STEPS, detect, env);
    const skippedIds = result.skippedSteps.map((s) => s.id);
    expect(skippedIds).toEqual(['check-node']);
    expect(result.remainingSteps).toHaveLength(4);
  });

  it('Node installed, pnpm installed, OpenClaw missing → skip check-node + install-pnpm', () => {
    const detect = createPassingDetect();
    const env = createEnvWithoutOpenClaw();
    const result = evaluateSteps(ALL_STEPS, detect, env);
    const skippedIds = result.skippedSteps.map((s) => s.id);
    expect(skippedIds).toEqual(['check-node', 'install-pnpm']);
    expect(result.remainingSteps).toHaveLength(3);
  });

  it('everything installed → skip all except verify', () => {
    const detect = createPassingDetect();
    const env = createEnvWithOpenClaw();
    const result = evaluateSteps(ALL_STEPS, detect, env);
    expect(result.skippedSteps).toHaveLength(4);
    expect(result.remainingSteps).toHaveLength(1);
    expect(result.remainingSteps[0].id).toBe('verify-installation');
  });

  it('Node missing but OpenClaw somehow installed → skip install+configure, keep check-node', () => {
    const detect = createFailingDetect();
    detect.checks.pnpm.passed = true; // pnpm is there
    detect.checks.pnpm.message = 'pnpm 9.1.0 is installed';
    const env = createEnvWithOpenClaw();
    const result = evaluateSteps(ALL_STEPS, detect, env);
    const skippedIds = result.skippedSteps.map((s) => s.id);
    expect(skippedIds).toContain('install-pnpm');
    expect(skippedIds).toContain('install-openclaw');
    expect(skippedIds).toContain('configure-openclaw');
    expect(skippedIds).not.toContain('check-node'); // Node not detected
    const remainingIds = result.remainingSteps.map((s) => s.id);
    expect(remainingIds).toContain('check-node');
    expect(remainingIds).toContain('verify-installation');
  });
});
