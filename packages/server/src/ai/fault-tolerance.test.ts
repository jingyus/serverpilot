// SPDX-License-Identifier: AGPL-3.0
// Copyright (c) 2024-2026 ServerPilot Contributors
/**
 * Tests for fault tolerance utilities.
 *
 * @module ai/fault-tolerance.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EnvironmentInfo, ErrorContext } from '@aiinstaller/shared';
import {
  calculateBackoffDelay,
  retryWithBackoff,
  fallbackChain,
  getPresetEnvironmentAnalysis,
  getPresetInstallPlan,
  getPresetErrorDiagnosis,
  getPresetFixStrategies,
  DEFAULT_RETRY_CONFIG,
} from './fault-tolerance.js';

// ============================================================================
// Mock Data
// ============================================================================

const mockEnvironment: EnvironmentInfo = {
  os: {
    platform: 'darwin',
    version: '13.0.0',
    arch: 'arm64',
  },
  shell: {
    type: 'zsh',
    version: '5.8',
    path: '/bin/zsh',
  },
  runtime: {
    node: '18.0.0',
    python: '3.9.0',
  },
  packageManagers: {
    npm: '8.0.0',
    pnpm: null,
    yarn: null,
    brew: '4.0.0',
    apt: null,
  },
  network: {
    canAccessNpm: true,
    canAccessGithub: true,
  },
  permissions: {
    hasSudo: true,
    canWriteTo: ['/usr/local/bin', '/usr/local/lib'],
  },
};

const mockErrorContext: ErrorContext = {
  command: 'npm install openclaw',
  exitCode: 1,
  stdout: '',
  stderr: 'npm ERR! code ETIMEDOUT\nnpm ERR! network timeout',
  stepId: 'install',
  environment: mockEnvironment,
  previousSteps: [],
};

// ============================================================================
// Tests: Exponential Backoff
// ============================================================================

describe('calculateBackoffDelay', () => {
  it('should calculate exponential delay correctly', () => {
    const config = DEFAULT_RETRY_CONFIG;

    expect(calculateBackoffDelay(0, config)).toBe(1000); // 1 * 2^0 = 1s
    expect(calculateBackoffDelay(1, config)).toBe(2000); // 1 * 2^1 = 2s
    expect(calculateBackoffDelay(2, config)).toBe(4000); // 1 * 2^2 = 4s
    expect(calculateBackoffDelay(3, config)).toBe(8000); // 1 * 2^3 = 8s
  });

  it('should cap delay at maxDelayMs', () => {
    const config = DEFAULT_RETRY_CONFIG;

    expect(calculateBackoffDelay(10, config)).toBe(30000); // capped at maxDelayMs
    expect(calculateBackoffDelay(20, config)).toBe(30000); // capped at maxDelayMs
  });

  it('should work with custom config', () => {
    const config = {
      maxRetries: 3,
      initialDelayMs: 500,
      maxDelayMs: 5000,
      backoffMultiplier: 3,
    };

    expect(calculateBackoffDelay(0, config)).toBe(500); // 500 * 3^0 = 500
    expect(calculateBackoffDelay(1, config)).toBe(1500); // 500 * 3^1 = 1500
    expect(calculateBackoffDelay(2, config)).toBe(4500); // 500 * 3^2 = 4500
    expect(calculateBackoffDelay(3, config)).toBe(5000); // capped at 5000
  });
});

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should succeed on first attempt', async () => {
    const operation = vi.fn().mockResolvedValue('success');

    const result = await retryWithBackoff(operation, {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: 3,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
    expect(result.attempts).toBe(1);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should retry on transient errors and eventually succeed', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValue('success');

    const result = await retryWithBackoff(
      operation,
      {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: 3,
        initialDelayMs: 10, // Fast for testing
      },
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
    expect(result.attempts).toBe(3);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should fail after max retries', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Persistent error'));

    const result = await retryWithBackoff(
      operation,
      {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: 2,
        initialDelayMs: 10, // Fast for testing
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Persistent error');
    expect(result.attempts).toBe(3); // maxRetries + 1
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('should not retry on permanent errors when shouldRetry returns false', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Authentication failed'));

    const result = await retryWithBackoff(
      operation,
      {
        ...DEFAULT_RETRY_CONFIG,
        maxRetries: 3,
      },
      (error) => !error.message.includes('Authentication'),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permanent error');
    expect(result.attempts).toBe(1);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Tests: Provider Fallback Chain
// ============================================================================

describe('fallbackChain', () => {
  it('should succeed with first provider', async () => {
    const operations = {
      claude: vi.fn().mockResolvedValue('claude-result'),
      deepseek: vi.fn().mockResolvedValue('deepseek-result'),
      preset: vi.fn().mockResolvedValue('preset-result'),
    };

    const result = await fallbackChain(operations, {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: 1,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe('claude-result');
    expect(result.provider).toBe('claude');
    expect(operations.claude).toHaveBeenCalled();
    expect(operations.deepseek).not.toHaveBeenCalled();
    expect(operations.preset).not.toHaveBeenCalled();
  });

  it('should fallback to second provider when first fails', async () => {
    const operations = {
      claude: vi.fn().mockRejectedValue(new Error('Claude failed')),
      deepseek: vi.fn().mockResolvedValue('deepseek-result'),
      preset: vi.fn().mockResolvedValue('preset-result'),
    };

    const result = await fallbackChain(operations, {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: 1,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe('deepseek-result');
    expect(result.provider).toBe('deepseek');
    expect(operations.claude).toHaveBeenCalled();
    expect(operations.deepseek).toHaveBeenCalled();
    expect(operations.preset).not.toHaveBeenCalled();
  });

  it('should try all providers and use last one', async () => {
    const operations = {
      claude: vi.fn().mockRejectedValue(new Error('Claude failed')),
      deepseek: vi.fn().mockRejectedValue(new Error('DeepSeek failed')),
      gpt: vi.fn().mockRejectedValue(new Error('GPT failed')),
      preset: vi.fn().mockResolvedValue('preset-result'),
    };

    const result = await fallbackChain(operations, {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: 1,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe('preset-result');
    expect(result.provider).toBe('preset');
    expect(operations.claude).toHaveBeenCalled();
    expect(operations.deepseek).toHaveBeenCalled();
    expect(operations.gpt).toHaveBeenCalled();
    expect(operations.preset).toHaveBeenCalled();
  });

  it('should fail when all providers fail', async () => {
    const operations = {
      claude: vi.fn().mockRejectedValue(new Error('Claude failed')),
      deepseek: vi.fn().mockRejectedValue(new Error('DeepSeek failed')),
      preset: vi.fn().mockRejectedValue(new Error('Preset failed')),
    };

    const result = await fallbackChain(operations, {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: 1,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('All providers failed');
    expect(result.error).toContain('claude: ');
    expect(result.error).toContain('deepseek: ');
    expect(result.error).toContain('preset: ');
  });

  it('should skip undefined providers', async () => {
    const operations = {
      claude: undefined,
      deepseek: vi.fn().mockResolvedValue('deepseek-result'),
    };

    const result = await fallbackChain(operations, {
      ...DEFAULT_RETRY_CONFIG,
      maxRetries: 1,
      initialDelayMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.data).toBe('deepseek-result');
    expect(result.provider).toBe('deepseek');
  });
});

// ============================================================================
// Tests: Preset Templates
// ============================================================================

describe('getPresetEnvironmentAnalysis', () => {
  it('should return ready environment when all capabilities present', () => {
    const analysis = getPresetEnvironmentAnalysis(mockEnvironment, 'openclaw');

    expect(analysis.ready).toBe(true);
    expect(analysis.issues).toHaveLength(0);
    expect(analysis.detectedCapabilities.hasRequiredRuntime).toBe(true);
    expect(analysis.detectedCapabilities.hasPackageManager).toBe(true);
    expect(analysis.detectedCapabilities.hasNetworkAccess).toBe(true);
    expect(analysis.detectedCapabilities.hasSufficientPermissions).toBe(true);
  });

  it('should detect missing Node.js for node software', () => {
    const envWithoutNode: EnvironmentInfo = {
      ...mockEnvironment,
      runtime: { node: null, python: '3.9.0' },
    };

    const analysis = getPresetEnvironmentAnalysis(envWithoutNode, 'nodejs-app');

    expect(analysis.ready).toBe(false);
    expect(analysis.issues).toContain('Node.js is not installed');
    expect(analysis.recommendations).toContain('Install Node.js from https://nodejs.org/');
  });

  it('should detect missing Python for python software', () => {
    const envWithoutPython: EnvironmentInfo = {
      ...mockEnvironment,
      runtime: { node: '18.0.0', python: null },
    };

    const analysis = getPresetEnvironmentAnalysis(envWithoutPython, 'python-tool');

    expect(analysis.ready).toBe(false);
    expect(analysis.issues).toContain('Python is not installed');
    expect(analysis.recommendations).toContain('Install Python from https://python.org/');
  });

  it('should detect missing package manager', () => {
    const envWithoutPM: EnvironmentInfo = {
      ...mockEnvironment,
      packageManagers: {
        npm: null,
        pnpm: null,
        yarn: null,
        brew: null,
        apt: null,
      },
    };

    const analysis = getPresetEnvironmentAnalysis(envWithoutPM, 'any-software');

    expect(analysis.ready).toBe(false);
    expect(analysis.issues).toContain('No package manager detected');
  });

  it('should detect network issues', () => {
    const envWithoutNetwork: EnvironmentInfo = {
      ...mockEnvironment,
      network: {
        canAccessNpm: false,
        canAccessGithub: false,
      },
    };

    const analysis = getPresetEnvironmentAnalysis(envWithoutNetwork, 'any-software');

    expect(analysis.ready).toBe(false);
    expect(analysis.issues).toContain('Network connectivity issues detected');
  });
});

describe('getPresetInstallPlan', () => {
  it('should generate brew install plan for macOS with brew', () => {
    const plan = getPresetInstallPlan(mockEnvironment, 'openclaw');

    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0].id).toBe('check-prerequisites');
    expect(plan.steps[1].command).toContain('brew install');
    expect(plan.steps[2].id).toBe('verify');
  });

  it('should generate apt-get plan for Linux with apt', () => {
    const linuxEnv: EnvironmentInfo = {
      ...mockEnvironment,
      os: { platform: 'linux', version: '20.04', arch: 'x64' },
      packageManagers: {
        ...mockEnvironment.packageManagers,
        brew: null,
        apt: '2.0.0',
      },
    };

    const plan = getPresetInstallPlan(linuxEnv, 'tool');

    expect(plan.steps[1].command).toContain('apt-get');
    expect(plan.steps[1].command).toContain('sudo');
  });

  it('should generate npm install plan when no system package manager', () => {
    const envWithNpm: EnvironmentInfo = {
      ...mockEnvironment,
      packageManagers: {
        npm: '8.0.0',
        pnpm: null,
        yarn: null,
        brew: null,
        apt: null,
      },
    };

    const plan = getPresetInstallPlan(envWithNpm, 'package');

    expect(plan.steps[1].command).toContain('npm install');
  });

  it('should prefer pnpm over npm when available', () => {
    const envWithPnpm: EnvironmentInfo = {
      ...mockEnvironment,
      packageManagers: {
        npm: '8.0.0',
        pnpm: '7.0.0',
        yarn: null,
        brew: null,
        apt: null,
      },
    };

    const plan = getPresetInstallPlan(envWithPnpm, 'package');

    expect(plan.steps[1].command).toContain('pnpm install');
  });
});

describe('getPresetErrorDiagnosis', () => {
  it('should diagnose network errors', () => {
    const networkError: ErrorContext = {
      ...mockErrorContext,
      stderr: 'npm ERR! code ETIMEDOUT\nnpm ERR! network timeout',
    };

    const diagnosis = getPresetErrorDiagnosis(networkError);

    expect(diagnosis.category).toBe('network');
    expect(diagnosis.rootCause).toContain('Network');
    expect(diagnosis.severity).toBe('medium');
  });

  it('should diagnose permission errors', () => {
    const permError: ErrorContext = {
      ...mockErrorContext,
      stderr: 'Error: EACCES: permission denied, mkdir \'/usr/local/lib\'',
    };

    const diagnosis = getPresetErrorDiagnosis(permError);

    expect(diagnosis.category).toBe('permission');
    expect(diagnosis.rootCause).toContain('Permission');
    expect(diagnosis.severity).toBe('high');
  });

  it('should diagnose dependency errors', () => {
    const depError: ErrorContext = {
      ...mockErrorContext,
      stderr: 'bash: pnpm: command not found',
    };

    const diagnosis = getPresetErrorDiagnosis(depError);

    expect(diagnosis.category).toBe('dependency');
    expect(diagnosis.rootCause).toContain('dependency');
  });

  it('should diagnose version errors', () => {
    const versionError: ErrorContext = {
      ...mockErrorContext,
      stderr: 'error engine {"node":"^16.0.0"} is incompatible with this module',
    };

    const diagnosis = getPresetErrorDiagnosis(versionError);

    expect(diagnosis.category).toBe('version');
    expect(diagnosis.rootCause).toContain('incompatibility');
  });

  it('should return unknown for unrecognized errors', () => {
    const unknownError: ErrorContext = {
      ...mockErrorContext,
      stderr: 'Some random error that we do not recognize',
    };

    const diagnosis = getPresetErrorDiagnosis(unknownError);

    expect(diagnosis.category).toBe('unknown');
  });
});

describe('getPresetFixStrategies', () => {
  it('should suggest retry for network timeouts', () => {
    const networkError: ErrorContext = {
      ...mockErrorContext,
      stderr: 'npm ERR! code ETIMEDOUT',
    };

    const strategies = getPresetFixStrategies(networkError);

    expect(strategies.length).toBeGreaterThan(0);
    expect(strategies[0].id).toBe('retry-with-timeout');
    expect(strategies[0].commands).toContain(networkError.command);
  });

  it('should suggest sudo for permission errors', () => {
    const permError: ErrorContext = {
      ...mockErrorContext,
      stderr: 'Error: EACCES: permission denied',
    };

    const strategies = getPresetFixStrategies(permError);

    expect(strategies.length).toBeGreaterThan(0);
    const sudoStrategy = strategies.find((s) => s.id === 'use-sudo');
    expect(sudoStrategy).toBeDefined();
    expect(sudoStrategy?.requiresSudo).toBe(true);
  });

  it('should suggest installing missing command', () => {
    const depError: ErrorContext = {
      ...mockErrorContext,
      command: 'pnpm install',
      stderr: 'bash: pnpm: command not found',
    };

    const strategies = getPresetFixStrategies(depError);

    expect(strategies.length).toBeGreaterThan(0);
    const installStrategy = strategies.find((s) => s.id === 'install-dependency');
    expect(installStrategy).toBeDefined();
    expect(installStrategy?.description).toContain('pnpm');
  });

  it('should provide fallback strategy for unknown errors', () => {
    const unknownError: ErrorContext = {
      ...mockErrorContext,
      stderr: 'Unknown error XYZ123',
    };

    const strategies = getPresetFixStrategies(unknownError);

    expect(strategies.length).toBeGreaterThan(0);
    expect(strategies[0].id).toBe('manual-intervention');
  });

  it('should suggest mirror for network errors', () => {
    const networkError: ErrorContext = {
      ...mockErrorContext,
      stderr: 'npm ERR! code ENOTFOUND\nregistry.npmjs.org',
    };

    const strategies = getPresetFixStrategies(networkError);

    const mirrorStrategy = strategies.find((s) => s.id === 'use-mirror');
    expect(mirrorStrategy).toBeDefined();
    expect(mirrorStrategy?.commands[0]).toContain('registry');
  });
});
