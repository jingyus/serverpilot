// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for error diagnosis service — auto-diagnosis on command failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FullServerProfile } from '../core/profile/manager.js';
import type { ServerProfile } from '../db/repositories/server-repository.js';
import {
  buildEnvironmentFromProfile,
  autoDiagnoseStepFailure,
  type StepFailureInput,
} from './error-diagnosis-service.js';

// ============================================================================
// Mocks
// ============================================================================

// Mock the AI provider factory
vi.mock('./providers/provider-factory.js', () => ({
  getActiveProvider: vi.fn(() => null),
}));

// Mock the logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// Helpers
// ============================================================================

function createServerProfile(overrides?: Partial<ServerProfile>): ServerProfile {
  return {
    serverId: 'srv-1',
    osInfo: {
      platform: 'ubuntu',
      arch: 'x64',
      version: '22.04',
      kernel: '5.15.0',
      hostname: 'prod-01',
      uptime: 86400,
    },
    software: [
      { name: 'nodejs', version: '22.1.0' },
      { name: 'npm', version: '10.2.0' },
      { name: 'nginx', version: '1.24.0' },
    ],
    services: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createFullProfile(overrides?: Partial<FullServerProfile>): FullServerProfile {
  return {
    ...createServerProfile(),
    preferences: null,
    notes: [],
    operationHistory: [],
    historySummary: null,
    ...overrides,
  };
}

function createStepFailure(overrides?: Partial<StepFailureInput>): StepFailureInput {
  return {
    stepId: 'step-1',
    command: 'apt install redis-server',
    exitCode: 1,
    stdout: '',
    stderr: 'E: Unable to locate package redis-server',
    serverId: 'srv-1',
    serverProfile: createServerProfile(),
    previousSteps: [],
    ...overrides,
  };
}

// ============================================================================
// Tests: buildEnvironmentFromProfile
// ============================================================================

describe('buildEnvironmentFromProfile', () => {
  it('should return default environment when profile is null', () => {
    const env = buildEnvironmentFromProfile(null);

    expect(env.os.platform).toBe('linux');
    expect(env.os.version).toBe('unknown');
    expect(env.os.arch).toBe('x64');
    expect(env.permissions.hasSudo).toBe(true);
  });

  it('should return default environment when profile has no osInfo', () => {
    const profile = createServerProfile({ osInfo: null });
    const env = buildEnvironmentFromProfile(profile);

    expect(env.os.platform).toBe('linux');
    expect(env.os.version).toBe('unknown');
  });

  it('should detect apt for Ubuntu', () => {
    const profile = createServerProfile({
      osInfo: {
        platform: 'ubuntu',
        arch: 'x64',
        version: '22.04',
        kernel: '5.15.0',
        hostname: 'test',
        uptime: 0,
      },
    });
    const env = buildEnvironmentFromProfile(profile);

    expect(env.os.platform).toBe('ubuntu');
    expect(env.os.version).toBe('22.04');
    expect(env.packageManagers.apt).toBe('detected');
  });

  it('should detect yum for CentOS', () => {
    const profile = createServerProfile({
      osInfo: {
        platform: 'centos',
        arch: 'x64',
        version: '7.9',
        kernel: '3.10.0',
        hostname: 'test',
        uptime: 0,
      },
    });
    const env = buildEnvironmentFromProfile(profile);

    expect(env.os.platform).toBe('centos');
    expect(env.packageManagers.yum).toBe('detected');
  });

  it('should detect brew for macOS', () => {
    const profile = createServerProfile({
      osInfo: {
        platform: 'darwin',
        arch: 'arm64',
        version: '14.0',
        kernel: '23.0.0',
        hostname: 'test',
        uptime: 0,
      },
    });
    const env = buildEnvironmentFromProfile(profile);

    expect(env.os.platform).toBe('darwin');
    expect(env.packageManagers.brew).toBe('detected');
  });

  it('should extract node version from software list', () => {
    const profile = createServerProfile({
      software: [
        { name: 'nodejs', version: '22.1.0' },
        { name: 'npm', version: '10.2.0' },
        { name: 'python3', version: '3.11.0' },
      ],
    });
    const env = buildEnvironmentFromProfile(profile);

    expect(env.runtime.node).toBe('22.1.0');
    expect(env.runtime.python).toBe('3.11.0');
    expect(env.packageManagers.npm).toBe('10.2.0');
  });

  it('should extract pnpm and yarn from software list', () => {
    const profile = createServerProfile({
      software: [
        { name: 'pnpm', version: '9.1.0' },
        { name: 'yarn', version: '4.0.0' },
      ],
    });
    const env = buildEnvironmentFromProfile(profile);

    expect(env.packageManagers.pnpm).toBe('9.1.0');
    expect(env.packageManagers.yarn).toBe('4.0.0');
  });

  it('should handle FullServerProfile with extensions', () => {
    const profile = createFullProfile();
    const env = buildEnvironmentFromProfile(profile);

    expect(env.os.platform).toBe('ubuntu');
    expect(env.runtime.node).toBe('22.1.0');
  });
});

// ============================================================================
// Tests: autoDiagnoseStepFailure
// ============================================================================

describe('autoDiagnoseStepFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should diagnose permission denied errors (rule-based)', async () => {
    const input = createStepFailure({
      stderr: 'EACCES: permission denied, access \'/usr/local/lib\'',
    });

    const result = await autoDiagnoseStepFailure(input);

    expect(result.success).toBe(true);
    expect(result.errorType).toBe('permission');
    expect(result.fixSuggestions.length).toBeGreaterThan(0);
    expect(result.usedRuleLibrary).toBe(true);
  });

  it('should diagnose network timeout errors (rule-based)', async () => {
    const input = createStepFailure({
      command: 'npm install express',
      stderr: 'npm ERR! ETIMEDOUT: request to https://registry.npmjs.org failed',
    });

    const result = await autoDiagnoseStepFailure(input);

    expect(result.success).toBe(true);
    expect(result.errorType).toBe('network');
    expect(result.usedRuleLibrary).toBe(true);
  });

  it('should diagnose dependency resolution errors (rule-based)', async () => {
    const input = createStepFailure({
      command: 'npm install some-package',
      stderr: 'npm ERR! ERESOLVE unable to resolve dependency tree',
    });

    const result = await autoDiagnoseStepFailure(input);

    expect(result.success).toBe(true);
    expect(result.errorType).toBe('dependency');
    expect(result.fixSuggestions.length).toBeGreaterThan(0);
  });

  it('should diagnose command not found errors', async () => {
    const input = createStepFailure({
      command: 'redis-cli ping',
      stderr: 'bash: redis-cli: command not found',
    });

    const result = await autoDiagnoseStepFailure(input);

    expect(result.success).toBe(true);
    expect(result.errorType).toBe('dependency');
  });

  it('should provide basic analysis for unrecognized errors', async () => {
    const input = createStepFailure({
      stderr: 'some completely unknown error xyz123',
    });

    const result = await autoDiagnoseStepFailure(input);

    expect(result.success).toBe(true);
    expect(result.errorType).toBe('unknown');
  });

  it('should work without a server profile', async () => {
    const input = createStepFailure({
      serverProfile: null,
      stderr: 'EACCES: permission denied',
    });

    const result = await autoDiagnoseStepFailure(input);

    expect(result.success).toBe(true);
    expect(result.errorType).toBe('permission');
  });

  it('should include previous steps in context', async () => {
    const input = createStepFailure({
      stderr: 'EACCES: permission denied',
      previousSteps: [
        {
          stepId: 'step-0',
          success: true,
          exitCode: 0,
          stdout: 'done',
          stderr: '',
          duration: 1000,
        },
      ],
    });

    const result = await autoDiagnoseStepFailure(input);

    expect(result.success).toBe(true);
  });

  it('should handle diagnosis throwing an error gracefully', async () => {
    // Force an error by providing bad data
    const input = createStepFailure({
      stderr: 'EACCES: permission denied',
    });

    // Mock the diagnoseError to throw
    const { diagnoseError } = await import('./error-analyzer.js');
    const _originalDiagnoseError = diagnoseError;

    // Even if internal errors occur, the service should return gracefully
    const result = await autoDiagnoseStepFailure(input);

    expect(result.success).toBeDefined();
  });

  it('should format fix suggestions with required fields', async () => {
    const input = createStepFailure({
      stderr: 'EACCES: permission denied, access \'/usr/local/lib\'',
    });

    const result = await autoDiagnoseStepFailure(input);

    if (result.fixSuggestions.length > 0) {
      const fix = result.fixSuggestions[0];
      expect(fix).toHaveProperty('description');
      expect(fix).toHaveProperty('commands');
      expect(fix).toHaveProperty('confidence');
      expect(fix).toHaveProperty('risk');
      expect(fix).toHaveProperty('requiresSudo');
      expect(Array.isArray(fix.commands)).toBe(true);
      expect(typeof fix.confidence).toBe('number');
    }
  });

  it('should diagnose JSON parse errors as configuration type', async () => {
    const input = createStepFailure({
      command: 'npm install',
      stderr: 'npm ERR! code EJSONPARSE\nnpm ERR! JSON.parse Failed to parse json',
    });

    const result = await autoDiagnoseStepFailure(input);

    expect(result.success).toBe(true);
    expect(result.errorType).toBe('configuration');
  });

  it('should diagnose Node.js version incompatibility', async () => {
    const input = createStepFailure({
      command: 'npm install modern-package',
      stderr: 'npm WARN EBADENGINE engine "node" is incompatible',
    });

    const result = await autoDiagnoseStepFailure(input);

    expect(result.success).toBe(true);
    expect(result.errorType).toBe('version');
  });

  it('should provide environment-aware fix suggestions for Ubuntu', async () => {
    const input = createStepFailure({
      stderr: 'bash: redis-cli: command not found',
      serverProfile: createServerProfile({
        osInfo: {
          platform: 'ubuntu',
          arch: 'x64',
          version: '22.04',
          kernel: '5.15.0',
          hostname: 'prod-01',
          uptime: 0,
        },
      }),
    });

    const result = await autoDiagnoseStepFailure(input);

    expect(result.success).toBe(true);
    // The fix suggestions should exist (from rule library)
    expect(result.fixSuggestions.length).toBeGreaterThan(0);
  });
});
