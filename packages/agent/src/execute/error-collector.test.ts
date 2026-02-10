import { describe, it, expect, beforeEach } from 'vitest';

import type { EnvironmentInfo, ExecResult, StepResult } from '@aiinstaller/shared';

import {
  ErrorCollector,
  collectErrorContext,
  lastLines,
} from './error-collector.js';
import type { CollectErrorOptions } from './error-collector.js';

// ============================================================================
// Fixtures
// ============================================================================

function makeEnvironment(overrides?: Partial<EnvironmentInfo>): EnvironmentInfo {
  return {
    os: { platform: 'darwin', version: '15.0.0', arch: 'arm64' },
    shell: { name: 'zsh', path: '/bin/zsh' },
    runtime: { nodeVersion: 'v22.0.0', pythonVersion: null },
    packageManagers: {
      npm: { installed: true, version: '10.0.0' },
      pnpm: { installed: true, version: '9.0.0' },
      yarn: { installed: false, version: null },
      brew: { installed: true, version: '4.0.0' },
      apt: { installed: false, version: null },
    },
    network: { canAccessNpm: true, canAccessGithub: true },
    permissions: { hasSudo: false, canWriteTo: ['/usr/local'] },
    ...overrides,
  };
}

function makeExecResult(overrides?: Partial<ExecResult>): ExecResult {
  return {
    command: 'npm install -g pnpm',
    exitCode: 1,
    stdout: '',
    stderr: 'EACCES: permission denied',
    duration: 1500,
    timedOut: false,
    ...overrides,
  };
}

function makeStepResult(overrides?: Partial<StepResult>): StepResult {
  return {
    stepId: 'check-node',
    success: true,
    exitCode: 0,
    stdout: 'v22.0.0\n',
    stderr: '',
    duration: 80,
    ...overrides,
  };
}

// ============================================================================
// lastLines helper
// ============================================================================

describe('lastLines', () => {
  it('returns empty string for count <= 0', () => {
    expect(lastLines('a\nb\nc', 0)).toBe('');
    expect(lastLines('a\nb\nc', -1)).toBe('');
  });

  it('returns full string when fewer lines than count', () => {
    expect(lastLines('one\ntwo', 5)).toBe('one\ntwo');
  });

  it('returns exact lines when count equals line count', () => {
    expect(lastLines('a\nb\nc', 3)).toBe('a\nb\nc');
  });

  it('returns last N lines', () => {
    expect(lastLines('a\nb\nc\nd\ne', 2)).toBe('d\ne');
  });

  it('handles empty string', () => {
    expect(lastLines('', 3)).toBe('');
  });

  it('handles single line', () => {
    expect(lastLines('hello', 1)).toBe('hello');
  });
});

// ============================================================================
// collectErrorContext (standalone function)
// ============================================================================

describe('collectErrorContext', () => {
  const env = makeEnvironment();

  it('assembles a complete ErrorContext from options', () => {
    const execResult = makeExecResult();
    const previous: StepResult[] = [makeStepResult()];

    const ctx = collectErrorContext({
      stepId: 'install-pnpm',
      execResult,
      environment: env,
      previousSteps: previous,
    });

    expect(ctx.stepId).toBe('install-pnpm');
    expect(ctx.command).toBe('npm install -g pnpm');
    expect(ctx.exitCode).toBe(1);
    expect(ctx.stdout).toBe('');
    expect(ctx.stderr).toBe('EACCES: permission denied');
    expect(ctx.environment).toEqual(env);
    expect(ctx.previousSteps).toHaveLength(1);
    expect(ctx.previousSteps[0].stepId).toBe('check-node');
  });

  it('defaults previousSteps to empty array when omitted', () => {
    const ctx = collectErrorContext({
      stepId: 'install-pnpm',
      execResult: makeExecResult(),
      environment: env,
    });

    expect(ctx.previousSteps).toEqual([]);
  });

  it('does not mutate the original previousSteps array', () => {
    const previous: StepResult[] = [makeStepResult()];
    const ctx = collectErrorContext({
      stepId: 'install-pnpm',
      execResult: makeExecResult(),
      environment: env,
      previousSteps: previous,
    });

    ctx.previousSteps.push(makeStepResult({ stepId: 'extra' }));
    expect(previous).toHaveLength(1);
  });

  it('truncates long stdout', () => {
    const longOutput = 'x'.repeat(20_000);
    const ctx = collectErrorContext({
      stepId: 'install-openclaw',
      execResult: makeExecResult({ stdout: longOutput }),
      environment: env,
    });

    expect(ctx.stdout.length).toBeLessThan(longOutput.length);
    expect(ctx.stdout).toContain('[...truncated');
  });

  it('truncates long stderr', () => {
    const longErr = 'E'.repeat(15_000);
    const ctx = collectErrorContext({
      stepId: 'install-openclaw',
      execResult: makeExecResult({ stderr: longErr }),
      environment: env,
    });

    expect(ctx.stderr.length).toBeLessThan(longErr.length);
    expect(ctx.stderr).toContain('[...truncated');
  });

  it('preserves stdout/stderr when within limit', () => {
    const ctx = collectErrorContext({
      stepId: 'check-node',
      execResult: makeExecResult({
        stdout: 'v22.0.0\n',
        stderr: 'some warning',
      }),
      environment: env,
    });

    expect(ctx.stdout).toBe('v22.0.0\n');
    expect(ctx.stderr).toBe('some warning');
  });

  it('captures timeout information via exitCode and command', () => {
    const ctx = collectErrorContext({
      stepId: 'install-openclaw',
      execResult: makeExecResult({
        command: 'pnpm install -g openclaw',
        exitCode: 1,
        stderr: '',
        timedOut: true,
      }),
      environment: env,
    });

    expect(ctx.command).toBe('pnpm install -g openclaw');
    expect(ctx.exitCode).toBe(1);
  });

  it('works with multiple previous steps', () => {
    const steps: StepResult[] = [
      makeStepResult({ stepId: 'check-node' }),
      makeStepResult({ stepId: 'install-pnpm', success: true, duration: 5000 }),
    ];

    const ctx = collectErrorContext({
      stepId: 'install-openclaw',
      execResult: makeExecResult({ command: 'pnpm install -g openclaw' }),
      environment: env,
      previousSteps: steps,
    });

    expect(ctx.previousSteps).toHaveLength(2);
    expect(ctx.previousSteps[0].stepId).toBe('check-node');
    expect(ctx.previousSteps[1].stepId).toBe('install-pnpm');
  });

  it('includes environment information accurately', () => {
    const linuxEnv = makeEnvironment({
      os: { platform: 'linux', version: '22.04', arch: 'x64' },
      permissions: { hasSudo: true, canWriteTo: ['/usr', '/usr/local'] },
    });

    const ctx = collectErrorContext({
      stepId: 'install-pnpm',
      execResult: makeExecResult(),
      environment: linuxEnv,
    });

    expect(ctx.environment.os.platform).toBe('linux');
    expect(ctx.environment.permissions.hasSudo).toBe(true);
  });
});

// ============================================================================
// ErrorCollector class
// ============================================================================

describe('ErrorCollector', () => {
  let collector: ErrorCollector;
  const env = makeEnvironment();

  beforeEach(() => {
    collector = new ErrorCollector(env);
  });

  // --------------------------------------------------------------------------
  // Step history management
  // --------------------------------------------------------------------------

  describe('step history', () => {
    it('starts with empty history', () => {
      expect(collector.getStepHistory()).toEqual([]);
    });

    it('records step results in order', () => {
      collector.addStepResult(makeStepResult({ stepId: 'step-1' }));
      collector.addStepResult(makeStepResult({ stepId: 'step-2' }));

      const history = collector.getStepHistory();
      expect(history).toHaveLength(2);
      expect(history[0].stepId).toBe('step-1');
      expect(history[1].stepId).toBe('step-2');
    });

    it('returns a copy of history (not a reference)', () => {
      collector.addStepResult(makeStepResult({ stepId: 'step-1' }));
      const history = collector.getStepHistory();
      history.push(makeStepResult({ stepId: 'injected' }));

      expect(collector.getStepHistory()).toHaveLength(1);
    });

    it('clears history', () => {
      collector.addStepResult(makeStepResult({ stepId: 'step-1' }));
      collector.addStepResult(makeStepResult({ stepId: 'step-2' }));
      collector.clearHistory();

      expect(collector.getStepHistory()).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // collect()
  // --------------------------------------------------------------------------

  describe('collect', () => {
    it('creates ErrorContext with no previous steps', () => {
      const execResult = makeExecResult();
      const ctx = collector.collect('install-pnpm', execResult);

      expect(ctx.stepId).toBe('install-pnpm');
      expect(ctx.command).toBe('npm install -g pnpm');
      expect(ctx.exitCode).toBe(1);
      expect(ctx.stderr).toBe('EACCES: permission denied');
      expect(ctx.environment).toEqual(env);
      expect(ctx.previousSteps).toEqual([]);
    });

    it('includes recorded step history as previousSteps', () => {
      collector.addStepResult(makeStepResult({ stepId: 'check-node' }));
      collector.addStepResult(makeStepResult({ stepId: 'install-pnpm', success: true }));

      const ctx = collector.collect(
        'install-openclaw',
        makeExecResult({ command: 'pnpm install -g openclaw' }),
      );

      expect(ctx.previousSteps).toHaveLength(2);
      expect(ctx.previousSteps[0].stepId).toBe('check-node');
      expect(ctx.previousSteps[1].stepId).toBe('install-pnpm');
    });

    it('does not mutate internal history after collect', () => {
      collector.addStepResult(makeStepResult({ stepId: 'step-1' }));
      const ctx = collector.collect('fail-step', makeExecResult());

      ctx.previousSteps.push(makeStepResult({ stepId: 'injected' }));
      expect(collector.getStepHistory()).toHaveLength(1);
    });

    it('truncates long output in collected context', () => {
      const longOutput = 'a'.repeat(20_000);
      const ctx = collector.collect(
        'install-openclaw',
        makeExecResult({ stdout: longOutput, stderr: longOutput }),
      );

      expect(ctx.stdout).toContain('[...truncated');
      expect(ctx.stderr).toContain('[...truncated');
      expect(ctx.stdout.length).toBeLessThan(longOutput.length);
      expect(ctx.stderr.length).toBeLessThan(longOutput.length);
    });

    it('preserves environment reference', () => {
      const ctx = collector.collect('step-x', makeExecResult());
      expect(ctx.environment).toEqual(env);
    });

    it('can be called multiple times with different steps', () => {
      collector.addStepResult(makeStepResult({ stepId: 'step-1' }));

      const ctx1 = collector.collect('step-2', makeExecResult());
      expect(ctx1.previousSteps).toHaveLength(1);

      collector.addStepResult(makeStepResult({ stepId: 'step-2', success: false }));
      const ctx2 = collector.collect('step-3', makeExecResult());
      expect(ctx2.previousSteps).toHaveLength(2);
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty stdout and stderr', () => {
      const ctx = collector.collect(
        'empty-step',
        makeExecResult({ stdout: '', stderr: '' }),
      );

      expect(ctx.stdout).toBe('');
      expect(ctx.stderr).toBe('');
    });

    it('handles zero exit code (should still collect context)', () => {
      const ctx = collector.collect(
        'unexpected-step',
        makeExecResult({ exitCode: 0 }),
      );

      expect(ctx.exitCode).toBe(0);
    });

    it('handles failed previous steps in history', () => {
      collector.addStepResult(
        makeStepResult({ stepId: 'failed-step', success: false, exitCode: 1 }),
      );

      const ctx = collector.collect('next-step', makeExecResult());
      expect(ctx.previousSteps[0].success).toBe(false);
      expect(ctx.previousSteps[0].exitCode).toBe(1);
    });

    it('handles large number of previous steps', () => {
      for (let i = 0; i < 100; i++) {
        collector.addStepResult(makeStepResult({ stepId: `step-${i}` }));
      }

      const ctx = collector.collect('final-step', makeExecResult());
      expect(ctx.previousSteps).toHaveLength(100);
    });
  });
});
