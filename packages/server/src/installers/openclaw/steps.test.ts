// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for OpenClaw installation steps module.
 */

import { describe, it, expect } from 'vitest';
import type { EnvironmentInfo } from '@aiinstaller/shared';
import type { DetectResult } from './detect.js';
import {
  QUICK_TIMEOUT,
  INSTALL_TIMEOUT,
  HEAVY_INSTALL_TIMEOUT,
  ALL_STEPS,
  createCheckNodeStep,
  createInstallPnpmStep,
  createInstallOpenClawStep,
  createConfigureOpenClawStep,
  createVerifyInstallationStep,
  generateSteps,
} from './steps.js';

// ============================================================================
// Helpers
// ============================================================================

/** Create a DetectResult where all checks pass. */
function createPassingDetect(): DetectResult {
  return {
    ready: true,
    checks: {
      nodeVersion: { passed: true, message: 'Node.js 22.1.0 meets the requirement' },
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

/** Create a minimal EnvironmentInfo for generateSteps. */
function createEnv(): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('steps (OpenClaw installation)', () => {
  // --------------------------------------------------------------------------
  // Constants
  // --------------------------------------------------------------------------

  describe('timeout constants', () => {
    it('QUICK_TIMEOUT should be 30 seconds', () => {
      expect(QUICK_TIMEOUT).toBe(30_000);
    });

    it('INSTALL_TIMEOUT should be 60 seconds', () => {
      expect(INSTALL_TIMEOUT).toBe(60_000);
    });

    it('HEAVY_INSTALL_TIMEOUT should be 120 seconds', () => {
      expect(HEAVY_INSTALL_TIMEOUT).toBe(120_000);
    });
  });

  // --------------------------------------------------------------------------
  // Individual step factory functions
  // --------------------------------------------------------------------------

  describe('createCheckNodeStep', () => {
    it('should return a step with id "check-node"', () => {
      const step = createCheckNodeStep();
      expect(step.id).toBe('check-node');
    });

    it('should run "node --version"', () => {
      const step = createCheckNodeStep();
      expect(step.command).toBe('node --version');
    });

    it('should expect output containing "v22"', () => {
      const step = createCheckNodeStep();
      expect(step.expectedOutput).toBe('v22');
    });

    it('should use QUICK_TIMEOUT', () => {
      const step = createCheckNodeStep();
      expect(step.timeout).toBe(QUICK_TIMEOUT);
    });

    it('should not be rollbackable', () => {
      const step = createCheckNodeStep();
      expect(step.canRollback).toBe(false);
    });

    it('should use fallback on error', () => {
      const step = createCheckNodeStep();
      expect(step.onError).toBe('fallback');
    });

    it('should have a Chinese description', () => {
      const step = createCheckNodeStep();
      expect(step.description).toBe('检查 Node.js 版本');
    });
  });

  describe('createInstallPnpmStep', () => {
    it('should return a step with id "install-pnpm"', () => {
      const step = createInstallPnpmStep();
      expect(step.id).toBe('install-pnpm');
    });

    it('should run "npm install -g pnpm"', () => {
      const step = createInstallPnpmStep();
      expect(step.command).toBe('npm install -g pnpm');
    });

    it('should use INSTALL_TIMEOUT', () => {
      const step = createInstallPnpmStep();
      expect(step.timeout).toBe(INSTALL_TIMEOUT);
    });

    it('should be rollbackable', () => {
      const step = createInstallPnpmStep();
      expect(step.canRollback).toBe(true);
    });

    it('should retry on error', () => {
      const step = createInstallPnpmStep();
      expect(step.onError).toBe('retry');
    });

    it('should not have expectedOutput', () => {
      const step = createInstallPnpmStep();
      expect(step.expectedOutput).toBeUndefined();
    });
  });

  describe('createInstallOpenClawStep', () => {
    it('should return a step with id "install-openclaw"', () => {
      const step = createInstallOpenClawStep();
      expect(step.id).toBe('install-openclaw');
    });

    it('should run "pnpm install -g openclaw"', () => {
      const step = createInstallOpenClawStep();
      expect(step.command).toBe('pnpm install -g openclaw');
    });

    it('should use HEAVY_INSTALL_TIMEOUT', () => {
      const step = createInstallOpenClawStep();
      expect(step.timeout).toBe(HEAVY_INSTALL_TIMEOUT);
    });

    it('should be rollbackable', () => {
      const step = createInstallOpenClawStep();
      expect(step.canRollback).toBe(true);
    });

    it('should retry on error', () => {
      const step = createInstallOpenClawStep();
      expect(step.onError).toBe('retry');
    });
  });

  describe('createConfigureOpenClawStep', () => {
    it('should return a step with id "configure-openclaw"', () => {
      const step = createConfigureOpenClawStep();
      expect(step.id).toBe('configure-openclaw');
    });

    it('should run "openclaw login"', () => {
      const step = createConfigureOpenClawStep();
      expect(step.command).toBe('openclaw login');
    });

    it('should use HEAVY_INSTALL_TIMEOUT', () => {
      const step = createConfigureOpenClawStep();
      expect(step.timeout).toBe(HEAVY_INSTALL_TIMEOUT);
    });

    it('should not be rollbackable', () => {
      const step = createConfigureOpenClawStep();
      expect(step.canRollback).toBe(false);
    });

    it('should retry on error', () => {
      const step = createConfigureOpenClawStep();
      expect(step.onError).toBe('retry');
    });
  });

  describe('createVerifyInstallationStep', () => {
    it('should return a step with id "verify-installation"', () => {
      const step = createVerifyInstallationStep();
      expect(step.id).toBe('verify-installation');
    });

    it('should run "openclaw --version"', () => {
      const step = createVerifyInstallationStep();
      expect(step.command).toBe('openclaw --version');
    });

    it('should expect output containing "openclaw"', () => {
      const step = createVerifyInstallationStep();
      expect(step.expectedOutput).toBe('openclaw');
    });

    it('should use QUICK_TIMEOUT', () => {
      const step = createVerifyInstallationStep();
      expect(step.timeout).toBe(QUICK_TIMEOUT);
    });

    it('should not be rollbackable', () => {
      const step = createVerifyInstallationStep();
      expect(step.canRollback).toBe(false);
    });

    it('should abort on error', () => {
      const step = createVerifyInstallationStep();
      expect(step.onError).toBe('abort');
    });
  });

  // --------------------------------------------------------------------------
  // ALL_STEPS
  // --------------------------------------------------------------------------

  describe('ALL_STEPS', () => {
    it('should contain exactly 5 steps', () => {
      expect(ALL_STEPS).toHaveLength(5);
    });

    it('should be in the correct order', () => {
      expect(ALL_STEPS[0].id).toBe('check-node');
      expect(ALL_STEPS[1].id).toBe('install-pnpm');
      expect(ALL_STEPS[2].id).toBe('install-openclaw');
      expect(ALL_STEPS[3].id).toBe('configure-openclaw');
      expect(ALL_STEPS[4].id).toBe('verify-installation');
    });

    it('should have unique ids', () => {
      const ids = ALL_STEPS.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have non-empty descriptions', () => {
      for (const step of ALL_STEPS) {
        expect(step.description.length).toBeGreaterThan(0);
      }
    });

    it('should have non-empty commands', () => {
      for (const step of ALL_STEPS) {
        expect(step.command.length).toBeGreaterThan(0);
      }
    });

    it('should have positive timeouts', () => {
      for (const step of ALL_STEPS) {
        expect(step.timeout).toBeGreaterThan(0);
      }
    });

    it('should be readonly (frozen-like)', () => {
      // ALL_STEPS is typed as readonly InstallStep[]
      expect(Array.isArray(ALL_STEPS)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // generateSteps
  // --------------------------------------------------------------------------

  describe('generateSteps', () => {
    it('should return 4 steps when pnpm is already installed', () => {
      const detect = createPassingDetect();
      const steps = generateSteps(detect);
      expect(steps).toHaveLength(4);
      const ids = steps.map((s) => s.id);
      expect(ids).not.toContain('install-pnpm');
    });

    it('should return 5 steps when pnpm is not installed', () => {
      const detect = createPassingDetect();
      detect.checks.pnpm = { passed: false, message: 'pnpm is not installed' };
      const steps = generateSteps(detect);
      expect(steps).toHaveLength(5);
      const ids = steps.map((s) => s.id);
      expect(ids).toContain('install-pnpm');
    });

    it('should always include check-node step', () => {
      const detect = createPassingDetect();
      const steps = generateSteps(detect);
      expect(steps[0].id).toBe('check-node');
    });

    it('should always include install-openclaw step', () => {
      const detect = createPassingDetect();
      const steps = generateSteps(detect);
      const ids = steps.map((s) => s.id);
      expect(ids).toContain('install-openclaw');
    });

    it('should always include configure-openclaw step', () => {
      const detect = createPassingDetect();
      const steps = generateSteps(detect);
      const ids = steps.map((s) => s.id);
      expect(ids).toContain('configure-openclaw');
    });

    it('should always include verify-installation step', () => {
      const detect = createPassingDetect();
      const steps = generateSteps(detect);
      const ids = steps.map((s) => s.id);
      expect(ids).toContain('verify-installation');
    });

    it('should set check-node onError to "abort" when node is already good', () => {
      const detect = createPassingDetect();
      const steps = generateSteps(detect);
      const checkNode = steps.find((s) => s.id === 'check-node')!;
      expect(checkNode.onError).toBe('abort');
    });

    it('should keep check-node onError as "fallback" when node check fails', () => {
      const detect = createPassingDetect();
      detect.checks.nodeVersion = { passed: false, message: 'Node.js is not installed' };
      const steps = generateSteps(detect);
      const checkNode = steps.find((s) => s.id === 'check-node')!;
      expect(checkNode.onError).toBe('fallback');
    });

    it('should maintain correct step order when pnpm is missing', () => {
      const detect = createPassingDetect();
      detect.checks.pnpm = { passed: false, message: 'pnpm is not installed' };
      const steps = generateSteps(detect);
      const ids = steps.map((s) => s.id);
      expect(ids).toEqual([
        'check-node',
        'install-pnpm',
        'install-openclaw',
        'configure-openclaw',
        'verify-installation',
      ]);
    });

    it('should maintain correct step order when pnpm is present', () => {
      const detect = createPassingDetect();
      const steps = generateSteps(detect);
      const ids = steps.map((s) => s.id);
      expect(ids).toEqual([
        'check-node',
        'install-openclaw',
        'configure-openclaw',
        'verify-installation',
      ]);
    });

    it('should work with all checks failing', () => {
      const detect = createFailingDetect();
      const steps = generateSteps(detect);
      expect(steps).toHaveLength(5);
      expect(steps[0].onError).toBe('fallback'); // node not detected
      expect(steps[1].id).toBe('install-pnpm'); // pnpm not installed
    });

    it('should accept optional env parameter', () => {
      const detect = createPassingDetect();
      const env = createEnv();
      const steps = generateSteps(detect, env);
      expect(steps.length).toBeGreaterThan(0);
    });

    it('should work without env parameter', () => {
      const detect = createPassingDetect();
      const steps = generateSteps(detect);
      expect(steps.length).toBeGreaterThan(0);
    });

    it('should return verify-installation as the last step', () => {
      const detect = createPassingDetect();
      const steps = generateSteps(detect);
      expect(steps[steps.length - 1].id).toBe('verify-installation');
    });

    it('should return verify-installation as the last step even when all checks fail', () => {
      const detect = createFailingDetect();
      const steps = generateSteps(detect);
      expect(steps[steps.length - 1].id).toBe('verify-installation');
    });

    it('should not modify the original detect result', () => {
      const detect = createPassingDetect();
      const originalPnpmPassed = detect.checks.pnpm.passed;
      generateSteps(detect);
      expect(detect.checks.pnpm.passed).toBe(originalPnpmPassed);
    });

    it('should return new array instances each time', () => {
      const detect = createPassingDetect();
      const steps1 = generateSteps(detect);
      const steps2 = generateSteps(detect);
      expect(steps1).not.toBe(steps2);
    });

    it('should return new step instances (not references to ALL_STEPS)', () => {
      const detect = createFailingDetect();
      const steps = generateSteps(detect);
      for (const step of steps) {
        const allStepMatch = ALL_STEPS.find((s) => s.id === step.id);
        expect(step).not.toBe(allStepMatch);
      }
    });
  });
});
