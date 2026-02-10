/**
 * Tests for OpenClaw installation plan generator.
 */

import { describe, it, expect } from 'vitest';
import { InstallPlanSchema } from '@aiinstaller/shared';
import type { EnvironmentInfo } from '@aiinstaller/shared';
import type { DetectResult } from './detect.js';
import {
  estimateTime,
  assessRisks,
  applyOsAdjustments,
  applyProxyConfig,
  generatePlan,
} from './planner.js';
import { QUICK_TIMEOUT, INSTALL_TIMEOUT, HEAVY_INSTALL_TIMEOUT } from './steps.js';

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

/** Create a macOS (darwin) environment. */
function createDarwinEnv(): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
  };
}

/** Create a Linux environment with sudo. */
function createLinuxEnv(): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '6.5.0', arch: 'x86_64' },
    shell: { type: 'bash', version: '5.2' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: [] },
  };
}

/** Create a Linux environment without sudo and no writable dirs. */
function createLinuxNoSudoEnv(): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '6.5.0', arch: 'x86_64' },
    shell: { type: 'bash', version: '5.2' },
    runtime: { node: '22.1.0' },
    packageManagers: { npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: false, canWriteTo: [] },
  };
}

/** Create a Windows environment. */
function createWindowsEnv(): EnvironmentInfo {
  return {
    os: { platform: 'win32', version: '10.0.22631', arch: 'x86_64' },
    shell: { type: 'powershell', version: '7.4' },
    runtime: { node: '22.1.0' },
    packageManagers: { npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: false, canWriteTo: ['C:\\Users\\user\\AppData'] },
  };
}

/** Create an environment where npm works but GitHub doesn't. */
function createProxyNeededEnv(): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: false },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
  };
}

// ============================================================================
// estimateTime
// ============================================================================

describe('estimateTime', () => {
  it('should return 0 for an empty steps list', () => {
    expect(estimateTime([])).toBe(0);
  });

  it('should compute sum of timeout * 0.3 for each step', () => {
    const steps = [
      { id: 'a', description: 'a', command: 'a', timeout: 10_000, canRollback: false, onError: 'abort' as const },
      { id: 'b', description: 'b', command: 'b', timeout: 20_000, canRollback: false, onError: 'abort' as const },
    ];
    // (10000 * 0.3) + (20000 * 0.3) = 3000 + 6000 = 9000
    expect(estimateTime(steps)).toBe(9000);
  });

  it('should work with a single step', () => {
    const steps = [
      { id: 'x', description: 'x', command: 'x', timeout: 60_000, canRollback: false, onError: 'retry' as const },
    ];
    expect(estimateTime(steps)).toBe(18_000);
  });
});

// ============================================================================
// assessRisks
// ============================================================================

describe('assessRisks', () => {
  it('should return low risk when everything passes', () => {
    const risks = assessRisks(createPassingDetect(), createDarwinEnv());
    expect(risks).toHaveLength(1);
    expect(risks[0].level).toBe('low');
  });

  it('should flag high risk when network is unreachable', () => {
    const detect = createPassingDetect();
    detect.checks.network.passed = false;
    const risks = assessRisks(detect, createDarwinEnv());
    expect(risks.some((r) => r.level === 'high' && r.description.includes('npm registry'))).toBe(true);
  });

  it('should flag high risk when permissions are insufficient', () => {
    const detect = createPassingDetect();
    detect.checks.permissions.passed = false;
    const risks = assessRisks(detect, createDarwinEnv());
    expect(risks.some((r) => r.level === 'high' && r.description.includes('permissions'))).toBe(true);
  });

  it('should flag medium risk when Node.js check fails', () => {
    const detect = createPassingDetect();
    detect.checks.nodeVersion.passed = false;
    const risks = assessRisks(detect, createDarwinEnv());
    expect(risks.some((r) => r.level === 'medium' && r.description.includes('Node.js'))).toBe(true);
  });

  it('should flag medium risk when GitHub is unreachable but npm works', () => {
    const risks = assessRisks(createPassingDetect(), createProxyNeededEnv());
    expect(risks.some((r) => r.level === 'medium' && r.description.includes('GitHub'))).toBe(true);
  });

  it('should flag medium risk for Windows', () => {
    const risks = assessRisks(createPassingDetect(), createWindowsEnv());
    expect(risks.some((r) => r.level === 'medium' && r.description.includes('Windows'))).toBe(true);
  });

  it('should report multiple risks simultaneously', () => {
    const detect = createFailingDetect();
    const risks = assessRisks(detect, createDarwinEnv());
    // network + permissions + nodeVersion = 3 risks
    expect(risks.length).toBeGreaterThanOrEqual(3);
  });

  it('should not include the low-risk fallback when real risks exist', () => {
    const detect = createPassingDetect();
    detect.checks.network.passed = false;
    const risks = assessRisks(detect, createDarwinEnv());
    expect(risks.every((r) => r.level !== 'low')).toBe(true);
  });
});

// ============================================================================
// applyOsAdjustments
// ============================================================================

describe('applyOsAdjustments', () => {
  it('should prefix install commands with sudo on Linux with sudo access', () => {
    const steps = [
      { id: 'install-pnpm', description: '安装 pnpm', command: 'npm install -g pnpm', timeout: INSTALL_TIMEOUT, canRollback: true, onError: 'retry' as const },
      { id: 'install-openclaw', description: '安装 OpenClaw', command: 'pnpm install -g openclaw', timeout: HEAVY_INSTALL_TIMEOUT, canRollback: true, onError: 'retry' as const },
    ];
    applyOsAdjustments(steps, createLinuxEnv());
    expect(steps[0].command).toBe('sudo npm install -g pnpm');
    expect(steps[1].command).toBe('sudo pnpm install -g openclaw');
  });

  it('should not prefix sudo on macOS', () => {
    const steps = [
      { id: 'install-pnpm', description: '安装 pnpm', command: 'npm install -g pnpm', timeout: INSTALL_TIMEOUT, canRollback: true, onError: 'retry' as const },
    ];
    applyOsAdjustments(steps, createDarwinEnv());
    expect(steps[0].command).toBe('npm install -g pnpm');
  });

  it('should not double-prefix sudo', () => {
    const steps = [
      { id: 'install-pnpm', description: '安装 pnpm', command: 'sudo npm install -g pnpm', timeout: INSTALL_TIMEOUT, canRollback: true, onError: 'retry' as const },
    ];
    applyOsAdjustments(steps, createLinuxEnv());
    expect(steps[0].command).toBe('sudo npm install -g pnpm');
  });

  it('should not add sudo on Linux without sudo access', () => {
    const steps = [
      { id: 'install-pnpm', description: '安装 pnpm', command: 'npm install -g pnpm', timeout: INSTALL_TIMEOUT, canRollback: true, onError: 'retry' as const },
    ];
    applyOsAdjustments(steps, createLinuxNoSudoEnv());
    expect(steps[0].command).toBe('npm install -g pnpm');
  });

  it('should use npm instead of pnpm for OpenClaw install on Windows', () => {
    const steps = [
      { id: 'install-openclaw', description: '安装 OpenClaw', command: 'pnpm install -g openclaw', timeout: HEAVY_INSTALL_TIMEOUT, canRollback: true, onError: 'retry' as const },
    ];
    applyOsAdjustments(steps, createWindowsEnv());
    expect(steps[0].command).toBe('npm install -g openclaw');
  });

  it('should not modify non-install steps on Linux', () => {
    const steps = [
      { id: 'check-node', description: '检查 Node', command: 'node --version', timeout: QUICK_TIMEOUT, canRollback: false, onError: 'fallback' as const },
    ];
    applyOsAdjustments(steps, createLinuxEnv());
    expect(steps[0].command).toBe('node --version');
  });

  it('should return the same array reference', () => {
    const steps = [
      { id: 'check-node', description: 'test', command: 'node --version', timeout: QUICK_TIMEOUT, canRollback: false, onError: 'abort' as const },
    ];
    const result = applyOsAdjustments(steps, createDarwinEnv());
    expect(result).toBe(steps);
  });
});

// ============================================================================
// applyProxyConfig
// ============================================================================

describe('applyProxyConfig', () => {
  it('should prepend a proxy step when npm works but GitHub does not', () => {
    const steps = [
      { id: 'check-node', description: 'check', command: 'node --version', timeout: QUICK_TIMEOUT, canRollback: false, onError: 'abort' as const },
    ];
    applyProxyConfig(steps, createProxyNeededEnv());
    expect(steps).toHaveLength(2);
    expect(steps[0].id).toBe('configure-proxy');
    expect(steps[0].onError).toBe('skip');
  });

  it('should not add proxy step when both npm and GitHub are reachable', () => {
    const steps = [
      { id: 'check-node', description: 'check', command: 'node --version', timeout: QUICK_TIMEOUT, canRollback: false, onError: 'abort' as const },
    ];
    applyProxyConfig(steps, createDarwinEnv());
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe('check-node');
  });

  it('should not add proxy step when npm is also unreachable', () => {
    const env = createDarwinEnv();
    env.network.canAccessNpm = false;
    env.network.canAccessGithub = false;
    const steps = [
      { id: 'check-node', description: 'check', command: 'node --version', timeout: QUICK_TIMEOUT, canRollback: false, onError: 'abort' as const },
    ];
    applyProxyConfig(steps, env);
    expect(steps).toHaveLength(1);
  });

  it('should set proxy step timeout to QUICK_TIMEOUT', () => {
    const steps: any[] = [];
    applyProxyConfig(steps, createProxyNeededEnv());
    expect(steps[0].timeout).toBe(QUICK_TIMEOUT);
  });
});

// ============================================================================
// generatePlan
// ============================================================================

describe('generatePlan', () => {
  it('should return a valid InstallPlan (passes Zod schema)', () => {
    const plan = generatePlan(createPassingDetect(), createDarwinEnv());
    const result = InstallPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
  });

  it('should include steps, estimatedTime, and risks', () => {
    const plan = generatePlan(createPassingDetect(), createDarwinEnv());
    expect(plan.steps).toBeDefined();
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(typeof plan.estimatedTime).toBe('number');
    expect(plan.estimatedTime).toBeGreaterThan(0);
    expect(Array.isArray(plan.risks)).toBe(true);
    expect(plan.risks.length).toBeGreaterThan(0);
  });

  // Step skipping
  it('should skip install-pnpm step when pnpm is already installed', () => {
    const plan = generatePlan(createPassingDetect(), createDarwinEnv());
    expect(plan.steps.some((s) => s.id === 'install-pnpm')).toBe(false);
  });

  it('should include install-pnpm step when pnpm is not installed', () => {
    const detect = createPassingDetect();
    detect.checks.pnpm.passed = false;
    const plan = generatePlan(detect, createDarwinEnv());
    expect(plan.steps.some((s) => s.id === 'install-pnpm')).toBe(true);
  });

  // OS-specific
  it('should prefix install commands with sudo on Linux', () => {
    const plan = generatePlan(createPassingDetect(), createLinuxEnv());
    const openclawStep = plan.steps.find((s) => s.id === 'install-openclaw');
    expect(openclawStep?.command).toContain('sudo');
  });

  it('should use npm instead of pnpm on Windows for openclaw install', () => {
    const plan = generatePlan(createPassingDetect(), createWindowsEnv());
    const openclawStep = plan.steps.find((s) => s.id === 'install-openclaw');
    expect(openclawStep?.command).toContain('npm install -g openclaw');
  });

  // Proxy
  it('should add proxy config step when GitHub is unreachable', () => {
    const plan = generatePlan(createPassingDetect(), createProxyNeededEnv());
    expect(plan.steps[0].id).toBe('configure-proxy');
  });

  it('should not add proxy config step when both registries are reachable', () => {
    const plan = generatePlan(createPassingDetect(), createDarwinEnv());
    expect(plan.steps.some((s) => s.id === 'configure-proxy')).toBe(false);
  });

  // Risk assessment integration
  it('should report low risk for a healthy environment', () => {
    const plan = generatePlan(createPassingDetect(), createDarwinEnv());
    expect(plan.risks.some((r) => r.level === 'low')).toBe(true);
  });

  it('should report high risk when network is unreachable', () => {
    const detect = createPassingDetect();
    detect.checks.network.passed = false;
    const plan = generatePlan(detect, createDarwinEnv());
    expect(plan.risks.some((r) => r.level === 'high')).toBe(true);
  });

  // Time estimation
  it('should compute estimatedTime based on steps', () => {
    const detect = createPassingDetect();
    const plan = generatePlan(detect, createDarwinEnv());
    const expected = estimateTime(plan.steps);
    expect(plan.estimatedTime).toBe(expected);
  });

  // All failing
  it('should produce a plan even when all checks fail', () => {
    const plan = generatePlan(createFailingDetect(), createDarwinEnv());
    const result = InstallPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);
    // Should have more steps (including install-pnpm)
    expect(plan.steps.some((s) => s.id === 'install-pnpm')).toBe(true);
    // Should have multiple risks
    expect(plan.risks.length).toBeGreaterThan(1);
  });

  // Always includes required steps
  it('should always include check-node, install-openclaw, configure-openclaw, and verify-installation', () => {
    const plan = generatePlan(createPassingDetect(), createDarwinEnv());
    const ids = plan.steps.map((s) => s.id);
    expect(ids).toContain('check-node');
    expect(ids).toContain('install-openclaw');
    expect(ids).toContain('configure-openclaw');
    expect(ids).toContain('verify-installation');
  });

  // Step ordering: verify-installation should always be last (or second to last if proxy added)
  it('should place verify-installation as the last step', () => {
    const plan = generatePlan(createPassingDetect(), createDarwinEnv());
    const lastStep = plan.steps[plan.steps.length - 1];
    expect(lastStep.id).toBe('verify-installation');
  });

  // Full scenario: Linux without pnpm, GitHub unreachable
  it('should handle complex scenario: Linux + no pnpm + GitHub unreachable', () => {
    const detect = createPassingDetect();
    detect.checks.pnpm.passed = false;
    const env = createLinuxEnv();
    env.network.canAccessGithub = false;
    const plan = generatePlan(detect, env);

    const result = InstallPlanSchema.safeParse(plan);
    expect(result.success).toBe(true);

    // Should have proxy step first
    expect(plan.steps[0].id).toBe('configure-proxy');
    // Should include pnpm install with sudo
    const pnpmStep = plan.steps.find((s) => s.id === 'install-pnpm');
    expect(pnpmStep).toBeDefined();
    expect(pnpmStep!.command).toContain('sudo');
    // Should have GitHub risk
    expect(plan.risks.some((r) => r.description.includes('GitHub'))).toBe(true);
  });
});
