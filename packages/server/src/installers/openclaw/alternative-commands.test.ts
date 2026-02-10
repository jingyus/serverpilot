/**
 * Tests for alternative commands module.
 */

import { describe, it, expect } from 'vitest';
import type { EnvironmentInfo, InstallStep } from '@aiinstaller/shared';
import {
  generateAlternatives,
  generateAllAlternatives,
  getBestAlternative,
  getAlternativeById,
  registerAlternative,
  getAlternativeCount,
  filterAlternatives,
  adjustConfidence,
  normalizeCommand,
  type AlternativeCommand,
  type StepAlternatives,
} from './alternative-commands.js';
import {
  createCheckNodeStep,
  createInstallPnpmStep,
  createInstallOpenClawStep,
  createConfigureOpenClawStep,
  createVerifyInstallationStep,
  ALL_STEPS,
} from './steps.js';

// ============================================================================
// Test fixtures
// ============================================================================

function makeMacEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '14.0', arch: 'arm64' },
    shell: { type: 'zsh', version: '5.9' },
    runtime: { node: '22.1.0' },
    packageManagers: { npm: '10.0.0', brew: '4.2.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    ...overrides,
  };
}

function makeLinuxEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'linux', version: '5.15.0', arch: 'x64' },
    shell: { type: 'bash', version: '5.1' },
    runtime: { node: '22.1.0' },
    packageManagers: { npm: '10.0.0', apt: '2.4.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: true, canWriteTo: ['/usr/local'] },
    ...overrides,
  };
}

function makeWindowsEnv(overrides: Partial<EnvironmentInfo> = {}): EnvironmentInfo {
  return {
    os: { platform: 'win32', version: '10.0.22621', arch: 'x64' },
    shell: { type: 'powershell', version: '7.3' },
    runtime: { node: '22.1.0' },
    packageManagers: { npm: '10.0.0' },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: false, canWriteTo: ['C:\\Users\\test'] },
    ...overrides,
  };
}

// ============================================================================
// normalizeCommand
// ============================================================================

describe('normalizeCommand', () => {
  it('trims whitespace', () => {
    expect(normalizeCommand('  node --version  ')).toBe('node --version');
  });

  it('collapses consecutive spaces', () => {
    expect(normalizeCommand('node   --version')).toBe('node --version');
  });

  it('handles already normalized commands', () => {
    expect(normalizeCommand('npm install -g pnpm')).toBe('npm install -g pnpm');
  });
});

// ============================================================================
// filterAlternatives
// ============================================================================

describe('filterAlternatives', () => {
  const sampleAlternatives: AlternativeCommand[] = [
    {
      id: 'alt-mac',
      description: 'macOS only',
      command: 'brew install something',
      confidence: 0.8,
      platforms: ['darwin'],
      requiresSudo: false,
    },
    {
      id: 'alt-sudo',
      description: 'Needs sudo',
      command: 'sudo npm install -g something',
      confidence: 0.7,
      platforms: ['darwin', 'linux'],
      requiresSudo: true,
    },
    {
      id: 'alt-all',
      description: 'All platforms',
      command: 'npx something',
      confidence: 0.6,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    },
  ];

  it('filters by platform', () => {
    const env = makeWindowsEnv();
    const filtered = filterAlternatives(sampleAlternatives, env, '');
    const ids = filtered.map((a) => a.id);
    expect(ids).not.toContain('alt-mac');
    expect(ids).toContain('alt-all');
  });

  it('filters out sudo alternatives when sudo is not available', () => {
    const env = makeLinuxEnv({
      permissions: { hasSudo: false, canWriteTo: [] },
    });
    const filtered = filterAlternatives(sampleAlternatives, env, '');
    const ids = filtered.map((a) => a.id);
    expect(ids).not.toContain('alt-sudo');
  });

  it('keeps sudo alternatives when sudo is available', () => {
    const env = makeLinuxEnv({
      permissions: { hasSudo: true, canWriteTo: [] },
    });
    const filtered = filterAlternatives(sampleAlternatives, env, '');
    const ids = filtered.map((a) => a.id);
    expect(ids).toContain('alt-sudo');
  });

  it('excludes alternatives that duplicate the primary command', () => {
    const env = makeMacEnv();
    const filtered = filterAlternatives(
      sampleAlternatives,
      env,
      'brew install something',
    );
    const ids = filtered.map((a) => a.id);
    expect(ids).not.toContain('alt-mac');
  });

  it('sorts by confidence descending', () => {
    const env = makeMacEnv();
    const filtered = filterAlternatives(sampleAlternatives, env, '');
    for (let i = 1; i < filtered.length; i++) {
      expect(filtered[i - 1].confidence).toBeGreaterThanOrEqual(
        filtered[i].confidence,
      );
    }
  });
});

// ============================================================================
// adjustConfidence
// ============================================================================

describe('adjustConfidence', () => {
  it('boosts brew alternatives when Homebrew is available', () => {
    const alt: AlternativeCommand = {
      id: 'install-pnpm-brew',
      description: 'Brew install',
      command: 'brew install pnpm',
      confidence: 0.75,
      platforms: ['darwin'],
      requiresSudo: false,
    };
    const env = makeMacEnv({ packageManagers: { npm: '10.0.0', brew: '4.2.0' } });
    const [adjusted] = adjustConfidence([alt], env);
    expect(adjusted.confidence).toBeGreaterThan(0.75);
  });

  it('boosts mirror alternatives when npm is unreachable', () => {
    const alt: AlternativeCommand = {
      id: 'install-openclaw-pnpm-mirror',
      description: 'Mirror install',
      command: 'pnpm install -g openclaw --registry https://registry.npmmirror.com',
      confidence: 0.75,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    };
    const env = makeMacEnv({
      network: { canAccessNpm: false, canAccessGithub: true },
    });
    const [adjusted] = adjustConfidence([alt], env);
    expect(adjusted.confidence).toBeGreaterThan(0.75);
  });

  it('penalizes sudo alternatives', () => {
    const alt: AlternativeCommand = {
      id: 'install-pnpm-npm-sudo',
      description: 'Sudo install',
      command: 'sudo npm install -g pnpm',
      confidence: 0.7,
      platforms: ['darwin', 'linux'],
      requiresSudo: true,
    };
    const env = makeMacEnv();
    const [adjusted] = adjustConfidence([alt], env);
    expect(adjusted.confidence).toBeLessThan(0.7);
  });

  it('boosts yarn alternatives when yarn is installed', () => {
    const alt: AlternativeCommand = {
      id: 'install-openclaw-yarn',
      description: 'Yarn install',
      command: 'yarn global add openclaw',
      confidence: 0.6,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    };
    const env = makeMacEnv({ packageManagers: { npm: '10.0.0', yarn: '1.22.0' } });
    const [adjusted] = adjustConfidence([alt], env);
    expect(adjusted.confidence).toBeGreaterThan(0.6);
  });

  it('clamps confidence to [0, 1]', () => {
    const alt: AlternativeCommand = {
      id: 'install-pnpm-brew',
      description: 'Brew install',
      command: 'brew install pnpm',
      confidence: 0.95,
      platforms: ['darwin'],
      requiresSudo: false,
    };
    const env = makeMacEnv({ packageManagers: { npm: '10.0.0', brew: '4.2.0' } });
    const [adjusted] = adjustConfidence([alt], env);
    expect(adjusted.confidence).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// generateAlternatives
// ============================================================================

describe('generateAlternatives', () => {
  it('generates alternatives for check-node step', () => {
    const step = createCheckNodeStep();
    const env = makeMacEnv();
    const result = generateAlternatives(step, env);

    expect(result.stepId).toBe('check-node');
    expect(result.primaryCommand).toBe('node --version');
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it('generates alternatives for install-pnpm step', () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();
    const result = generateAlternatives(step, env);

    expect(result.stepId).toBe('install-pnpm');
    expect(result.alternatives.length).toBeGreaterThan(0);
    // Brew alternative should be included on macOS with Homebrew
    const brewAlt = result.alternatives.find((a) => a.id === 'install-pnpm-brew');
    expect(brewAlt).toBeDefined();
  });

  it('generates alternatives for install-openclaw step', () => {
    const step = createInstallOpenClawStep();
    const env = makeLinuxEnv();
    const result = generateAlternatives(step, env);

    expect(result.stepId).toBe('install-openclaw');
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it('generates alternatives for configure-openclaw step', () => {
    const step = createConfigureOpenClawStep();
    const env = makeMacEnv();
    const result = generateAlternatives(step, env);

    expect(result.stepId).toBe('configure-openclaw');
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it('generates alternatives for verify-installation step', () => {
    const step = createVerifyInstallationStep();
    const env = makeMacEnv();
    const result = generateAlternatives(step, env);

    expect(result.stepId).toBe('verify-installation');
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it('returns alternatives sorted by confidence (descending)', () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();
    const result = generateAlternatives(step, env);

    for (let i = 1; i < result.alternatives.length; i++) {
      expect(result.alternatives[i - 1].confidence).toBeGreaterThanOrEqual(
        result.alternatives[i].confidence,
      );
    }
  });

  it('excludes Windows-only alternatives on macOS', () => {
    const step = createCheckNodeStep();
    const env = makeMacEnv();
    const result = generateAlternatives(step, env);

    const windowsOnly = result.alternatives.find(
      (a) => a.id === 'check-node-where',
    );
    expect(windowsOnly).toBeUndefined();
  });

  it('includes Windows-only alternatives on Windows', () => {
    const step = createCheckNodeStep();
    const env = makeWindowsEnv();
    const result = generateAlternatives(step, env);

    const windowsOnly = result.alternatives.find(
      (a) => a.id === 'check-node-where',
    );
    expect(windowsOnly).toBeDefined();
  });

  it('returns empty alternatives for an unknown step', () => {
    const step: InstallStep = {
      id: 'unknown-step',
      description: 'Unknown step',
      command: 'echo hello',
      timeout: 10000,
      canRollback: false,
      onError: 'abort',
    };
    const env = makeMacEnv();
    const result = generateAlternatives(step, env);

    expect(result.stepId).toBe('unknown-step');
    expect(result.alternatives).toEqual([]);
  });

  it('does not include sudo alternatives when user has no sudo', () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv({
      permissions: { hasSudo: false, canWriteTo: ['/home/user/.local'] },
    });
    const result = generateAlternatives(step, env);

    const sudoAlts = result.alternatives.filter((a) => a.requiresSudo);
    expect(sudoAlts).toHaveLength(0);
  });
});

// ============================================================================
// generateAllAlternatives
// ============================================================================

describe('generateAllAlternatives', () => {
  it('generates alternatives for all steps', () => {
    const env = makeMacEnv();
    const results = generateAllAlternatives(ALL_STEPS, env);

    expect(results).toHaveLength(ALL_STEPS.length);
    for (let i = 0; i < results.length; i++) {
      expect(results[i].stepId).toBe(ALL_STEPS[i].id);
    }
  });

  it('each result has a primary command matching the step', () => {
    const env = makeLinuxEnv();
    const results = generateAllAlternatives(ALL_STEPS, env);

    for (let i = 0; i < results.length; i++) {
      expect(results[i].primaryCommand).toBe(ALL_STEPS[i].command);
    }
  });
});

// ============================================================================
// getBestAlternative
// ============================================================================

describe('getBestAlternative', () => {
  it('returns the highest-confidence alternative', () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();
    const best = getBestAlternative(step, env);

    expect(best).not.toBeNull();
    if (best) {
      const allAlts = generateAlternatives(step, env).alternatives;
      for (const alt of allAlts) {
        expect(best.confidence).toBeGreaterThanOrEqual(alt.confidence);
      }
    }
  });

  it('returns null for a step with no alternatives', () => {
    const step: InstallStep = {
      id: 'no-alternatives-step',
      description: 'No alternatives',
      command: 'echo noop',
      timeout: 5000,
      canRollback: false,
      onError: 'abort',
    };
    const env = makeMacEnv();
    const best = getBestAlternative(step, env);

    expect(best).toBeNull();
  });
});

// ============================================================================
// getAlternativeById
// ============================================================================

describe('getAlternativeById', () => {
  it('finds an existing alternative by ID', () => {
    const alt = getAlternativeById('install-pnpm', 'install-pnpm-corepack');
    expect(alt).not.toBeNull();
    expect(alt!.id).toBe('install-pnpm-corepack');
  });

  it('returns null for non-existent alternative ID', () => {
    const alt = getAlternativeById('install-pnpm', 'nonexistent');
    expect(alt).toBeNull();
  });

  it('returns null for non-existent step ID', () => {
    const alt = getAlternativeById('nonexistent-step', 'whatever');
    expect(alt).toBeNull();
  });
});

// ============================================================================
// registerAlternative
// ============================================================================

describe('registerAlternative', () => {
  it('registers a new alternative for an existing step', () => {
    const countBefore = getAlternativeCount('check-node');
    registerAlternative('check-node', {
      id: 'check-node-custom-test',
      description: 'Custom check',
      command: 'node -e "console.log(process.version)"',
      confidence: 0.5,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    });
    const countAfter = getAlternativeCount('check-node');
    expect(countAfter).toBe(countBefore + 1);

    const found = getAlternativeById('check-node', 'check-node-custom-test');
    expect(found).not.toBeNull();
    expect(found!.command).toBe('node -e "console.log(process.version)"');
  });

  it('registers a new alternative for a new step', () => {
    registerAlternative('brand-new-step', {
      id: 'brand-new-alt',
      description: 'Brand new',
      command: 'echo brand new',
      confidence: 0.5,
      platforms: [],
      requiresSudo: false,
    });
    const count = getAlternativeCount('brand-new-step');
    expect(count).toBe(1);
  });

  it('updates an existing alternative with the same ID', () => {
    const countBefore = getAlternativeCount('check-node');
    registerAlternative('check-node', {
      id: 'check-node-custom-test',
      description: 'Updated custom check',
      command: 'node --version --updated',
      confidence: 0.9,
      platforms: ['darwin', 'linux', 'win32'],
      requiresSudo: false,
    });
    const countAfter = getAlternativeCount('check-node');
    // Count should not increase since we're updating
    expect(countAfter).toBe(countBefore);

    const found = getAlternativeById('check-node', 'check-node-custom-test');
    expect(found).not.toBeNull();
    expect(found!.command).toBe('node --version --updated');
    expect(found!.confidence).toBe(0.9);
  });
});

// ============================================================================
// getAlternativeCount
// ============================================================================

describe('getAlternativeCount', () => {
  it('returns correct count for existing steps', () => {
    const count = getAlternativeCount('install-pnpm');
    expect(count).toBeGreaterThan(0);
  });

  it('returns 0 for non-existent step', () => {
    const count = getAlternativeCount('totally-unknown-step-xyz');
    expect(count).toBe(0);
  });
});

// ============================================================================
// Environment-specific integration scenarios
// ============================================================================

describe('environment-specific scenarios', () => {
  it('macOS with Homebrew: brew alternatives are boosted', () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv({ packageManagers: { npm: '10.0.0', brew: '4.2.0' } });
    const result = generateAlternatives(step, env);
    const brewAlt = result.alternatives.find((a) => a.id === 'install-pnpm-brew');

    expect(brewAlt).toBeDefined();
    // Confidence should be boosted above base 0.75
    expect(brewAlt!.confidence).toBeGreaterThan(0.75);
  });

  it('Linux without sudo: sudo alternatives are excluded', () => {
    const step = createInstallOpenClawStep();
    const env = makeLinuxEnv({
      permissions: { hasSudo: false, canWriteTo: ['/home/user/.local'] },
    });
    const result = generateAlternatives(step, env);
    const sudoAlts = result.alternatives.filter((a) => a.requiresSudo);

    expect(sudoAlts).toHaveLength(0);
  });

  it('npm unreachable: mirror alternatives are boosted', () => {
    const step = createInstallOpenClawStep();
    const env = makeLinuxEnv({
      network: { canAccessNpm: false, canAccessGithub: true },
    });
    const result = generateAlternatives(step, env);
    const mirrorAlt = result.alternatives.find(
      (a) => a.id === 'install-openclaw-pnpm-mirror',
    );

    expect(mirrorAlt).toBeDefined();
    expect(mirrorAlt!.confidence).toBeGreaterThan(0.75);
  });

  it('Windows: only Windows-compatible alternatives are returned', () => {
    const step = createInstallPnpmStep();
    const env = makeWindowsEnv();
    const result = generateAlternatives(step, env);

    for (const alt of result.alternatives) {
      expect(alt.platforms).toContain('win32');
    }
  });

  it('yarn installed: yarn alternatives are boosted', () => {
    const step = createInstallOpenClawStep();
    const env = makeMacEnv({
      packageManagers: { npm: '10.0.0', yarn: '1.22.19' },
    });
    const result = generateAlternatives(step, env);
    const yarnAlt = result.alternatives.find(
      (a) => a.id === 'install-openclaw-yarn',
    );

    expect(yarnAlt).toBeDefined();
    expect(yarnAlt!.confidence).toBeGreaterThan(0.6);
  });
});
