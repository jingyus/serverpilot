/**
 * Tests for environment-based plan adjuster.
 */

import { describe, it, expect } from 'vitest';
import type { EnvironmentInfo, InstallPlan } from '@aiinstaller/shared';
import type { DetectResult } from './detect.js';
import {
  detectLinuxDistro,
  detectMacChip,
  detectWSL,
  analyzePlatform,
  getMacOSSteps,
  getMacOSRisks,
  getLinuxSteps,
  getLinuxRisks,
  getWindowsSteps,
  getWindowsRisks,
  adjustPlanForEnvironment,
} from './env-plan-adjuster.js';

// ============================================================================
// Helpers
// ============================================================================

function createPassingDetect(): DetectResult {
  return {
    ready: true,
    checks: {
      nodeVersion: { passed: true, message: 'Node.js 22.1.0 meets the requirement' },
      pnpm: { passed: true, message: 'pnpm 9.1.0 is installed' },
      network: { passed: true, message: 'npm registry is reachable' },
      permissions: { passed: true, message: 'sudo access is available' },
    },
    summary: 'Environment is ready',
  };
}

function createFailingDetect(): DetectResult {
  return {
    ready: false,
    checks: {
      nodeVersion: { passed: false, message: 'Node.js is not installed' },
      pnpm: { passed: false, message: 'pnpm is not installed' },
      network: { passed: true, message: 'npm registry is reachable' },
      permissions: { passed: true, message: 'sudo access is available' },
    },
    summary: 'Environment is not ready',
  };
}

function createDarwinEnv(overrides?: Partial<EnvironmentInfo>): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '24.0.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0', brew: '4.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    ...overrides,
  };
}

function createDarwinIntelEnv(): EnvironmentInfo {
  return createDarwinEnv({
    os: { platform: 'darwin', version: '24.0.0', arch: 'x86_64' },
  });
}

function createLinuxDebianEnv(): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '6.5.0', arch: 'x86_64' },
    shell: { type: 'bash', version: '5.2' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0', apt: '2.6.1' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: [] },
  };
}

function createLinuxUnknownEnv(): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '6.5.0', arch: 'x86_64' },
    shell: { type: 'bash', version: '5.2' },
    runtime: { node: '22.1.0' },
    packageManagers: { npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: [] },
  };
}

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

function createWSLEnv(): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '5.15.0-microsoft-standard-WSL2', arch: 'x86_64' },
    shell: { type: 'bash', version: '5.1' },
    runtime: { node: '22.1.0' },
    packageManagers: { pnpm: '9.1.0', npm: '10.2.0', apt: '2.6.1' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: [] },
  };
}

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

function createWindowsWSLShellEnv(): EnvironmentInfo {
  return {
    os: { platform: 'win32', version: '10.0.22631', arch: 'x86_64' },
    shell: { type: 'bash', version: '5.1' },
    runtime: { node: '22.1.0' },
    packageManagers: { npm: '10.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: [] },
  };
}

function createBasePlan(): InstallPlan {
  return {
    steps: [
      { id: 'check-node', description: '检查 Node.js', command: 'node --version', timeout: 30_000, canRollback: false, onError: 'abort' },
      { id: 'install-openclaw', description: '安装 OpenClaw', command: 'pnpm install -g openclaw', timeout: 120_000, canRollback: true, onError: 'retry' },
      { id: 'configure-openclaw', description: '配置 OpenClaw', command: 'openclaw login', timeout: 120_000, canRollback: false, onError: 'retry' },
      { id: 'verify-installation', description: '验证安装', command: 'openclaw --version', timeout: 30_000, canRollback: false, onError: 'abort' },
    ],
    estimatedTime: 90_000,
    risks: [{ level: 'low', description: 'Environment looks good.' }],
  };
}

// ============================================================================
// detectLinuxDistro
// ============================================================================

describe('detectLinuxDistro', () => {
  it('should return "debian" when apt is available', () => {
    expect(detectLinuxDistro(createLinuxDebianEnv())).toBe('debian');
  });

  it('should return "unknown" when no recognized package manager is found', () => {
    expect(detectLinuxDistro(createLinuxUnknownEnv())).toBe('unknown');
  });
});

// ============================================================================
// detectMacChip
// ============================================================================

describe('detectMacChip', () => {
  it('should return "apple-silicon" for arm64 architecture', () => {
    expect(detectMacChip(createDarwinEnv())).toBe('apple-silicon');
  });

  it('should return "intel" for x86_64 architecture', () => {
    expect(detectMacChip(createDarwinIntelEnv())).toBe('intel');
  });
});

// ============================================================================
// detectWSL
// ============================================================================

describe('detectWSL', () => {
  it('should detect WSL from linux with "microsoft" in version', () => {
    expect(detectWSL(createWSLEnv())).toBe(true);
  });

  it('should detect WSL from win32 with bash shell', () => {
    expect(detectWSL(createWindowsWSLShellEnv())).toBe(true);
  });

  it('should return false for regular Linux', () => {
    expect(detectWSL(createLinuxDebianEnv())).toBe(false);
  });

  it('should return false for regular macOS', () => {
    expect(detectWSL(createDarwinEnv())).toBe(false);
  });

  it('should return false for native Windows with PowerShell', () => {
    expect(detectWSL(createWindowsEnv())).toBe(false);
  });
});

// ============================================================================
// analyzePlatform
// ============================================================================

describe('analyzePlatform', () => {
  it('should analyze macOS Apple Silicon correctly', () => {
    const result = analyzePlatform(createDarwinEnv());
    expect(result.platform).toBe('darwin');
    expect(result.macChip).toBe('apple-silicon');
    expect(result.hasHomebrew).toBe(true);
    expect(result.isWSL).toBe(false);
  });

  it('should analyze macOS Intel correctly', () => {
    const result = analyzePlatform(createDarwinIntelEnv());
    expect(result.macChip).toBe('intel');
  });

  it('should analyze Debian Linux correctly', () => {
    const result = analyzePlatform(createLinuxDebianEnv());
    expect(result.platform).toBe('linux');
    expect(result.linuxDistro).toBe('debian');
    expect(result.hasApt).toBe(true);
    expect(result.isWSL).toBe(false);
  });

  it('should analyze WSL correctly', () => {
    const result = analyzePlatform(createWSLEnv());
    expect(result.platform).toBe('linux');
    expect(result.isWSL).toBe(true);
  });

  it('should analyze Windows correctly', () => {
    const result = analyzePlatform(createWindowsEnv());
    expect(result.platform).toBe('win32');
    expect(result.isWSL).toBe(false);
    expect(result.hasHomebrew).toBe(false);
  });
});

// ============================================================================
// getMacOSSteps
// ============================================================================

describe('getMacOSSteps', () => {
  it('should add Homebrew Node install step when Node is missing and brew is available', () => {
    const detect = createFailingDetect();
    const env = createDarwinEnv();
    const analysis = analyzePlatform(env);
    const steps = getMacOSSteps(detect, env, analysis);

    expect(steps.some((s) => s.id === 'install-node-brew')).toBe(true);
    expect(steps.find((s) => s.id === 'install-node-brew')!.command).toContain('brew install node@22');
  });

  it('should add arm64 Homebrew path step on Apple Silicon when Node is missing', () => {
    const detect = createFailingDetect();
    const env = createDarwinEnv();
    const analysis = analyzePlatform(env);
    const steps = getMacOSSteps(detect, env, analysis);

    expect(steps.some((s) => s.id === 'setup-brew-path-arm64')).toBe(true);
  });

  it('should not add arm64 path step on Intel Mac', () => {
    const detect = createFailingDetect();
    const env = createDarwinIntelEnv();
    env.packageManagers.brew = '4.2.0';
    const analysis = analyzePlatform(env);
    const steps = getMacOSSteps(detect, env, analysis);

    expect(steps.some((s) => s.id === 'setup-brew-path-arm64')).toBe(false);
  });

  it('should add corepack step when pnpm is missing and brew is available', () => {
    const detect = createFailingDetect();
    const env = createDarwinEnv();
    const analysis = analyzePlatform(env);
    const steps = getMacOSSteps(detect, env, analysis);

    expect(steps.some((s) => s.id === 'enable-corepack-macos')).toBe(true);
  });

  it('should return empty array when everything is already installed', () => {
    const detect = createPassingDetect();
    const env = createDarwinEnv();
    const analysis = analyzePlatform(env);
    const steps = getMacOSSteps(detect, env, analysis);

    expect(steps).toHaveLength(0);
  });

  it('should not add brew steps when Homebrew is not available', () => {
    const detect = createFailingDetect();
    const env = createDarwinEnv({ packageManagers: { npm: '10.2.0' } });
    const analysis = analyzePlatform(env);
    const steps = getMacOSSteps(detect, env, analysis);

    expect(steps.some((s) => s.id === 'install-node-brew')).toBe(false);
    expect(steps.some((s) => s.id === 'enable-corepack-macos')).toBe(false);
  });
});

// ============================================================================
// getMacOSRisks
// ============================================================================

describe('getMacOSRisks', () => {
  it('should flag Rosetta risk on Apple Silicon', () => {
    const analysis = analyzePlatform(createDarwinEnv());
    const risks = getMacOSRisks(analysis);

    expect(risks.some((r) => r.description.includes('Apple Silicon'))).toBe(true);
  });

  it('should return no risks on Intel Mac', () => {
    const analysis = analyzePlatform(createDarwinIntelEnv());
    const risks = getMacOSRisks(analysis);

    expect(risks).toHaveLength(0);
  });
});

// ============================================================================
// getLinuxSteps
// ============================================================================

describe('getLinuxSteps', () => {
  it('should add apt-based Node install step when Node is missing on Debian', () => {
    const detect = createFailingDetect();
    const env = createLinuxDebianEnv();
    const analysis = analyzePlatform(env);
    const steps = getLinuxSteps(detect, env, analysis);

    expect(steps.some((s) => s.id === 'install-node-apt')).toBe(true);
    const aptStep = steps.find((s) => s.id === 'install-node-apt')!;
    expect(aptStep.command).toContain('apt-get');
    expect(aptStep.command).toContain('sudo');
  });

  it('should add build-essential step on Debian', () => {
    const detect = createPassingDetect();
    const env = createLinuxDebianEnv();
    const analysis = analyzePlatform(env);
    const steps = getLinuxSteps(detect, env, analysis);

    expect(steps.some((s) => s.id === 'install-build-essential')).toBe(true);
  });

  it('should not use sudo prefix when sudo is not available', () => {
    const detect = createFailingDetect();
    const env = createLinuxNoSudoEnv();
    // Manually set apt for this test
    env.packageManagers.apt = '2.6.1';
    const analysis = analyzePlatform(env);
    const steps = getLinuxSteps(detect, env, analysis);

    const aptStep = steps.find((s) => s.id === 'install-node-apt');
    expect(aptStep).toBeDefined();
    expect(aptStep!.command).not.toContain('sudo');
  });

  it('should return empty array when everything is installed on unknown distro', () => {
    const detect = createPassingDetect();
    const env = createLinuxUnknownEnv();
    const analysis = analyzePlatform(env);
    const steps = getLinuxSteps(detect, env, analysis);

    expect(steps).toHaveLength(0);
  });
});

// ============================================================================
// getLinuxRisks
// ============================================================================

describe('getLinuxRisks', () => {
  it('should flag unknown distro risk', () => {
    const analysis = analyzePlatform(createLinuxUnknownEnv());
    const risks = getLinuxRisks(analysis, createLinuxUnknownEnv());

    expect(risks.some((r) => r.description.includes('Unknown Linux distribution'))).toBe(true);
  });

  it('should flag no-sudo risk when sudo is unavailable', () => {
    const env = createLinuxNoSudoEnv();
    const analysis = analyzePlatform(env);
    const risks = getLinuxRisks(analysis, env);

    expect(risks.some((r) => r.level === 'high' && r.description.includes('sudo'))).toBe(true);
  });

  it('should return no risks for Debian with sudo', () => {
    const env = createLinuxDebianEnv();
    const analysis = analyzePlatform(env);
    const risks = getLinuxRisks(analysis, env);

    expect(risks).toHaveLength(0);
  });
});

// ============================================================================
// getWindowsSteps
// ============================================================================

describe('getWindowsSteps', () => {
  it('should add WSL verification step for WSL environment', () => {
    const detect = createPassingDetect();
    const env = createWSLEnv();
    const analysis = analyzePlatform(env);
    const steps = getWindowsSteps(detect, env, analysis);

    expect(steps.some((s) => s.id === 'verify-wsl')).toBe(true);
  });

  it('should add winget Node install step on native Windows when Node is missing', () => {
    const detect = createFailingDetect();
    const env = createWindowsEnv();
    const analysis = analyzePlatform(env);
    const steps = getWindowsSteps(detect, env, analysis);

    expect(steps.some((s) => s.id === 'install-node-windows')).toBe(true);
    expect(steps.find((s) => s.id === 'install-node-windows')!.command).toContain('winget');
  });

  it('should not add winget step when Node is already installed', () => {
    const detect = createPassingDetect();
    const env = createWindowsEnv();
    const analysis = analyzePlatform(env);
    const steps = getWindowsSteps(detect, env, analysis);

    expect(steps.some((s) => s.id === 'install-node-windows')).toBe(false);
  });

  it('should not add winget step for WSL even if Node is missing', () => {
    const detect = createFailingDetect();
    const env = createWSLEnv();
    const analysis = analyzePlatform(env);
    const steps = getWindowsSteps(detect, env, analysis);

    // WSL should get verify-wsl but not install-node-windows
    expect(steps.some((s) => s.id === 'install-node-windows')).toBe(false);
  });
});

// ============================================================================
// getWindowsRisks
// ============================================================================

describe('getWindowsRisks', () => {
  it('should flag WSL detection as low risk', () => {
    const analysis = analyzePlatform(createWSLEnv());
    const risks = getWindowsRisks(analysis);

    expect(risks.some((r) => r.level === 'low' && r.description.includes('WSL'))).toBe(true);
  });

  it('should flag native Windows as medium risk', () => {
    const analysis = analyzePlatform(createWindowsEnv());
    const risks = getWindowsRisks(analysis);

    expect(risks.some((r) => r.level === 'medium' && r.description.includes('Native Windows'))).toBe(true);
  });
});

// ============================================================================
// adjustPlanForEnvironment
// ============================================================================

describe('adjustPlanForEnvironment', () => {
  it('should return a plan with all required fields', () => {
    const plan = createBasePlan();
    const adjusted = adjustPlanForEnvironment(plan, createPassingDetect(), createDarwinEnv());

    expect(adjusted.steps).toBeDefined();
    expect(adjusted.estimatedTime).toBeDefined();
    expect(adjusted.risks).toBeDefined();
  });

  it('should not modify the original plan object', () => {
    const plan = createBasePlan();
    const originalStepCount = plan.steps.length;
    adjustPlanForEnvironment(plan, createFailingDetect(), createDarwinEnv());

    expect(plan.steps.length).toBe(originalStepCount);
  });

  // macOS integration
  it('should add macOS-specific steps when Node is missing on macOS', () => {
    const plan = createBasePlan();
    const detect = createFailingDetect();
    const env = createDarwinEnv();
    const adjusted = adjustPlanForEnvironment(plan, detect, env);

    expect(adjusted.steps.some((s) => s.id === 'install-node-brew')).toBe(true);
  });

  it('should insert macOS steps after check-node', () => {
    const plan = createBasePlan();
    const detect = createFailingDetect();
    const env = createDarwinEnv();
    const adjusted = adjustPlanForEnvironment(plan, detect, env);

    const checkNodeIndex = adjusted.steps.findIndex((s) => s.id === 'check-node');
    const brewIndex = adjusted.steps.findIndex((s) => s.id === 'install-node-brew');
    expect(brewIndex).toBeGreaterThan(checkNodeIndex);
    expect(brewIndex).toBe(checkNodeIndex + 1);
  });

  it('should add Apple Silicon risk on arm64 macOS', () => {
    const plan = createBasePlan();
    const adjusted = adjustPlanForEnvironment(plan, createPassingDetect(), createDarwinEnv());

    expect(adjusted.risks.some((r) => r.description.includes('Apple Silicon'))).toBe(true);
  });

  // Linux integration
  it('should add Linux-specific steps on Debian when Node is missing', () => {
    const plan = createBasePlan();
    const detect = createFailingDetect();
    const env = createLinuxDebianEnv();
    const adjusted = adjustPlanForEnvironment(plan, detect, env);

    expect(adjusted.steps.some((s) => s.id === 'install-node-apt')).toBe(true);
  });

  it('should add build-essential step on Debian Linux', () => {
    const plan = createBasePlan();
    const adjusted = adjustPlanForEnvironment(plan, createPassingDetect(), createLinuxDebianEnv());

    expect(adjusted.steps.some((s) => s.id === 'install-build-essential')).toBe(true);
  });

  it('should add unknown distro risk for unrecognized Linux', () => {
    const plan = createBasePlan();
    const adjusted = adjustPlanForEnvironment(plan, createPassingDetect(), createLinuxUnknownEnv());

    expect(adjusted.risks.some((r) => r.description.includes('Unknown Linux distribution'))).toBe(true);
  });

  // WSL integration
  it('should treat WSL as Windows-like and add WSL verification step', () => {
    const plan = createBasePlan();
    const detect = createPassingDetect();
    const env = createWSLEnv();
    const adjusted = adjustPlanForEnvironment(plan, detect, env);

    expect(adjusted.steps.some((s) => s.id === 'verify-wsl')).toBe(true);
  });

  it('should add WSL risk for WSL environment', () => {
    const plan = createBasePlan();
    const adjusted = adjustPlanForEnvironment(plan, createPassingDetect(), createWSLEnv());

    expect(adjusted.risks.some((r) => r.description.includes('WSL'))).toBe(true);
  });

  // Windows integration
  it('should add Windows-specific steps on native Windows', () => {
    const plan = createBasePlan();
    const detect = createFailingDetect();
    const env = createWindowsEnv();
    const adjusted = adjustPlanForEnvironment(plan, detect, env);

    expect(adjusted.steps.some((s) => s.id === 'install-node-windows')).toBe(true);
  });

  it('should add native Windows risk', () => {
    const plan = createBasePlan();
    const adjusted = adjustPlanForEnvironment(plan, createPassingDetect(), createWindowsEnv());

    expect(adjusted.risks.some((r) => r.description.includes('Native Windows'))).toBe(true);
  });

  // Time recalculation
  it('should recalculate estimated time when steps are added', () => {
    const plan = createBasePlan();
    const detect = createFailingDetect();
    const env = createDarwinEnv();
    const adjusted = adjustPlanForEnvironment(plan, detect, env);

    // More steps means more estimated time
    expect(adjusted.estimatedTime).toBeGreaterThan(plan.estimatedTime);
  });

  it('should not change estimated time when no platform steps are added', () => {
    const plan = createBasePlan();
    const detect = createPassingDetect();
    const env = createDarwinIntelEnv();
    env.packageManagers.brew = '4.2.0';
    const adjusted = adjustPlanForEnvironment(plan, detect, env);

    // No new steps, time should be recalculated from the same steps
    const expectedTime = plan.steps.reduce((t, s) => t + s.timeout * 0.3, 0);
    expect(adjusted.estimatedTime).toBe(expectedTime);
  });

  // Risk deduplication
  it('should not duplicate risks that already exist in the plan', () => {
    const plan = createBasePlan();
    plan.risks = [{ level: 'low', description: 'WSL detected. Installation will proceed in Linux mode within WSL.' }];
    const adjusted = adjustPlanForEnvironment(plan, createPassingDetect(), createWSLEnv());

    const wslRisks = adjusted.risks.filter((r) => r.description.includes('WSL'));
    expect(wslRisks).toHaveLength(1);
  });

  // Edge case: plan without check-node step
  it('should insert platform steps at index 0 if check-node is not found', () => {
    const plan: InstallPlan = {
      steps: [
        { id: 'install-openclaw', description: '安装', command: 'pnpm install -g openclaw', timeout: 120_000, canRollback: true, onError: 'retry' },
      ],
      estimatedTime: 36_000,
      risks: [],
    };
    const detect = createFailingDetect();
    const env = createDarwinEnv();
    const adjusted = adjustPlanForEnvironment(plan, detect, env);

    // Platform steps should be at the beginning
    expect(adjusted.steps[0].id).not.toBe('install-openclaw');
  });
});
