/**
 * Tests for auto-switch module.
 */

import { describe, it, expect, vi } from 'vitest';
import type { EnvironmentInfo, InstallStep, ExecResult } from '@aiinstaller/shared';
import {
  executeWithAutoSwitch,
  defaultIsSuccess,
  shouldSwitch,
  selectNextAlternative,
  summarizeSwitchResult,
  getFailedAttemptErrors,
  type CommandRunner,
  type SwitchResult,
  type AutoSwitchOptions,
} from './auto-switch.js';
import {
  createInstallPnpmStep,
  createInstallOpenClawStep,
  createCheckNodeStep,
  createVerifyInstallationStep,
  createConfigureOpenClawStep,
} from './steps.js';
import { generateAlternatives } from './alternative-commands.js';

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

function makeSuccessResult(command: string): ExecResult {
  return {
    command,
    exitCode: 0,
    stdout: 'success output',
    stderr: '',
    duration: 100,
    timedOut: false,
  };
}

function makeFailResult(command: string, stderr: string = 'error occurred'): ExecResult {
  return {
    command,
    exitCode: 1,
    stdout: '',
    stderr,
    duration: 100,
    timedOut: false,
  };
}

function makeTimeoutResult(command: string): ExecResult {
  return {
    command,
    exitCode: 1,
    stdout: '',
    stderr: 'timed out',
    duration: 30000,
    timedOut: true,
  };
}

// ============================================================================
// defaultIsSuccess
// ============================================================================

describe('defaultIsSuccess', () => {
  const step = createInstallPnpmStep();

  it('returns true for exit code 0 without timeout', () => {
    const result = makeSuccessResult('npm install -g pnpm');
    expect(defaultIsSuccess(result, step)).toBe(true);
  });

  it('returns false for non-zero exit code', () => {
    const result = makeFailResult('npm install -g pnpm');
    expect(defaultIsSuccess(result, step)).toBe(false);
  });

  it('returns false for timed out result', () => {
    const result = makeTimeoutResult('npm install -g pnpm');
    expect(defaultIsSuccess(result, step)).toBe(false);
  });

  it('checks expectedOutput when defined', () => {
    const nodeStep = createCheckNodeStep(); // expectedOutput: 'v22'
    const goodResult: ExecResult = {
      command: 'node --version',
      exitCode: 0,
      stdout: 'v22.1.0',
      stderr: '',
      duration: 50,
      timedOut: false,
    };
    expect(defaultIsSuccess(goodResult, nodeStep)).toBe(true);

    const badResult: ExecResult = {
      command: 'node --version',
      exitCode: 0,
      stdout: 'v18.0.0',
      stderr: '',
      duration: 50,
      timedOut: false,
    };
    expect(defaultIsSuccess(badResult, nodeStep)).toBe(false);
  });
});

// ============================================================================
// shouldSwitch
// ============================================================================

describe('shouldSwitch', () => {
  it('returns false when command succeeded', () => {
    const step = createInstallPnpmStep(); // onError: 'retry'
    const result = makeSuccessResult('npm install -g pnpm');
    expect(shouldSwitch(step, result)).toBe(false);
  });

  it('returns true for failed command with onError=retry', () => {
    const step = createInstallPnpmStep(); // onError: 'retry'
    const result = makeFailResult('npm install -g pnpm');
    expect(shouldSwitch(step, result)).toBe(true);
  });

  it('returns true for failed command with onError=fallback', () => {
    const step = createCheckNodeStep(); // onError: 'fallback'
    const result = makeFailResult('node --version');
    expect(shouldSwitch(step, result)).toBe(true);
  });

  it('returns false for failed command with onError=abort', () => {
    const step = createVerifyInstallationStep(); // onError: 'abort'
    const result = makeFailResult('openclaw --version');
    expect(shouldSwitch(step, result)).toBe(false);
  });

  it('returns true for timed out command with onError=retry', () => {
    const step = createInstallPnpmStep();
    const result = makeTimeoutResult('npm install -g pnpm');
    expect(shouldSwitch(step, result)).toBe(true);
  });
});

// ============================================================================
// selectNextAlternative
// ============================================================================

describe('selectNextAlternative', () => {
  it('returns the first available alternative', () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();
    const stepAlts = generateAlternatives(step, env);
    const attempted = new Set<string>();

    const next = selectNextAlternative(stepAlts, attempted);
    expect(next).not.toBeNull();
    // Should be the highest confidence alternative
    expect(next!.id).toBe(stepAlts.alternatives[0].id);
  });

  it('skips already-attempted alternatives', () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();
    const stepAlts = generateAlternatives(step, env);
    const attempted = new Set<string>([stepAlts.alternatives[0].id]);

    const next = selectNextAlternative(stepAlts, attempted);
    expect(next).not.toBeNull();
    expect(next!.id).toBe(stepAlts.alternatives[1].id);
  });

  it('returns null when all alternatives are attempted', () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();
    const stepAlts = generateAlternatives(step, env);
    const attempted = new Set<string>(stepAlts.alternatives.map((a) => a.id));

    const next = selectNextAlternative(stepAlts, attempted);
    expect(next).toBeNull();
  });

  it('skips alternatives below minConfidence', () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();
    const stepAlts = generateAlternatives(step, env);
    // Set minConfidence very high so nothing qualifies
    const next = selectNextAlternative(stepAlts, new Set(), { minConfidence: 0.99 });
    expect(next).toBeNull();
  });

  it('skips sudo alternatives when skipSudo is true', () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();
    const stepAlts = generateAlternatives(step, env);
    const attempted = new Set<string>();

    const next = selectNextAlternative(stepAlts, attempted, { skipSudo: true });
    if (next) {
      expect(next.requiresSudo).toBe(false);
    }
  });
});

// ============================================================================
// executeWithAutoSwitch
// ============================================================================

describe('executeWithAutoSwitch', () => {
  it('returns success when primary command succeeds', async () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();
    const runner: CommandRunner = vi.fn().mockResolvedValue(
      makeSuccessResult('npm install -g pnpm'),
    );

    const result = await executeWithAutoSwitch(step, env, runner);

    expect(result.success).toBe(true);
    expect(result.successCommand).toBe('npm install -g pnpm');
    expect(result.successAlternativeId).toBeNull();
    expect(result.totalAttempts).toBe(1);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('switches to alternative when primary fails', async () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();
    const alts = generateAlternatives(step, env);
    const firstAlt = alts.alternatives[0];

    const runner: CommandRunner = vi.fn()
      .mockResolvedValueOnce(makeFailResult('npm install -g pnpm'))
      .mockResolvedValueOnce(makeSuccessResult(firstAlt.command));

    const result = await executeWithAutoSwitch(step, env, runner);

    expect(result.success).toBe(true);
    expect(result.successCommand).toBe(firstAlt.command);
    expect(result.successAlternativeId).toBe(firstAlt.id);
    expect(result.totalAttempts).toBe(2);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it('tries multiple alternatives until one succeeds', async () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();
    const alts = generateAlternatives(step, env);

    // Primary fails, first alt fails, second alt succeeds
    const runner: CommandRunner = vi.fn()
      .mockResolvedValueOnce(makeFailResult('npm install -g pnpm'))
      .mockResolvedValueOnce(makeFailResult(alts.alternatives[0].command))
      .mockResolvedValueOnce(makeSuccessResult(alts.alternatives[1].command));

    const result = await executeWithAutoSwitch(step, env, runner);

    expect(result.success).toBe(true);
    expect(result.successAlternativeId).toBe(alts.alternatives[1].id);
    expect(result.totalAttempts).toBe(3);
  });

  it('returns failure when all attempts fail', async () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();

    const runner: CommandRunner = vi.fn().mockResolvedValue(
      makeFailResult('any command'),
    );

    const result = await executeWithAutoSwitch(step, env, runner, {
      maxAlternatives: 2,
    });

    expect(result.success).toBe(false);
    expect(result.successCommand).toBeNull();
    expect(result.successAlternativeId).toBeNull();
    // 1 primary + up to 2 alternatives
    expect(result.totalAttempts).toBeGreaterThanOrEqual(2);
  });

  it('respects maxAlternatives limit', async () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();

    const runner: CommandRunner = vi.fn().mockResolvedValue(
      makeFailResult('any command'),
    );

    const result = await executeWithAutoSwitch(step, env, runner, {
      maxAlternatives: 1,
    });

    // 1 primary + 1 alternative max
    expect(result.totalAttempts).toBe(2);
  });

  it('does not try alternatives when onError is abort', async () => {
    const step = createVerifyInstallationStep(); // onError: 'abort'
    const env = makeMacEnv();

    const runner: CommandRunner = vi.fn().mockResolvedValue(
      makeFailResult('openclaw --version'),
    );

    const result = await executeWithAutoSwitch(step, env, runner);

    expect(result.success).toBe(false);
    expect(result.totalAttempts).toBe(1);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('does not try alternatives when onError is skip', async () => {
    const step: InstallStep = {
      id: 'skip-step',
      description: 'A skippable step',
      command: 'echo skip',
      timeout: 5000,
      canRollback: false,
      onError: 'skip',
    };
    const env = makeMacEnv();

    const runner: CommandRunner = vi.fn().mockResolvedValue(
      makeFailResult('echo skip'),
    );

    const result = await executeWithAutoSwitch(step, env, runner);

    expect(result.success).toBe(false);
    expect(result.totalAttempts).toBe(1);
  });

  it('uses custom isSuccess function', async () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();

    // Custom: treat exit code 0 with specific stdout as success
    const customIsSuccess = (result: ExecResult) =>
      result.exitCode === 0 && result.stdout.includes('CUSTOM_OK');

    const runner: CommandRunner = vi.fn()
      // Primary: exit 0 but no CUSTOM_OK
      .mockResolvedValueOnce({
        command: 'npm install -g pnpm',
        exitCode: 0,
        stdout: 'installed',
        stderr: '',
        duration: 100,
        timedOut: false,
      })
      // Alt 1: exit 0 with CUSTOM_OK
      .mockResolvedValueOnce({
        command: 'corepack enable',
        exitCode: 0,
        stdout: 'CUSTOM_OK',
        stderr: '',
        duration: 100,
        timedOut: false,
      });

    const result = await executeWithAutoSwitch(step, env, runner, {
      isSuccess: customIsSuccess,
    });

    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(2);
  });

  it('records correct attempt types', async () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv();

    const runner: CommandRunner = vi.fn()
      .mockResolvedValueOnce(makeFailResult('npm install -g pnpm'))
      .mockResolvedValueOnce(makeSuccessResult('alt command'));

    const result = await executeWithAutoSwitch(step, env, runner);

    expect(result.attempts[0].type).toBe('primary');
    expect(result.attempts[0].alternativeId).toBeNull();
    expect(result.attempts[1].type).toBe('alternative');
    expect(result.attempts[1].alternativeId).not.toBeNull();
  });

  it('handles steps with no alternatives gracefully', async () => {
    const step: InstallStep = {
      id: 'no-alt-step',
      description: 'No alternatives',
      command: 'echo noop',
      timeout: 5000,
      canRollback: false,
      onError: 'retry',
    };
    const env = makeMacEnv();

    const runner: CommandRunner = vi.fn().mockResolvedValue(
      makeFailResult('echo noop'),
    );

    const result = await executeWithAutoSwitch(step, env, runner);

    expect(result.success).toBe(false);
    // Only primary attempt since no alternatives exist
    expect(result.totalAttempts).toBe(1);
  });

  it('handles timeout in primary and succeeds with alternative', async () => {
    const step = createInstallOpenClawStep();
    const env = makeMacEnv();
    const alts = generateAlternatives(step, env);

    const runner: CommandRunner = vi.fn()
      .mockResolvedValueOnce(makeTimeoutResult('pnpm install -g openclaw'))
      .mockResolvedValueOnce(makeSuccessResult(alts.alternatives[0].command));

    const result = await executeWithAutoSwitch(step, env, runner);

    expect(result.success).toBe(true);
    expect(result.attempts[0].result.timedOut).toBe(true);
    expect(result.totalAttempts).toBe(2);
  });
});

// ============================================================================
// summarizeSwitchResult
// ============================================================================

describe('summarizeSwitchResult', () => {
  it('summarizes primary success', () => {
    const result: SwitchResult = {
      stepId: 'install-pnpm',
      success: true,
      successCommand: 'npm install -g pnpm',
      successAlternativeId: null,
      attempts: [
        {
          command: 'npm install -g pnpm',
          type: 'primary',
          alternativeId: null,
          result: makeSuccessResult('npm install -g pnpm'),
          timestamp: Date.now(),
        },
      ],
      totalAttempts: 1,
    };

    const summary = summarizeSwitchResult(result);
    expect(summary).toContain('install-pnpm');
    expect(summary).toContain('primary command succeeded');
  });

  it('summarizes alternative success', () => {
    const result: SwitchResult = {
      stepId: 'install-pnpm',
      success: true,
      successCommand: 'brew install pnpm',
      successAlternativeId: 'install-pnpm-brew',
      attempts: [
        {
          command: 'npm install -g pnpm',
          type: 'primary',
          alternativeId: null,
          result: makeFailResult('npm install -g pnpm'),
          timestamp: Date.now(),
        },
        {
          command: 'brew install pnpm',
          type: 'alternative',
          alternativeId: 'install-pnpm-brew',
          result: makeSuccessResult('brew install pnpm'),
          timestamp: Date.now(),
        },
      ],
      totalAttempts: 2,
    };

    const summary = summarizeSwitchResult(result);
    expect(summary).toContain('install-pnpm');
    expect(summary).toContain('switched to alternative');
    expect(summary).toContain('install-pnpm-brew');
    expect(summary).toContain('2 attempt(s)');
  });

  it('summarizes all-failed result', () => {
    const result: SwitchResult = {
      stepId: 'install-pnpm',
      success: false,
      successCommand: null,
      successAlternativeId: null,
      attempts: [
        {
          command: 'npm install -g pnpm',
          type: 'primary',
          alternativeId: null,
          result: makeFailResult('npm install -g pnpm'),
          timestamp: Date.now(),
        },
        {
          command: 'brew install pnpm',
          type: 'alternative',
          alternativeId: 'install-pnpm-brew',
          result: makeFailResult('brew install pnpm'),
          timestamp: Date.now(),
        },
      ],
      totalAttempts: 2,
    };

    const summary = summarizeSwitchResult(result);
    expect(summary).toContain('all 2 attempt(s) failed');
    expect(summary).toContain('No working command found');
  });
});

// ============================================================================
// getFailedAttemptErrors
// ============================================================================

describe('getFailedAttemptErrors', () => {
  it('extracts errors from failed attempts only', () => {
    const result: SwitchResult = {
      stepId: 'install-pnpm',
      success: true,
      successCommand: 'brew install pnpm',
      successAlternativeId: 'install-pnpm-brew',
      attempts: [
        {
          command: 'npm install -g pnpm',
          type: 'primary',
          alternativeId: null,
          result: makeFailResult('npm install -g pnpm', 'EACCES: permission denied'),
          timestamp: Date.now(),
        },
        {
          command: 'brew install pnpm',
          type: 'alternative',
          alternativeId: 'install-pnpm-brew',
          result: makeSuccessResult('brew install pnpm'),
          timestamp: Date.now(),
        },
      ],
      totalAttempts: 2,
    };

    const errors = getFailedAttemptErrors(result);
    expect(errors).toHaveLength(1);
    expect(errors[0].command).toBe('npm install -g pnpm');
    expect(errors[0].stderr).toContain('EACCES');
    expect(errors[0].exitCode).toBe(1);
  });

  it('includes timed out attempts as errors', () => {
    const result: SwitchResult = {
      stepId: 'install-openclaw',
      success: false,
      successCommand: null,
      successAlternativeId: null,
      attempts: [
        {
          command: 'pnpm install -g openclaw',
          type: 'primary',
          alternativeId: null,
          result: makeTimeoutResult('pnpm install -g openclaw'),
          timestamp: Date.now(),
        },
      ],
      totalAttempts: 1,
    };

    const errors = getFailedAttemptErrors(result);
    expect(errors).toHaveLength(1);
    expect(errors[0].command).toBe('pnpm install -g openclaw');
  });

  it('returns empty array when all attempts succeeded', () => {
    const result: SwitchResult = {
      stepId: 'check-node',
      success: true,
      successCommand: 'node --version',
      successAlternativeId: null,
      attempts: [
        {
          command: 'node --version',
          type: 'primary',
          alternativeId: null,
          result: makeSuccessResult('node --version'),
          timestamp: Date.now(),
        },
      ],
      totalAttempts: 1,
    };

    const errors = getFailedAttemptErrors(result);
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// Integration scenarios
// ============================================================================

describe('integration scenarios', () => {
  it('permission error triggers switch to non-sudo alternative', async () => {
    const step = createInstallPnpmStep();
    const env = makeMacEnv({
      permissions: { hasSudo: false, canWriteTo: ['/home/user'] },
    });
    const alts = generateAlternatives(step, env);

    const runner: CommandRunner = vi.fn()
      .mockResolvedValueOnce(
        makeFailResult('npm install -g pnpm', 'EACCES: permission denied'),
      )
      .mockResolvedValueOnce(makeSuccessResult(alts.alternatives[0].command));

    const result = await executeWithAutoSwitch(step, env, runner, {
      skipSudo: true,
    });

    expect(result.success).toBe(true);
    // The successful alternative should not require sudo
    const successAlt = alts.alternatives.find(
      (a) => a.id === result.successAlternativeId,
    );
    if (successAlt) {
      expect(successAlt.requiresSudo).toBe(false);
    }
  });

  it('check-node with fallback strategy switches to nvm', async () => {
    const step = createCheckNodeStep(); // onError: 'fallback'
    const env = makeMacEnv();

    const runner: CommandRunner = vi.fn()
      .mockResolvedValueOnce(
        makeFailResult('node --version', 'node: command not found'),
      )
      .mockResolvedValueOnce({
        command: 'nvm current',
        exitCode: 0,
        stdout: 'v22.1.0',
        stderr: '',
        duration: 50,
        timedOut: false,
      });

    const result = await executeWithAutoSwitch(step, env, runner);

    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(2);
  });

  it('respects minConfidence option to filter weak alternatives', async () => {
    const step = createInstallOpenClawStep();
    const env = makeMacEnv();

    const runner: CommandRunner = vi.fn().mockResolvedValue(
      makeFailResult('any command'),
    );

    const result = await executeWithAutoSwitch(step, env, runner, {
      maxAlternatives: 10,
      minConfidence: 0.9,
    });

    // Very few (likely 0) alternatives have confidence >= 0.9
    // So total attempts should be low
    expect(result.totalAttempts).toBeLessThanOrEqual(2);
  });
});
