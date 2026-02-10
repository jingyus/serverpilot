/**
 * Acceptance test: AI 能生成适合当前环境的安装计划（至少 3 个步骤）
 *
 * Verifies that the system generates environment-appropriate installation plans
 * with at least 3 steps for macOS, Linux, and Windows environments,
 * covering both AI-powered and fallback plan generation paths.
 *
 * @module tests/plan-generation-acceptance
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateInstallPlan, generateFallbackPlan } from '../packages/server/src/ai/planner.js';
import { getPresetInstallPlan } from '../packages/server/src/ai/fault-tolerance.js';
import type { EnvironmentInfo, InstallPlan } from '@aiinstaller/shared';
import { InstallPlanSchema } from '@aiinstaller/shared';
import type { InstallAIAgent } from '../packages/server/src/ai/agent.js';

// ============================================================================
// Test Environment Fixtures
// ============================================================================

/** macOS environment with Homebrew + pnpm */
const macOSEnvironment: EnvironmentInfo = {
  os: { platform: 'darwin', version: '14.0.0', arch: 'arm64' },
  shell: { type: 'zsh', version: '5.9' },
  runtime: { node: '20.10.0', python: '3.12.0' },
  packageManagers: { npm: '10.2.0', pnpm: '8.14.0', yarn: null, brew: '4.0.0', apt: null },
  network: { canAccessNpm: true, canAccessGithub: true },
  permissions: { hasSudo: true, canWriteTo: ['/usr/local/bin'] },
};

/** Linux (Ubuntu) environment with apt + npm */
const linuxEnvironment: EnvironmentInfo = {
  os: { platform: 'linux', version: '22.04', arch: 'x64' },
  shell: { type: 'bash', version: '5.1' },
  runtime: { node: '18.19.0', python: '3.10.0' },
  packageManagers: { npm: '10.0.0', pnpm: null, yarn: null, brew: null, apt: '2.4.0' },
  network: { canAccessNpm: true, canAccessGithub: true },
  permissions: { hasSudo: true, canWriteTo: ['/usr/local/bin', '/home/user'] },
};

/** Windows environment with npm only */
const windowsEnvironment: EnvironmentInfo = {
  os: { platform: 'win32', version: '10.0.22621', arch: 'x64' },
  shell: { type: 'powershell', version: '7.3' },
  runtime: { node: '20.10.0', python: null },
  packageManagers: { npm: '10.2.0', pnpm: null, yarn: null, brew: null, apt: null },
  network: { canAccessNpm: true, canAccessGithub: true },
  permissions: { hasSudo: false, canWriteTo: ['C:\\Users\\test'] },
};

/** Minimal environment with no package managers */
const minimalEnvironment: EnvironmentInfo = {
  os: { platform: 'linux', version: '22.04', arch: 'x64' },
  shell: { type: 'bash', version: '5.1' },
  runtime: { node: null, python: null },
  packageManagers: { npm: null, pnpm: null, yarn: null, brew: null, apt: null },
  network: { canAccessNpm: false, canAccessGithub: false },
  permissions: { hasSudo: false, canWriteTo: [] },
};

/** Helper: create a mock AI plan with N steps for the given environment */
function createMockAIPlan(env: EnvironmentInfo, software: string, stepCount: number): InstallPlan {
  const platform = env.os.platform;
  const steps: InstallPlan['steps'] = [];

  steps.push({
    id: 'check-prerequisites',
    description: 'Check system prerequisites',
    command: 'node --version && npm --version',
    expectedOutput: 'v',
    timeout: 5000,
    canRollback: false,
    onError: 'abort',
  });

  if (platform === 'darwin' && env.packageManagers.brew) {
    steps.push({
      id: 'update-brew',
      description: 'Update Homebrew',
      command: 'brew update',
      timeout: 60000,
      canRollback: false,
      onError: 'skip',
    });
    steps.push({
      id: 'install',
      description: `Install ${software} via Homebrew`,
      command: `brew install ${software}`,
      timeout: 120000,
      canRollback: true,
      onError: 'fallback',
    });
  } else if (platform === 'linux' && env.packageManagers.apt) {
    steps.push({
      id: 'update-apt',
      description: 'Update package lists',
      command: 'sudo apt-get update',
      timeout: 60000,
      canRollback: false,
      onError: 'skip',
    });
    steps.push({
      id: 'install',
      description: `Install ${software} via apt`,
      command: `sudo apt-get install -y ${software}`,
      timeout: 120000,
      canRollback: true,
      onError: 'abort',
    });
  } else {
    steps.push({
      id: 'install-deps',
      description: 'Install dependencies',
      command: `npm install -g ${software}`,
      timeout: 120000,
      canRollback: true,
      onError: 'retry',
    });
  }

  steps.push({
    id: 'verify',
    description: `Verify ${software} installation`,
    command: `${software} --version`,
    expectedOutput: '.',
    timeout: 5000,
    canRollback: false,
    onError: 'skip',
  });

  // Add extra steps if needed
  while (steps.length < stepCount) {
    steps.push({
      id: `extra-step-${steps.length}`,
      description: `Post-install configuration step ${steps.length}`,
      command: `echo "Configuring ${software}"`,
      timeout: 5000,
      canRollback: false,
      onError: 'skip',
    });
  }

  return {
    steps,
    estimatedTime: steps.reduce((sum, s) => sum + s.timeout, 0),
    risks: [{ level: 'low', description: 'Network connectivity required' }],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('验收: AI 能生成适合当前环境的安装计划（至少 3 个步骤）', () => {
  // --------------------------------------------------------------------------
  // AI-powered plan generation (via mock agent)
  // --------------------------------------------------------------------------
  describe('AI-powered plan generation', () => {
    let mockAgent: InstallAIAgent;

    describe('macOS environment', () => {
      beforeEach(() => {
        const plan = createMockAIPlan(macOSEnvironment, 'openclaw', 4);
        mockAgent = {
          generateInstallPlanStreaming: vi.fn().mockResolvedValue({
            success: true,
            data: plan,
          }),
        } as unknown as InstallAIAgent;
      });

      it('should generate a plan with at least 3 steps', async () => {
        const plan = await generateInstallPlan(mockAgent, macOSEnvironment, 'openclaw');
        expect(plan).not.toBeNull();
        expect(plan!.steps.length).toBeGreaterThanOrEqual(3);
      });

      it('should include macOS-specific commands (brew)', async () => {
        const plan = await generateInstallPlan(mockAgent, macOSEnvironment, 'openclaw');
        expect(plan).not.toBeNull();
        const commands = plan!.steps.map(s => s.command);
        expect(commands.some(c => c.includes('brew'))).toBe(true);
      });

      it('should include prerequisite check and verification steps', async () => {
        const plan = await generateInstallPlan(mockAgent, macOSEnvironment, 'openclaw');
        expect(plan).not.toBeNull();
        expect(plan!.steps.some(s => s.id.includes('check') || s.id.includes('prereq'))).toBe(true);
        expect(plan!.steps.some(s => s.id === 'verify')).toBe(true);
      });
    });

    describe('Linux environment', () => {
      beforeEach(() => {
        const plan = createMockAIPlan(linuxEnvironment, 'openclaw', 4);
        mockAgent = {
          generateInstallPlanStreaming: vi.fn().mockResolvedValue({
            success: true,
            data: plan,
          }),
        } as unknown as InstallAIAgent;
      });

      it('should generate a plan with at least 3 steps', async () => {
        const plan = await generateInstallPlan(mockAgent, linuxEnvironment, 'openclaw');
        expect(plan).not.toBeNull();
        expect(plan!.steps.length).toBeGreaterThanOrEqual(3);
      });

      it('should include Linux-specific commands (apt)', async () => {
        const plan = await generateInstallPlan(mockAgent, linuxEnvironment, 'openclaw');
        expect(plan).not.toBeNull();
        const commands = plan!.steps.map(s => s.command);
        expect(commands.some(c => c.includes('apt'))).toBe(true);
      });
    });

    describe('Windows environment', () => {
      beforeEach(() => {
        const plan = createMockAIPlan(windowsEnvironment, 'openclaw', 4);
        mockAgent = {
          generateInstallPlanStreaming: vi.fn().mockResolvedValue({
            success: true,
            data: plan,
          }),
        } as unknown as InstallAIAgent;
      });

      it('should generate a plan with at least 3 steps', async () => {
        const plan = await generateInstallPlan(mockAgent, windowsEnvironment, 'openclaw');
        expect(plan).not.toBeNull();
        expect(plan!.steps.length).toBeGreaterThanOrEqual(3);
      });

      it('should use npm for Windows (no brew/apt)', async () => {
        const plan = await generateInstallPlan(mockAgent, windowsEnvironment, 'openclaw');
        expect(plan).not.toBeNull();
        const commands = plan!.steps.map(s => s.command);
        expect(commands.some(c => c.includes('npm'))).toBe(true);
      });
    });
  });

  // --------------------------------------------------------------------------
  // Fallback plan generation (no AI, planner.ts)
  // --------------------------------------------------------------------------
  describe('Fallback plan generation (generateFallbackPlan)', () => {
    it('should generate at least 3 steps for macOS with Homebrew', () => {
      const plan = generateFallbackPlan(macOSEnvironment, 'openclaw');
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
      expect(plan.steps.some(s => s.command.includes('brew install'))).toBe(true);
      expect(plan.steps.some(s => s.id === 'check-node')).toBe(true);
      expect(plan.steps.some(s => s.id === 'verify')).toBe(true);
    });

    it('should generate at least 3 steps for Linux with npm', () => {
      const plan = generateFallbackPlan(linuxEnvironment, 'openclaw');
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
      expect(plan.steps.some(s => s.command.includes('npm install'))).toBe(true);
    });

    it('should generate at least 3 steps for Windows', () => {
      const plan = generateFallbackPlan(windowsEnvironment, 'openclaw');
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
      expect(plan.steps.some(s => s.command.includes('npm install'))).toBe(true);
    });

    it('should generate at least 3 steps for minimal environment', () => {
      const plan = generateFallbackPlan(minimalEnvironment, 'openclaw');
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
    });

    it('should have correct step structure with required fields', () => {
      const plan = generateFallbackPlan(macOSEnvironment, 'openclaw');
      for (const step of plan.steps) {
        expect(step.id).toBeDefined();
        expect(typeof step.id).toBe('string');
        expect(step.description).toBeDefined();
        expect(typeof step.description).toBe('string');
        expect(step.command).toBeDefined();
        expect(typeof step.command).toBe('string');
        expect(typeof step.timeout).toBe('number');
        expect(step.timeout).toBeGreaterThan(0);
        expect(typeof step.canRollback).toBe('boolean');
        expect(['retry', 'skip', 'abort', 'fallback']).toContain(step.onError);
      }
    });

    it('should include estimated time and risks', () => {
      const plan = generateFallbackPlan(macOSEnvironment, 'openclaw');
      expect(plan.estimatedTime).toBeGreaterThan(0);
      expect(plan.risks).toBeDefined();
      expect(plan.risks.length).toBeGreaterThan(0);
    });

    it('should use pnpm when brew is unavailable but pnpm is present', () => {
      const envWithPnpmOnly: EnvironmentInfo = {
        ...macOSEnvironment,
        packageManagers: { npm: '10.0.0', pnpm: '8.14.0', yarn: null, brew: null, apt: null },
      };
      const plan = generateFallbackPlan(envWithPnpmOnly, 'test-pkg');
      expect(plan.steps.some(s => s.command.includes('pnpm install'))).toBe(true);
    });

    it('should support version parameter in install commands', () => {
      const plan = generateFallbackPlan(macOSEnvironment, 'openclaw', '2.0.0');
      // Verify version is reflected when using npm/pnpm path
      const envNoBrew: EnvironmentInfo = {
        ...macOSEnvironment,
        packageManagers: { npm: '10.0.0', pnpm: '8.14.0', yarn: null, brew: null, apt: null },
      };
      const planVersioned = generateFallbackPlan(envNoBrew, 'openclaw', '2.0.0');
      const installStep = planVersioned.steps.find(s => s.id.includes('install'));
      expect(installStep?.command).toContain('2.0.0');
    });
  });

  // --------------------------------------------------------------------------
  // Preset plan generation (fault-tolerance.ts)
  // --------------------------------------------------------------------------
  describe('Preset plan generation (getPresetInstallPlan)', () => {
    it('should generate at least 3 steps for macOS with pnpm (prioritized over brew)', () => {
      const plan = getPresetInstallPlan(macOSEnvironment, 'openclaw');
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
      // getPresetInstallPlan prioritizes pnpm over brew
      expect(plan.steps.some(s => s.command.includes('pnpm install'))).toBe(true);
    });

    it('should generate at least 3 steps for macOS with brew only', () => {
      const macBrewOnly: EnvironmentInfo = {
        ...macOSEnvironment,
        packageManagers: { npm: null, pnpm: null, yarn: null, brew: '4.0.0', apt: null },
      };
      const plan = getPresetInstallPlan(macBrewOnly, 'openclaw');
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
      expect(plan.steps.some(s => s.command.includes('brew install'))).toBe(true);
    });

    it('should generate at least 3 steps for Linux with apt', () => {
      const plan = getPresetInstallPlan(linuxEnvironment, 'openclaw');
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
      expect(plan.steps.some(s => s.command.includes('apt-get'))).toBe(true);
    });

    it('should generate at least 3 steps for Windows with npm', () => {
      const plan = getPresetInstallPlan(windowsEnvironment, 'openclaw');
      expect(plan.steps.length).toBeGreaterThanOrEqual(3);
      expect(plan.steps.some(s => s.command.includes('npm install'))).toBe(true);
    });

    it('should include prerequisite check step', () => {
      const plan = getPresetInstallPlan(macOSEnvironment, 'openclaw');
      expect(plan.steps.some(s => s.id === 'check-prerequisites')).toBe(true);
    });

    it('should include verification step', () => {
      const plan = getPresetInstallPlan(macOSEnvironment, 'openclaw');
      expect(plan.steps.some(s => s.id === 'verify')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Environment adaptation verification
  // --------------------------------------------------------------------------
  describe('Environment adaptation', () => {
    it('macOS with brew should use brew install, not apt or npm', () => {
      const plan = generateFallbackPlan(macOSEnvironment, 'openclaw');
      const installStep = plan.steps.find(s => s.id.includes('brew') || s.description.includes('Homebrew'));
      expect(installStep).toBeDefined();
      expect(installStep!.command).toContain('brew install');
      expect(installStep!.command).not.toContain('apt');
    });

    it('Linux with apt should use apt-get, not brew', () => {
      const linuxAptEnv: EnvironmentInfo = {
        ...linuxEnvironment,
        packageManagers: { npm: null, pnpm: null, yarn: null, brew: null, apt: '2.4.0' },
      };
      const plan = getPresetInstallPlan(linuxAptEnv, 'openclaw');
      const installStep = plan.steps.find(s => s.id === 'install');
      expect(installStep).toBeDefined();
      expect(installStep!.command).toContain('apt-get');
      expect(installStep!.command).not.toContain('brew');
    });

    it('should adapt to different architectures', () => {
      const macIntelEnv: EnvironmentInfo = {
        ...macOSEnvironment,
        os: { platform: 'darwin', version: '14.0.0', arch: 'x64' },
      };
      const planArm = generateFallbackPlan(macOSEnvironment, 'openclaw');
      const planIntel = generateFallbackPlan(macIntelEnv, 'openclaw');

      // Both should generate valid plans with at least 3 steps
      expect(planArm.steps.length).toBeGreaterThanOrEqual(3);
      expect(planIntel.steps.length).toBeGreaterThanOrEqual(3);
    });
  });

  // --------------------------------------------------------------------------
  // AI fallback behavior
  // --------------------------------------------------------------------------
  describe('AI failure fallback', () => {
    it('should fall back to generateFallbackPlan when AI returns null', async () => {
      const mockAgent: InstallAIAgent = {
        generateInstallPlanStreaming: vi.fn().mockResolvedValue({
          success: false,
          error: 'AI service unavailable',
        }),
      } as unknown as InstallAIAgent;

      const plan = await generateInstallPlan(mockAgent, macOSEnvironment, 'openclaw');
      // generateInstallPlan returns null on failure, caller should use fallback
      expect(plan).toBeNull();

      // Verify fallback produces at least 3 steps
      const fallback = generateFallbackPlan(macOSEnvironment, 'openclaw');
      expect(fallback.steps.length).toBeGreaterThanOrEqual(3);
    });

    it('should fall back to generateFallbackPlan when AI throws', async () => {
      const mockAgent: InstallAIAgent = {
        generateInstallPlanStreaming: vi.fn().mockRejectedValue(new Error('Network error')),
      } as unknown as InstallAIAgent;

      const plan = await generateInstallPlan(mockAgent, macOSEnvironment, 'openclaw');
      expect(plan).toBeNull();

      // Verify fallback is valid
      const fallback = generateFallbackPlan(macOSEnvironment, 'openclaw');
      expect(fallback.steps.length).toBeGreaterThanOrEqual(3);
    });
  });

  // --------------------------------------------------------------------------
  // Plan schema validation
  // --------------------------------------------------------------------------
  describe('Plan schema compliance', () => {
    it('fallback plan should pass InstallPlan schema validation', () => {
      const plan = generateFallbackPlan(macOSEnvironment, 'openclaw');
      const result = InstallPlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
    });

    it('preset plan should pass InstallPlan schema validation', () => {
      const plan = getPresetInstallPlan(linuxEnvironment, 'openclaw');
      const result = InstallPlanSchema.safeParse(plan);
      expect(result.success).toBe(true);
    });

    it('all step IDs should be unique within a plan', () => {
      const plan = generateFallbackPlan(macOSEnvironment, 'openclaw');
      const ids = plan.steps.map(s => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });
});
